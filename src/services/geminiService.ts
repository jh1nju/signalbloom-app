import { GoogleGenAI, Type } from '@google/genai';
import { asc, desc, eq, and, gte, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  alerts,
  auditLog,
  commands,
  devices,
  metricSamples,
  recommendations,
  settings,
} from '../db/schema.ts';
import { decodeAlertTitleAndReason } from './alertEngine.ts';

export const SYSTEM_INSTRUCTION =
  "You are the SignalBloom assistant for a small business owner with no IT knowledge. Use only the facts in the summary. Explain in plain words, no jargon. If the summary can't answer the question, say so. Never say you have changed anything on the network.";

export const AI_UNAVAILABLE_MESSAGE =
  "The AI assistant isn't available right now. Your network data is still up to date.";

export const AI_BUSY_MESSAGE =
  'The AI assistant is busy right now. Please try again in a minute.';

// Main model for all calls from the app, and fallback model on 503 or 429
export const PRIMARY_FLASH_MODEL = 'gemini-3.5-flash-lite';
export const FALLBACK_LIGHT_FLASH_MODEL = 'gemini-3.1-flash-lite';

// 20 seconds timeout per Gemini API call
const GEMINI_CALL_TIMEOUT_MS = 20_000;

// Per-alert retry backoff schedule: 30s, 1m, 2m, 5m, and every 10m after that
const ALERT_BACKOFF_SCHEDULE_MS = [
  30 * 1000,
  60 * 1000,
  2 * 60 * 1000,
  5 * 60 * 1000,
  10 * 60 * 1000,
];

interface AlertBackoffState {
  failureCount: number;
  nextRetryAt: number;
  severity: string;
}

// Track backoff state per alertId
const alertBackoffByAlertId = new Map<string, AlertBackoffState>();

// Track the alert severity for which recommendations were last generated (alertId -> severity)
const alertGeneratedSeverity = new Map<string, string>();

// Track optional target_mac for recommendations in memory (recommendationId -> target_mac)
const recommendationTargetMac = new Map<string, string | null>();

// Prevent concurrent duplicate Gemini calls for the same alertId + severity
const inFlightGenerations = new Map<string, Promise<FormattedRecommendation[] | null>>();

export function buildBasicAlertExplanation(rule: string, reason: string): string {
  const cleanReason = (reason || '').trim().replace(/\.+$/, '');
  let meaning = 'This usually means there is a temporary problem on the network.';
  if (rule === 'delay') {
    meaning = 'This usually means the internet connection is overloaded or unstable.';
  } else if (rule === 'packet_loss') {
    meaning =
      'This usually means the internet connection is overloaded or has a faulty cable or Wi-Fi link.';
  } else if (rule === 'internet_down') {
    meaning = 'This usually means the router, modem, or internet provider connection is down.';
  } else if (rule === 'device_offline') {
    meaning = 'This usually means the device is turned off, unplugged, or out of Wi-Fi range.';
  } else if (rule === 'new_device') {
    meaning =
      'This usually means a new phone, computer, or guest device just connected to your network.';
  }
  return cleanReason ? `${cleanReason}. ${meaning}` : meaning;
}

function getErrorStatus(err: any): number | null {
  if (typeof err?.status === 'number') return err.status;
  if (typeof err?.code === 'number') return err.code;
  const msg = String(err?.message || '');
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
    return 503;
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return 429;
  }
  if (msg.includes('402') || msg.toLowerCase().includes('prepayment credits')) {
    return 402;
  }
  return null;
}

function isTimeoutError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('timed out') || msg.includes('timeout') || err?.name === 'AbortError';
}

function is503Or429(err: any): boolean {
  const status = getErrorStatus(err);
  return status === 503 || status === 429;
}

function is503OrTimeout(err: any): boolean {
  const status = getErrorStatus(err);
  return status === 503 || isTimeoutError(err);
}

function is402OrCreditDepleted(err: any): boolean {
  const status = getErrorStatus(err);
  return status === 402 || String(err?.message || '').toLowerCase().includes('prepayment credits');
}

function formatSingleLineError(err: any): string {
  if (isTimeoutError(err)) return `timeout after ${GEMINI_CALL_TIMEOUT_MS / 1000}s`;
  if (is402OrCreditDepleted(err)) return 'HTTP 402 (prepayment credits depleted)';
  const status = getErrorStatus(err);
  const firstLine = String(err?.message || err || 'Unknown error')
    .split('\n')[0]
    .slice(0, 140);
  return status ? `HTTP ${status} (${firstLine})` : firstLine;
}

export interface RecommendationCommandStatus {
  id: string;
  type: 'restart_device' | 'isolate_device' | 'reconnect_device';
  targetMac: string;
  status: 'pending' | 'sent' | 'succeeded' | 'failed';
  approvedAt: string;
  finishedAt: string | null;
  resultMessage: string | null;
}

export interface FormattedRecommendation {
  id: string;
  alertId: string;
  rank: number;
  explanation: string;
  actionText: string;
  commandType: 'restart_device' | 'isolate_device' | 'reconnect_device' | null;
  targetMac: string | null;
  targetDeviceName: string | null;
  selfHandled: boolean;
  command: RecommendationCommandStatus | null;
  deviceHasPendingCommand: boolean;
}

export function formatDeviceFriendlyName(
  rawHostname: string | null | undefined,
  fallbackMac?: string | null
): string {
  const host = (rawHostname || '').trim();
  if (!host || host.toLowerCase() === 'unknown') {
    return fallbackMac ? `Device (${fallbackMac})` : 'Unknown device';
  }
  const lower = host.toLowerCase();
  if (lower === 'reception-pc') return 'Reception PC';
  if (lower === 'reception-pc-01') return 'Reception PC 01';
  if (lower === 'reception-pc-02') return 'Reception PC 02';
  if (lower === 'dr-chen-surgery-pc') return 'Dr Chen surgery PC';
  if (lower === 'dr-patel-surgery-pc') return 'Dr Patel surgery PC';
  if (lower === 'brother-label-printer') return 'Brother label printer';
  if (lower === 'staff-breakroom-phone') return 'Staff breakroom phone';
  if (lower === 'gateway-core-router') return 'Gateway core router';
  if (lower === 'hp-laserjet-reception') return 'HP LaserJet reception';
  if (lower === 'carestream-xray-imaging') return 'Carestream X-ray imaging';
  if (lower === 'patient-checkin-ipad') return 'Patient check-in iPad';
  if (lower === 'eftpos-terminal-counter1') return 'EFTPOS terminal counter 1';
  if (lower === 'eftpos-terminal-counter2') return 'EFTPOS terminal counter 2';

  if (host.includes('-')) {
    const words = host.split('-').filter(Boolean);
    return words
      .map((w, i) => {
        const lw = w.toLowerCase();
        if (lw === 'pc') return 'PC';
        if (lw === 'ipad') return 'iPad';
        if (lw === 'hp') return 'HP';
        if (lw === 'eftpos') return 'EFTPOS';
        if (i === 0) return lw.charAt(0).toUpperCase() + lw.slice(1);
        return lw;
      })
      .join(' ');
  }
  return host;
}

export function getCommandVerbCapitalized(
  commandType: 'restart_device' | 'isolate_device' | 'reconnect_device' | string | null | undefined
): string {
  if (commandType === 'isolate_device') return 'Isolate';
  if (commandType === 'reconnect_device') return 'Reconnect';
  return 'Restart';
}

export function getCommandVerbLower(
  commandType: 'restart_device' | 'isolate_device' | 'reconnect_device' | string | null | undefined
): string {
  if (commandType === 'isolate_device') return 'isolate';
  if (commandType === 'reconnect_device') return 'reconnect';
  return 'restart';
}

export function getCommandNounLower(
  commandType: 'restart_device' | 'isolate_device' | 'reconnect_device' | string | null | undefined
): string {
  if (commandType === 'isolate_device') return 'isolation';
  if (commandType === 'reconnect_device') return 'reconnect';
  return 'restart';
}

export interface SiteSummary {
  healthScore: {
    score: number;
    status: string;
    windowMinutes: number;
    parts: {
      name: string;
      value: string;
      score: number;
      weight: number;
    }[];
  };
  latestReadings: {
    delayMs: number | null;
    packetLossPct: number | null;
    internetUp: boolean | null;
    downloadMbps: number | null;
    measuredAt: string | null;
  };
  openAlerts: {
    id: string;
    category: 'health' | 'security';
    severity: 'critical' | 'warning' | 'info';
    rule: string;
    title: string;
    reason: string;
    occurrenceCount: number;
    firstSeenAt: string;
    deviceMac: string | null;
    deviceName: string | null;
  }[];
  devicesSummary: {
    totalDevices: number;
    onlineDevices: number;
    offlineDevicesCount: number;
    offlineDevices: {
      name: string;
      ip: string;
      mac: string;
      vendor: string;
      lastSeenAt: string;
    }[];
  };
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function calculateLinearScore(
  val: number,
  limit: { full: number; zero: number },
  higherIsBetter: boolean
): number {
  const { full, zero } = limit;
  let score: number;
  if (higherIsBetter) {
    if (val >= full) return 100;
    if (val <= zero) return 0;
    score = ((val - zero) / (full - zero)) * 100;
  } else {
    if (val <= full) return 100;
    if (val >= zero) return 0;
    score = ((zero - val) / (zero - full)) * 100;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Builds the sanitized site summary for the selected site.
 * Contains: health score and its five parts, open alerts with their reasons,
 * offline devices, and the latest delay, packet loss and speed.
 * Strictly excludes customer names, emails, or tokens.
 */
export async function buildSiteSummary(siteId: string): Promise<SiteSummary> {
  const defaultWeights = { uptime: 30, latency: 25, packet_loss: 20, speed: 15, devices: 10 };
  const defaultLimits = {
    uptime: { full: 100, zero: 90 },
    latency: { full: 30, zero: 200 },
    packet_loss: { full: 0, zero: 10 },
    speed: { full: 100, zero: 5 },
    devices: { full: 100, zero: 50 },
  };

  const settingsRows = await db.select().from(settings);
  const settingsMap = new Map<string, any>();
  for (const r of settingsRows) {
    settingsMap.set(r.key, r.value);
  }

  const weights = { ...defaultWeights, ...(settingsMap.get('health_weights') || {}) };
  const limits = { ...defaultLimits, ...(settingsMap.get('health_limits') || {}) };
  const rawWindow = settingsMap.get('score_window_minutes');
  const scoreWindowMinutes =
    typeof rawWindow === 'number' && rawWindow > 0
      ? rawWindow
      : Number(rawWindow) > 0
        ? Number(rawWindow)
        : 5;

  const windowStart = new Date(Date.now() - scoreWindowMinutes * 60 * 1000);
  let recentSamples = await db
    .select()
    .from(metricSamples)
    .where(and(eq(metricSamples.siteId, siteId), gte(metricSamples.measuredAt, windowStart)))
    .orderBy(desc(metricSamples.measuredAt));

  if (recentSamples.length === 0) {
    recentSamples = await db
      .select()
      .from(metricSamples)
      .where(eq(metricSamples.siteId, siteId))
      .orderBy(desc(metricSamples.measuredAt))
      .limit(Math.max(1, Math.round(scoreWindowMinutes * 2)));
  }

  const [latestSpeedSample] = await db
    .select({ downloadMbps: metricSamples.downloadMbps, measuredAt: metricSamples.measuredAt })
    .from(metricSamples)
    .where(and(eq(metricSamples.siteId, siteId), sql`${metricSamples.downloadMbps} IS NOT NULL`))
    .orderBy(desc(metricSamples.measuredAt))
    .limit(1);

  const siteDevices = await db.select().from(devices).where(eq(devices.siteId, siteId));
  const deviceById = new Map(siteDevices.map((d) => [d.id, d]));

  const parts: { name: string; value: string; score: number; weight: number }[] = [];

  if (recentSamples.length > 0) {
    const upCount = recentSamples.filter((s) => s.internetUp).length;
    const uptimePct = (upCount / recentSamples.length) * 100;
    const uptimeScore = calculateLinearScore(uptimePct, limits.uptime, true);
    parts.push({
      name: 'Internet uptime',
      value: uptimePct >= 99.95 ? '100% online' : `${uptimePct.toFixed(1)}% online`,
      score: uptimeScore,
      weight: Number(weights.uptime) || 30,
    });

    const avgLatency =
      recentSamples.reduce((acc, s) => acc + s.latencyMs, 0) / recentSamples.length;
    const latencyScore = calculateLinearScore(avgLatency, limits.latency, false);
    parts.push({
      name: 'Delay',
      value: `${avgLatency.toFixed(1)} ms`,
      score: latencyScore,
      weight: Number(weights.latency) || 25,
    });

    const avgLoss =
      recentSamples.reduce((acc, s) => acc + s.packetLossPct, 0) / recentSamples.length;
    const lossScore = calculateLinearScore(avgLoss, limits.packet_loss, false);
    parts.push({
      name: 'Packet loss',
      value: `${avgLoss.toFixed(1)}%`,
      score: lossScore,
      weight: Number(weights.packet_loss) || 20,
    });
  }

  if (latestSpeedSample && latestSpeedSample.downloadMbps !== null) {
    const speedMbps = latestSpeedSample.downloadMbps;
    const speedScore = calculateLinearScore(speedMbps, limits.speed, true);
    parts.push({
      name: 'Internet speed',
      value: `${speedMbps.toFixed(0)} Mbps`,
      score: speedScore,
      weight: Number(weights.speed) || 15,
    });
  }

  if (siteDevices.length > 0) {
    const onlineCount = siteDevices.filter((d) => d.online).length;
    const onlinePct = (onlineCount / siteDevices.length) * 100;
    const devicesScore = calculateLinearScore(onlinePct, limits.devices, true);
    parts.push({
      name: 'Devices online',
      value: `${onlineCount} of ${siteDevices.length} online`,
      score: devicesScore,
      weight: Number(weights.devices) || 10,
    });
  }

  const totalWeight = parts.reduce((acc, p) => acc + p.weight, 0);
  const overallScore =
    totalWeight > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(parts.reduce((acc, p) => acc + p.score * p.weight, 0) / totalWeight)
          )
        )
      : 100;

  const statusWord =
    overallScore >= 80 ? 'Healthy' : overallScore >= 50 ? 'Needs attention' : 'Problem';

  parts.sort((a, b) => a.score - b.score);

  const openAlertRows = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.siteId, siteId), eq(alerts.status, 'open')))
    .orderBy(desc(alerts.lastSeenAt));

  const openAlerts = openAlertRows.map((a) => {
    const { title, reason } = decodeAlertTitleAndReason(a.rule, a.severity, a.reason);
    const dev = a.deviceId ? deviceById.get(a.deviceId) : undefined;
    const devName = dev
      ? !dev.hostname || dev.hostname.toLowerCase() === 'unknown'
        ? 'Unknown device'
        : dev.hostname
      : null;
    return {
      id: a.id,
      category: a.category,
      severity: a.severity,
      rule: a.rule,
      title,
      reason,
      occurrenceCount: a.occurrenceCount,
      firstSeenAt: new Date(a.firstSeenAt).toISOString(),
      deviceMac: dev?.mac ?? null,
      deviceName: devName,
    };
  });

  const offlineDevices = siteDevices
    .filter((d) => !d.online)
    .map((d) => ({
      name:
        !d.hostname || d.hostname.toLowerCase() === 'unknown' ? 'Unknown device' : d.hostname,
      ip: d.ip,
      mac: d.mac,
      vendor: d.vendor,
      lastSeenAt: new Date(d.lastSeenAt).toISOString(),
    }));

  const newestSample = recentSamples[0] || null;

  return {
    healthScore: {
      score: overallScore,
      status: statusWord,
      windowMinutes: scoreWindowMinutes,
      parts,
    },
    latestReadings: {
      delayMs: newestSample ? Math.round(newestSample.latencyMs * 10) / 10 : null,
      packetLossPct: newestSample ? Math.round(newestSample.packetLossPct * 10) / 10 : null,
      internetUp: newestSample ? newestSample.internetUp : null,
      downloadMbps:
        latestSpeedSample && latestSpeedSample.downloadMbps !== null
          ? Math.round(latestSpeedSample.downloadMbps)
          : null,
      measuredAt: newestSample ? new Date(newestSample.measuredAt).toISOString() : null,
    },
    openAlerts,
    devicesSummary: {
      totalDevices: siteDevices.length,
      onlineDevices: siteDevices.filter((d) => d.online).length,
      offlineDevicesCount: offlineDevices.length,
      offlineDevices,
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms = GEMINI_CALL_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Gemini request timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Calls the main model (`gemini-3.5-flash-lite`) with a 20s timeout.
 * If it fails with 503 or 429, tries once more with the fallback model
 * (`gemini-3.1-flash-lite`) with a 20s timeout before giving up.
 */
async function generateContentWithFlashFallback(params: {
  contents: string;
  config: Record<string, any>;
}) {
  const ai = getGenAIClient();
  try {
    return await withTimeout(
      ai.models.generateContent({
        model: PRIMARY_FLASH_MODEL,
        contents: params.contents,
        config: params.config,
      }),
      GEMINI_CALL_TIMEOUT_MS
    );
  } catch (primaryErr: any) {
    if (is503Or429(primaryErr)) {
      return await withTimeout(
        ai.models.generateContent({
          model: FALLBACK_LIGHT_FLASH_MODEL,
          contents: params.contents,
          config: params.config,
        }),
        GEMINI_CALL_TIMEOUT_MS
      );
    }
    throw primaryErr;
  }
}

/**
 * Clears saved recommendations and cached severity/backoff state for an alert when its severity changes,
 * so the next time the alert card is shown on screen it generates fresh recommendations for the new severity.
 */
export async function invalidateAlertRecommendations(alertId: string): Promise<void> {
  alertGeneratedSeverity.delete(alertId);
  alertBackoffByAlertId.delete(alertId);
  await db.delete(recommendations).where(eq(recommendations.alertId, alertId));
}

export async function resolveRecommendationTargetDevice(params: {
  siteId: string;
  recommendationId: string;
  actionText: string;
  commandType: 'restart_device' | 'isolate_device' | 'reconnect_device' | null;
  alertDeviceId: string | null;
  siteDevices?: (typeof devices.$inferSelect)[];
  existingCommandMac?: string | null;
}): Promise<{ targetMac: string | null; targetDeviceName: string | null }> {
  const {
    siteId,
    recommendationId,
    actionText,
    commandType,
    alertDeviceId,
    existingCommandMac,
  } = params;

  if (!commandType) {
    return { targetMac: null, targetDeviceName: null };
  }

  const siteDevices =
    params.siteDevices ??
    (await db.select().from(devices).where(eq(devices.siteId, siteId)));

  let targetMac: string | null = existingCommandMac || recommendationTargetMac.get(recommendationId) || null;

  if (!targetMac && alertDeviceId) {
    const alertDev = siteDevices.find((d) => d.id === alertDeviceId);
    if (alertDev) {
      targetMac = alertDev.mac;
    }
  }

  if (!targetMac && actionText) {
    const lowerText = actionText.toLowerCase();
    if (lowerText.includes('router')) {
      const routerDev =
        siteDevices.find((d) => d.ip && d.ip.trim().endsWith('.1')) ||
        siteDevices.find((d) => (d.hostname || '').toLowerCase().includes('router'));
      if (routerDev) {
        targetMac = routerDev.mac;
      }
    }

    if (!targetMac) {
      for (const d of siteDevices) {
        const rawHost = (d.hostname || '').toLowerCase();
        const friendly = formatDeviceFriendlyName(d.hostname, d.mac).toLowerCase();
        if (
          (rawHost && rawHost !== 'unknown' && lowerText.includes(rawHost)) ||
          (friendly && friendly !== 'unknown device' && lowerText.includes(friendly))
        ) {
          targetMac = d.mac;
          break;
        }
      }
    }
  }

  if (!targetMac && siteDevices.length > 0) {
    const router = siteDevices.find(
      (d) => (d.ip && d.ip.trim().endsWith('.1')) || (d.hostname || '').toLowerCase().includes('router')
    );
    const receptionPc = siteDevices.find((d) =>
      (d.hostname || '').toLowerCase().startsWith('reception-pc')
    );
    targetMac = router?.mac ?? receptionPc?.mac ?? siteDevices[0].mac;
  }

  if (targetMac) {
    recommendationTargetMac.set(recommendationId, targetMac);
  }

  const matchedDevice = targetMac
    ? siteDevices.find((d) => d.mac.toLowerCase() === targetMac!.toLowerCase())
    : undefined;

  const targetDeviceName = targetMac
    ? formatDeviceFriendlyName(matchedDevice?.hostname, targetMac)
    : null;

  return { targetMac, targetDeviceName };
}

async function ensureSeededRecommendationsForAlert(params: {
  siteId: string;
  alertId: string;
  severity: 'critical' | 'warning' | 'info';
  rule: string;
  reason: string;
  deviceId: string | null;
  siteDevices: (typeof devices.$inferSelect)[];
}): Promise<(typeof recommendations.$inferSelect)[]> {
  const { alertId, severity, rule, reason, deviceId, siteDevices } = params;
  if (severity !== 'critical' && severity !== 'warning') {
    return [];
  }

  const explanationText = buildBasicAlertExplanation(rule, reason);
  const alertDev = deviceId ? siteDevices.find((d) => d.id === deviceId) : undefined;
  const receptionPc = siteDevices.find((d) =>
    (d.hostname || '').toLowerCase().startsWith('reception-pc')
  );
  let targetDev: (typeof devices.$inferSelect) | undefined = alertDev ?? receptionPc ?? siteDevices[0];
  let friendlyName = targetDev ? formatDeviceFriendlyName(targetDev.hostname, targetDev.mac) : 'device';

  let primaryAction = `Restart ${friendlyName} to restore a stable network connection.`;
  let primaryCommand: 'restart_device' | 'isolate_device' | 'reconnect_device' | null =
    'restart_device';
  let secondaryAction =
    'Check that the power cord and network cable are plugged in firmly.';

  if (rule === 'new_device') {
    primaryAction = `Isolate ${friendlyName} until you verify who connected it to your network.`;
    primaryCommand = 'isolate_device';
    secondaryAction =
      'Ask staff on duty if anyone recently connected a new phone, tablet, or laptop.';
  } else if (rule === 'device_offline') {
    primaryAction = `Restart ${friendlyName} so it reconnects to the site network.`;
    primaryCommand = 'restart_device';
    secondaryAction = `Check that ${friendlyName} is plugged into power and switched on.`;
  } else if (rule === 'delay' || rule === 'packet_loss' || rule === 'internet_down') {
    // The router is the device whose IP is the site's gateway (usually ending in .1)
    const routerDev =
      siteDevices.find((d) => d.ip && d.ip.trim().endsWith('.1')) ||
      siteDevices.find((d) => (d.hostname || '').toLowerCase().includes('router'));

    if (routerDev) {
      primaryAction = 'Restart the router';
      primaryCommand = 'restart_device';
      targetDev = routerDev;
    } else {
      primaryAction = 'Restart the router manually by unplugging its power cord for 30 seconds.';
      primaryCommand = null;
      targetDev = undefined;
    }
    secondaryAction =
      'Check your main router and modem lights to confirm the internet line is steady.';
  }

  const insertedRows: (typeof recommendations.$inferSelect)[] = [];

  const [row1] = await db
    .insert(recommendations)
    .values({
      alertId,
      rank: 1,
      explanation: explanationText,
      actionText: primaryAction,
      commandType: primaryCommand,
    })
    .returning();

  if (row1) {
    if (targetDev?.mac && primaryCommand) {
      recommendationTargetMac.set(row1.id, targetDev.mac);
    }
    insertedRows.push(row1);
  }

  const [row2] = await db
    .insert(recommendations)
    .values({
      alertId,
      rank: 2,
      explanation: explanationText,
      actionText: secondaryAction,
      commandType: null,
    })
    .returning();

  if (row2) {
    insertedRows.push(row2);
  }

  return insertedRows;
}

async function formatAndEnrichRecommendations(params: {
  siteId: string;
  alertDeviceId: string | null;
  rows: (typeof recommendations.$inferSelect)[];
  siteDevices: (typeof devices.$inferSelect)[];
}): Promise<FormattedRecommendation[]> {
  const { siteId, alertDeviceId, rows, siteDevices } = params;
  if (rows.length === 0) return [];

  const [siteCommands, selfHandledLogs] = await Promise.all([
    db
      .select()
      .from(commands)
      .where(eq(commands.siteId, siteId))
      .orderBy(desc(commands.approvedAt)),
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.siteId, siteId), eq(auditLog.action, 'fix_self_handled')))
      .orderBy(desc(auditLog.createdAt)),
  ]);

  const selfHandledSet = new Set<string>();
  for (const log of selfHandledLogs) {
    const details = (log.details || {}) as Record<string, any>;
    if (typeof details.recommendation_id === 'string') {
      selfHandledSet.add(details.recommendation_id);
    }
  }

  const result: FormattedRecommendation[] = [];

  for (const r of rows) {
    const recCmd = siteCommands.find((c) => c.recommendationId === r.id);

    const { targetMac, targetDeviceName } = await resolveRecommendationTargetDevice({
      siteId,
      recommendationId: r.id,
      actionText: r.actionText,
      commandType: r.commandType,
      alertDeviceId,
      siteDevices,
      existingCommandMac: recCmd?.targetMac ?? null,
    });

    const pendingDeviceCmd =
      r.commandType && targetMac
        ? siteCommands.find(
            (c) =>
              c.status === 'pending' &&
              c.type === r.commandType &&
              c.targetMac.toLowerCase() === targetMac.toLowerCase()
          )
        : undefined;

    const effectiveCmd = recCmd ?? null;

    result.push({
      id: r.id,
      alertId: r.alertId,
      rank: r.rank,
      explanation: r.explanation,
      actionText: r.actionText,
      commandType: r.commandType,
      targetMac,
      targetDeviceName,
      selfHandled: selfHandledSet.has(r.id),
      command: effectiveCmd
        ? {
            id: effectiveCmd.id,
            type: effectiveCmd.type,
            targetMac: effectiveCmd.targetMac,
            status: effectiveCmd.status,
            approvedAt: new Date(effectiveCmd.approvedAt).toISOString(),
            finishedAt: effectiveCmd.finishedAt
              ? new Date(effectiveCmd.finishedAt).toISOString()
              : null,
            resultMessage: effectiveCmd.resultMessage ?? null,
          }
        : null,
      deviceHasPendingCommand: Boolean(pendingDeviceCmd),
    });
  }

  return result;
}

/**
 * Reads saved AI explanation and recommendations for an alert from the `recommendations` table
 * without calling Gemini. If an open critical/warning alert has no rows in `recommendations` yet,
 * seeds deterministic recommendations in the database so the approve-fix flow works without Gemini calls.
 */
export async function getSavedAlertRecommendations(params: {
  siteId?: string;
  alertId: string;
  severity: 'critical' | 'warning' | 'info';
  rule: string;
  reason: string;
  deviceId: string | null;
}): Promise<{
  explanation: string | null;
  recommendations: FormattedRecommendation[];
  aiAvailable: boolean;
  basicExplanation: string;
}> {
  const { alertId, severity, rule, reason, deviceId } = params;
  const basicExplanation = buildBasicAlertExplanation(rule, reason);

  let resolvedSiteId = params.siteId;
  if (!resolvedSiteId) {
    const [alertRow] = await db
      .select({ siteId: alerts.siteId })
      .from(alerts)
      .where(eq(alerts.id, alertId))
      .limit(1);
    resolvedSiteId = alertRow?.siteId;
  }

  const siteDevices = resolvedSiteId
    ? await db.select().from(devices).where(eq(devices.siteId, resolvedSiteId))
    : [];

  let existingRows = await db
    .select()
    .from(recommendations)
    .where(eq(recommendations.alertId, alertId))
    .orderBy(asc(recommendations.rank));

  if (
    existingRows.length === 0 &&
    resolvedSiteId &&
    (severity === 'critical' || severity === 'warning')
  ) {
    existingRows = await ensureSeededRecommendationsForAlert({
      siteId: resolvedSiteId,
      alertId,
      severity,
      rule,
      reason,
      deviceId,
      siteDevices,
    });
  }

  if (existingRows.length === 0 || !resolvedSiteId) {
    return {
      explanation: null,
      recommendations: [],
      aiAvailable: true,
      basicExplanation,
    };
  }

  const formatted = await formatAndEnrichRecommendations({
    siteId: resolvedSiteId,
    alertDeviceId: deviceId,
    rows: existingRows,
    siteDevices,
  });

  return {
    explanation: formatted[0]?.explanation ?? null,
    recommendations: formatted,
    aiAvailable: true,
    basicExplanation,
  };
}

/**
 * Returns saved recommendations (or seeds deterministic recommendations if missing)
 * without making Gemini API calls during the approve-fix flow.
 */
export async function getOrGenerateAlertRecommendations(params: {
  siteId: string;
  alertId: string;
  severity: 'critical' | 'warning' | 'info';
  rule: string;
  title: string;
  reason: string;
  deviceId: string | null;
  summary?: SiteSummary;
}): Promise<{
  explanation: string | null;
  recommendations: FormattedRecommendation[];
  aiAvailable: boolean;
  basicExplanation: string;
  nextRetryAt: number | null;
}> {
  const saved = await getSavedAlertRecommendations({
    siteId: params.siteId,
    alertId: params.alertId,
    severity: params.severity,
    rule: params.rule,
    reason: params.reason,
    deviceId: params.deviceId,
  });

  return {
    explanation: saved.explanation,
    recommendations: saved.recommendations,
    aiAvailable: saved.aiAvailable,
    basicExplanation: saved.basicExplanation,
    nextRetryAt: null,
  };
}

/**
 * Answers a user question on the AI Assistant tab using the selected site's summary.
 * Answers in three sentences or fewer, then one suggested action.
 * On 503 or timeout, retries once after 3 seconds before failing with AI_BUSY_MESSAGE.
 */
export async function askSiteAssistant(params: {
  siteId: string;
  question: string;
  history?: { role: 'user' | 'assistant'; text: string }[];
}): Promise<{
  answer: string;
  suggestedAction: string;
  summaryUsed: SiteSummary;
}> {
  const { siteId, question, history = [] } = params;
  const siteSummary = await buildSiteSummary(siteId);

  const recentHistory = history.slice(-6).map((h) => ({
    role: h.role,
    text: h.text,
  }));

  const prompt = JSON.stringify(
    {
      task: 'Answer the user question about this site using ONLY the facts in siteSummary. Keep your answer to three sentences or fewer in plain words with no technical jargon. Then provide one clear, practical suggested_action.',
      siteSummary,
      conversationHistory: recentHistory,
      userQuestion: question,
    },
    null,
    2
  );

  const callAssistantModel = () =>
    generateContentWithFlashFallback({
      contents: prompt,
      config: {
        systemInstruction: `${SYSTEM_INSTRUCTION} Keep every answer to three sentences or fewer, followed by one suggested action.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: {
              type: Type.STRING,
              description:
                'Plain-English answer to the question in three sentences or fewer, using only facts from the summary.',
            },
            suggested_action: {
              type: Type.STRING,
              description: 'One plain-English suggested action the user can take next.',
            },
          },
          required: ['answer', 'suggested_action'],
        },
      },
    });

  let response;
  try {
    response = await callAssistantModel();
  } catch (firstErr: any) {
    if (is503OrTimeout(firstErr) || is503Or429(firstErr)) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        response = await callAssistantModel();
      } catch (_secondErr: any) {
        const busyError: any = new Error(AI_BUSY_MESSAGE);
        busyError.isBusy = true;
        throw busyError;
      }
    } else {
      const unavailableError: any = new Error(AI_UNAVAILABLE_MESSAGE);
      unavailableError.isUnavailable = true;
      unavailableError.originalStatus = getErrorStatus(firstErr);
      throw unavailableError;
    }
  }

  const rawText = response.text?.trim();
  if (!rawText) {
    throw new Error('Empty response from Gemini');
  }

  const parsed = JSON.parse(rawText) as {
    answer?: string;
    suggested_action?: string;
  };

  const answer = (parsed.answer || '').trim();
  const suggestedAction = (parsed.suggested_action || '').trim();

  if (!answer) {
    throw new Error('Invalid response structure from Gemini');
  }

  return {
    answer,
    suggestedAction:
      suggestedAction || 'Keep an eye on the Network Health tab over the next few minutes.',
    summaryUsed: siteSummary,
  };
}
