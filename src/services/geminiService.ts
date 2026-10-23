import { GoogleGenAI, Type } from '@google/genai';
import { asc, desc, eq, and, gte, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { alerts, devices, metricSamples, recommendations, settings } from '../db/schema.ts';
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

export interface FormattedRecommendation {
  id: string;
  alertId: string;
  rank: number;
  explanation: string;
  actionText: string;
  commandType: 'restart_device' | 'isolate_device' | 'reconnect_device' | null;
  targetMac: string | null;
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

/**
 * Reads already-saved AI explanation and recommendations for an alert from the `recommendations` table
 * without calling Gemini. Used by GET /api/sites/:siteId/alerts so polling never triggers background AI calls.
 */
export async function getSavedAlertRecommendations(params: {
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

  const existingRows = await db
    .select()
    .from(recommendations)
    .where(eq(recommendations.alertId, alertId))
    .orderBy(asc(recommendations.rank));

  if (existingRows.length === 0) {
    const backoff = alertBackoffByAlertId.get(alertId);
    const inBackoff = Boolean(backoff && backoff.severity === severity && Date.now() < backoff.nextRetryAt);
    return {
      explanation: null,
      recommendations: [],
      aiAvailable: !inBackoff,
      basicExplanation,
    };
  }

  let defaultDeviceMac: string | null = null;
  if (deviceId) {
    const [dev] = await db
      .select({ mac: devices.mac })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    defaultDeviceMac = dev?.mac ?? null;
  }

  const formatted: FormattedRecommendation[] = existingRows.map((r) => ({
    id: r.id,
    alertId: r.alertId,
    rank: r.rank,
    explanation: r.explanation,
    actionText: r.actionText,
    commandType: r.commandType,
    targetMac:
      recommendationTargetMac.get(r.id) ?? (r.commandType ? defaultDeviceMac : null),
  }));

  return {
    explanation: formatted[0]?.explanation ?? null,
    recommendations: formatted,
    aiAvailable: true,
    basicExplanation,
  };
}

/**
 * Ensures AI explanation and up to 3 recommendations exist in the `recommendations` table
 * for an open critical or warning alert.
 * Generates once per alert when requested on-demand, and regenerates only if the alert's severity changes.
 * Enforces per-alert backoff (30s, 1m, 2m, 5m, then every 10m) and logs a single line per failed attempt.
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
  const { siteId, alertId, severity, rule, title, reason, deviceId } = params;
  const basicExplanation = buildBasicAlertExplanation(rule, reason);

  // Resolve device MAC if alert is tied to a device
  let defaultDeviceMac: string | null = null;
  if (deviceId) {
    const [dev] = await db
      .select({ mac: devices.mac })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    defaultDeviceMac = dev?.mac ?? null;
  }

  // Check existing recommendations in DB
  const existingRows = await db
    .select()
    .from(recommendations)
    .where(eq(recommendations.alertId, alertId))
    .orderBy(asc(recommendations.rank));

  const previousSeverity = alertGeneratedSeverity.get(alertId);

  // If recommendations already exist in DB and severity hasn't changed, return them directly without calling Gemini
  if (existingRows.length > 0 && (!previousSeverity || previousSeverity === severity)) {
    if (!previousSeverity) {
      alertGeneratedSeverity.set(alertId, severity);
    }
    alertBackoffByAlertId.delete(alertId);
    const formatted: FormattedRecommendation[] = existingRows.map((r) => ({
      id: r.id,
      alertId: r.alertId,
      rank: r.rank,
      explanation: r.explanation,
      actionText: r.actionText,
      commandType: r.commandType,
      targetMac:
        recommendationTargetMac.get(r.id) ?? (r.commandType ? defaultDeviceMac : null),
    }));
    return {
      explanation: formatted[0]?.explanation ?? null,
      recommendations: formatted,
      aiAvailable: true,
      basicExplanation,
      nextRetryAt: null,
    };
  }

  // Only generate for critical or warning alerts
  if (severity !== 'critical' && severity !== 'warning') {
    return {
      explanation: null,
      recommendations: [],
      aiAvailable: true,
      basicExplanation,
      nextRetryAt: null,
    };
  }

  // Check per-alert backoff schedule: never retry the same alert more often than 30s, 1m, 2m, 5m, 10m
  const backoff = alertBackoffByAlertId.get(alertId);
  if (backoff && backoff.severity === severity && Date.now() < backoff.nextRetryAt) {
    return {
      explanation: null,
      recommendations: [],
      aiAvailable: false,
      basicExplanation,
      nextRetryAt: backoff.nextRetryAt,
    };
  }

  const inFlightKey = `${alertId}:${severity}`;
  if (inFlightGenerations.has(inFlightKey)) {
    const res = await inFlightGenerations.get(inFlightKey)!;
    const latestBackoff = alertBackoffByAlertId.get(alertId);
    if (!res) {
      return {
        explanation: null,
        recommendations: [],
        aiAvailable: false,
        basicExplanation,
        nextRetryAt: latestBackoff?.nextRetryAt ?? null,
      };
    }
    return {
      explanation: res[0]?.explanation ?? null,
      recommendations: res,
      aiAvailable: true,
      basicExplanation,
      nextRetryAt: null,
    };
  }

  const generationPromise = (async (): Promise<FormattedRecommendation[] | null> => {
    try {
      const siteSummary = params.summary ?? (await buildSiteSummary(siteId));

      const prompt = JSON.stringify(
        {
          task: 'Explain this network alert in two plain sentences for a non-technical small business owner, and provide up to three practical recommendations ordered most important first. For each recommendation, include action_text, command_type (restart_device, isolate_device, reconnect_device, or null), and target_mac (the MAC address of the specific device when a device action would help, otherwise null).',
          alert: {
            severity,
            rule,
            title,
            reason,
            deviceMac: defaultDeviceMac,
          },
          siteSummary,
        },
        null,
        2
      );

      const response = await generateContentWithFlashFallback({
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              explanation: {
                type: Type.STRING,
                description:
                  'Plain-English explanation of why this alert is happening, in two sentences.',
              },
              recommendations: {
                type: Type.ARRAY,
                description: 'Up to three recommendations, ordered most important first.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    action_text: {
                      type: Type.STRING,
                      description: 'Plain-English step the user can take.',
                    },
                    command_type: {
                      type: Type.STRING,
                      nullable: true,
                      description:
                        'One of restart_device, isolate_device, reconnect_device, or null if no automated device action applies.',
                    },
                    target_mac: {
                      type: Type.STRING,
                      nullable: true,
                      description:
                        'MAC address of the target device when a device action would help, or null.',
                    },
                  },
                  required: ['action_text'],
                },
              },
            },
            required: ['explanation', 'recommendations'],
          },
        },
      });

      const rawText = response.text?.trim();
      if (!rawText) {
        throw new Error('Empty response from Gemini');
      }

      const parsed = JSON.parse(rawText) as {
        explanation?: string;
        recommendations?: {
          action_text?: string;
          command_type?: string | null;
          target_mac?: string | null;
        }[];
      };

      const explanationText = (parsed.explanation || '').trim();
      const rawRecs = Array.isArray(parsed.recommendations)
        ? parsed.recommendations.slice(0, 3)
        : [];

      if (!explanationText || rawRecs.length === 0) {
        throw new Error('Incomplete JSON structure from Gemini');
      }

      // If severity changed and old rows existed, replace them
      if (existingRows.length > 0) {
        await db.delete(recommendations).where(eq(recommendations.alertId, alertId));
      }

      const validCommands = new Set(['restart_device', 'isolate_device', 'reconnect_device']);
      const insertedFormatted: FormattedRecommendation[] = [];

      for (let i = 0; i < rawRecs.length; i++) {
        const item = rawRecs[i];
        const actionText = (item.action_text || '').trim();
        if (!actionText) continue;

        const rawCmd = item.command_type ? String(item.command_type).trim() : null;
        const commandType =
          rawCmd && validCommands.has(rawCmd)
            ? (rawCmd as 'restart_device' | 'isolate_device' | 'reconnect_device')
            : null;

        const targetMac = commandType
          ? item.target_mac
            ? String(item.target_mac).trim()
            : defaultDeviceMac
          : null;

        const [inserted] = await db
          .insert(recommendations)
          .values({
            alertId,
            rank: insertedFormatted.length + 1,
            explanation: explanationText,
            actionText,
            commandType,
          })
          .returning();

        if (inserted) {
          recommendationTargetMac.set(inserted.id, targetMac);
          insertedFormatted.push({
            id: inserted.id,
            alertId: inserted.alertId,
            rank: inserted.rank,
            explanation: inserted.explanation,
            actionText: inserted.actionText,
            commandType: inserted.commandType,
            targetMac,
          });
        }
      }

      alertGeneratedSeverity.set(alertId, severity);
      alertBackoffByAlertId.delete(alertId);
      return insertedFormatted;
    } catch (err) {
      const prevFailures =
        backoff && backoff.severity === severity ? backoff.failureCount : 0;
      const failureCount = prevFailures + 1;
      const backoffMs =
        ALERT_BACKOFF_SCHEDULE_MS[
          Math.min(failureCount - 1, ALERT_BACKOFF_SCHEDULE_MS.length - 1)
        ];

      alertBackoffByAlertId.set(alertId, {
        failureCount,
        nextRetryAt: Date.now() + backoffMs,
        severity,
      });

      // Log strictly one line per failed attempt
      console.warn(
        `[AI] Alert ${alertId} (${rule}) explanation attempt #${failureCount} failed: ${formatSingleLineError(err)} — next retry in ${backoffMs / 1000}s`
      );
      return null;
    } finally {
      inFlightGenerations.delete(inFlightKey);
    }
  })();

  inFlightGenerations.set(inFlightKey, generationPromise);
  const generated = await generationPromise;

  if (!generated) {
    const latestBackoff = alertBackoffByAlertId.get(alertId);
    return {
      explanation: null,
      recommendations: [],
      aiAvailable: false,
      basicExplanation,
      nextRetryAt: latestBackoff?.nextRetryAt ?? null,
    };
  }

  return {
    explanation: generated[0]?.explanation ?? null,
    recommendations: generated,
    aiAvailable: true,
    basicExplanation,
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
