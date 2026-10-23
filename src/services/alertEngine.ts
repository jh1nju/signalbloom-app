import { db } from '../db/index.ts';
import { agents, alerts, devices, metricSamples, settings, sites } from '../db/schema.ts';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

export interface AlertThresholds {
  delay_warning_ms: number;
  delay_critical_ms: number;
  delay_consecutive_readings: number;
  packet_loss_warning_pct: number;
  packet_loss_critical_pct: number;
  packet_loss_consecutive_readings: number;
  internet_down_consecutive_readings: number;
  device_offline_minutes: number;
  resolve_normal_readings: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  delay_warning_ms: 100,
  delay_critical_ms: 250,
  delay_consecutive_readings: 3,
  packet_loss_warning_pct: 5,
  packet_loss_critical_pct: 15,
  packet_loss_consecutive_readings: 3,
  internet_down_consecutive_readings: 2,
  device_offline_minutes: 2,
  resolve_normal_readings: 3,
};

// Track active simulated faults in memory (dev-only): siteId -> expiresAtMs
const simulatedFaults = new Map<string, number>();

// Track the last reading ID evaluated per site so each reading is counted only once
const lastEvaluatedReadingBySite = new Map<string, string>();

// Track consecutive normal checks for online devices to auto-resolve device_offline after 3 normal checks
const deviceNormalStreaks = new Map<string, number>();

export function getSimulatedFaultStatus(siteId: string): {
  active: boolean;
  expiresAt: string | null;
  remainingSeconds: number;
} {
  const until = simulatedFaults.get(siteId);
  if (!until || Date.now() >= until) {
    if (until) simulatedFaults.delete(siteId);
    return { active: false, expiresAt: null, remainingSeconds: 0 };
  }
  return {
    active: true,
    expiresAt: new Date(until).toISOString(),
    remainingSeconds: Math.max(0, Math.ceil((until - Date.now()) / 1000)),
  };
}

export function getAllSimulatedFaults(): Record<
  string,
  { active: boolean; expiresAt: string | null; remainingSeconds: number }
> {
  const result: Record<
    string,
    { active: boolean; expiresAt: string | null; remainingSeconds: number }
  > = {};
  for (const [siteId] of simulatedFaults.entries()) {
    result[siteId] = getSimulatedFaultStatus(siteId);
  }
  return result;
}

export async function startSimulatedFault(siteId: string): Promise<{
  siteId: string;
  active: boolean;
  delayMs: number;
  packetLossPct: number;
  durationSeconds: number;
  expiresAt: string;
}> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Fault simulation is disabled in production.');
  }

  const durationMs = 3 * 60 * 1000; // 3 minutes
  const until = Date.now() + durationMs;
  simulatedFaults.set(siteId, until);

  return {
    siteId,
    active: true,
    delayMs: 330,
    packetLossPct: 20,
    durationSeconds: 180,
    expiresAt: new Date(until).toISOString(),
  };
}

export async function getAlertThresholds(): Promise<AlertThresholds> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'alert_thresholds'));

  if (row && typeof row.value === 'object' && row.value !== null) {
    const val = row.value as Record<string, any>;
    const merged: AlertThresholds = {
      delay_warning_ms: Number(
        val.delay_warning_ms ?? val.latency_warn_ms ?? DEFAULT_ALERT_THRESHOLDS.delay_warning_ms
      ),
      delay_critical_ms: Number(
        val.delay_critical_ms ?? val.latency_crit_ms ?? DEFAULT_ALERT_THRESHOLDS.delay_critical_ms
      ),
      delay_consecutive_readings: Number(
        val.delay_consecutive_readings ?? DEFAULT_ALERT_THRESHOLDS.delay_consecutive_readings
      ),
      packet_loss_warning_pct: Number(
        val.packet_loss_warning_pct ??
          val.packet_loss_warn_pct ??
          DEFAULT_ALERT_THRESHOLDS.packet_loss_warning_pct
      ),
      packet_loss_critical_pct: Number(
        val.packet_loss_critical_pct ??
          val.packet_loss_crit_pct ??
          DEFAULT_ALERT_THRESHOLDS.packet_loss_critical_pct
      ),
      packet_loss_consecutive_readings: Number(
        val.packet_loss_consecutive_readings ??
          DEFAULT_ALERT_THRESHOLDS.packet_loss_consecutive_readings
      ),
      internet_down_consecutive_readings: Number(
        val.internet_down_consecutive_readings ??
          DEFAULT_ALERT_THRESHOLDS.internet_down_consecutive_readings
      ),
      device_offline_minutes: Number(
        val.device_offline_minutes ?? DEFAULT_ALERT_THRESHOLDS.device_offline_minutes
      ),
      resolve_normal_readings: Number(
        val.resolve_normal_readings ?? DEFAULT_ALERT_THRESHOLDS.resolve_normal_readings
      ),
    };

    if (val.delay_warning_ms === undefined || val.resolve_normal_readings === undefined) {
      await db
        .insert(settings)
        .values({ key: 'alert_thresholds', value: merged })
        .onConflictDoUpdate({ target: settings.key, set: { value: merged } });
    }
    return merged;
  }

  await db
    .insert(settings)
    .values({ key: 'alert_thresholds', value: DEFAULT_ALERT_THRESHOLDS })
    .onConflictDoUpdate({ target: settings.key, set: { value: DEFAULT_ALERT_THRESHOLDS } });

  return DEFAULT_ALERT_THRESHOLDS;
}

export function encodeAlertTitleAndReason(title: string, reason: string): string {
  return `${title}\n${reason}`;
}

export function decodeAlertTitleAndReason(
  rule: string,
  severity: 'critical' | 'warning' | 'info',
  storedReason: string
): { title: string; reason: string } {
  if (storedReason.includes('\n')) {
    const [firstLine, ...rest] = storedReason.split('\n');
    return {
      title: firstLine.trim(),
      reason: rest.join('\n').trim(),
    };
  }

  let fallbackTitle = 'Network issue detected';
  if (rule === 'delay') {
    fallbackTitle =
      severity === 'critical' ? 'Your internet is very slow' : 'Your internet is slower than normal';
  } else if (rule === 'packet_loss') {
    fallbackTitle =
      severity === 'critical'
        ? 'A lot of data is being lost on your connection'
        : 'Some data is being lost on your connection';
  } else if (rule === 'internet_down') {
    fallbackTitle = 'Your internet connection is down';
  } else if (rule === 'device_offline') {
    fallbackTitle = 'A known device is offline';
  } else if (rule === 'new_device') {
    fallbackTitle = 'New device joined';
  }

  return {
    title: fallbackTitle,
    reason: storedReason,
  };
}

function formatOfflineDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.floor(ms / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

// Upsert or increment an open alert for (siteId, rule, deviceId)
async function fireOrUpdateAlert(params: {
  siteId: string;
  deviceId: string | null;
  category: 'health' | 'security';
  severity: 'critical' | 'warning' | 'info';
  rule: string;
  title: string;
  reason: string;
  now: Date;
}) {
  const { siteId, deviceId, category, severity, rule, title, reason, now } = params;
  const encodedReason = encodeAlertTitleAndReason(title, reason);

  const whereClause = deviceId
    ? and(
        eq(alerts.siteId, siteId),
        eq(alerts.rule, rule),
        eq(alerts.deviceId, deviceId),
        eq(alerts.status, 'open')
      )
    : and(
        eq(alerts.siteId, siteId),
        eq(alerts.rule, rule),
        isNull(alerts.deviceId),
        eq(alerts.status, 'open')
      );

  const [existing] = await db.select().from(alerts).where(whereClause).limit(1);

  if (existing) {
    await db
      .update(alerts)
      .set({
        severity,
        category,
        reason: encodedReason,
        occurrenceCount: existing.occurrenceCount + 1,
        lastSeenAt: now,
      })
      .where(eq(alerts.id, existing.id));
  } else {
    await db.insert(alerts).values({
      siteId,
      deviceId,
      category,
      severity,
      rule,
      reason: encodedReason,
      status: 'open',
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }
}

async function resolveOpenAlert(params: {
  siteId: string;
  rule: string;
  deviceId: string | null;
  now: Date;
}) {
  const { siteId, rule, deviceId, now } = params;
  const whereClause = deviceId
    ? and(
        eq(alerts.siteId, siteId),
        eq(alerts.rule, rule),
        eq(alerts.deviceId, deviceId),
        eq(alerts.status, 'open')
      )
    : and(
        eq(alerts.siteId, siteId),
        eq(alerts.rule, rule),
        isNull(alerts.deviceId),
        eq(alerts.status, 'open')
      );

  const [existing] = await db.select().from(alerts).where(whereClause).limit(1);
  if (existing) {
    await db
      .update(alerts)
      .set({
        status: 'resolved',
        lastSeenAt: now,
      })
      .where(eq(alerts.id, existing.id));
  }
}

export async function evaluateAlertsForSite(siteId: string): Promise<void> {
  const thresholds = await getAlertThresholds();
  const now = new Date();
  const resolveCount = thresholds.resolve_normal_readings;

  const maxReadingsNeeded = Math.max(
    thresholds.delay_consecutive_readings,
    thresholds.packet_loss_consecutive_readings,
    thresholds.internet_down_consecutive_readings,
    thresholds.resolve_normal_readings,
    5
  );

  const recentReadings = await db
    .select()
    .from(metricSamples)
    .where(eq(metricSamples.siteId, siteId))
    .orderBy(desc(metricSamples.measuredAt))
    .limit(maxReadingsNeeded);

  const latestReading = recentReadings[0];
  const lastEvaluatedReadingId = lastEvaluatedReadingBySite.get(siteId);
  const hasNewReading = Boolean(latestReading && latestReading.id !== lastEvaluatedReadingId);

  // Only evaluate reading-based rules when there is a new reading not yet evaluated for this site
  if (hasNewReading && latestReading) {
    lastEvaluatedReadingBySite.set(siteId, latestReading.id);

    // -------------------------------------------------------------------------
    // 1. Delay rule: warning > 100 ms, critical > 250 ms, for 3 readings in a row
    // -------------------------------------------------------------------------
    const delayCount = thresholds.delay_consecutive_readings;

    if (recentReadings.length >= delayCount) {
      const windowReadings = recentReadings.slice(0, delayCount);
      const allCritical = windowReadings.every((r) => r.latencyMs > thresholds.delay_critical_ms);
      const allWarning = windowReadings.every((r) => r.latencyMs > thresholds.delay_warning_ms);

      if (allCritical || allWarning) {
        const avgDelay = Math.round(
          windowReadings.reduce((sum, r) => sum + r.latencyMs, 0) / windowReadings.length
        );
        const severity = allCritical ? 'critical' : 'warning';
        const title = allCritical
          ? 'Your internet is very slow'
          : 'Your internet is slower than normal';
        const reason = `Delay has been ${avgDelay} ms for ${delayCount} checks; normal is under ${thresholds.delay_warning_ms} ms`;

        await fireOrUpdateAlert({
          siteId,
          deviceId: null,
          category: 'health',
          severity,
          rule: 'delay',
          title,
          reason,
          now,
        });
      } else if (recentReadings.length >= resolveCount) {
        const resolveWindow = recentReadings.slice(0, resolveCount);
        const allNormal = resolveWindow.every((r) => r.latencyMs <= thresholds.delay_warning_ms);
        if (allNormal) {
          await resolveOpenAlert({ siteId, rule: 'delay', deviceId: null, now });
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. Packet loss rule: warning > 5%, critical > 15%, for 3 readings in a row
    // -------------------------------------------------------------------------
    const lossCount = thresholds.packet_loss_consecutive_readings;

    if (recentReadings.length >= lossCount) {
      const windowReadings = recentReadings.slice(0, lossCount);
      const allCritical = windowReadings.every(
        (r) => r.packetLossPct > thresholds.packet_loss_critical_pct
      );
      const allWarning = windowReadings.every(
        (r) => r.packetLossPct > thresholds.packet_loss_warning_pct
      );

      if (allCritical || allWarning) {
        const avgLoss =
          Math.round(
            (windowReadings.reduce((sum, r) => sum + r.packetLossPct, 0) / windowReadings.length) *
              10
          ) / 10;
        const severity = allCritical ? 'critical' : 'warning';
        const title = allCritical
          ? 'A lot of data is being lost on your connection'
          : 'Some data is being lost on your connection';
        const reason = `Packet loss has been ${avgLoss}% for ${lossCount} checks; normal is under ${thresholds.packet_loss_warning_pct}%`;

        await fireOrUpdateAlert({
          siteId,
          deviceId: null,
          category: 'health',
          severity,
          rule: 'packet_loss',
          title,
          reason,
          now,
        });
      } else if (recentReadings.length >= resolveCount) {
        const resolveWindow = recentReadings.slice(0, resolveCount);
        const allNormal = resolveWindow.every(
          (r) => r.packetLossPct <= thresholds.packet_loss_warning_pct
        );
        if (allNormal) {
          await resolveOpenAlert({ siteId, rule: 'packet_loss', deviceId: null, now });
        }
      }
    }

    // -------------------------------------------------------------------------
    // 3. Internet down rule: critical when internet_up is false for 2 readings in a row
    // -------------------------------------------------------------------------
    const downCount = thresholds.internet_down_consecutive_readings;

    if (recentReadings.length >= downCount) {
      const windowReadings = recentReadings.slice(0, downCount);
      const allDown = windowReadings.every((r) => r.internetUp === false);

      if (allDown) {
        await fireOrUpdateAlert({
          siteId,
          deviceId: null,
          category: 'health',
          severity: 'critical',
          rule: 'internet_down',
          title: 'Your internet connection is down',
          reason: `Internet connection has been down for ${downCount} checks in a row`,
          now,
        });
      } else if (recentReadings.length >= resolveCount) {
        const resolveWindow = recentReadings.slice(0, resolveCount);
        const allUp = resolveWindow.every((r) => r.internetUp === true);
        if (allUp) {
          await resolveOpenAlert({ siteId, rule: 'internet_down', deviceId: null, now });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4 & 5. Device rules: device_offline (health) & new_device (security)
  // -------------------------------------------------------------------------
  const [siteAgent] = await db
    .select({ createdAt: agents.createdAt })
    .from(agents)
    .where(eq(agents.siteId, siteId))
    .orderBy(asc(agents.createdAt))
    .limit(1);

  const siteDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.siteId, siteId));

  const offlineThresholdMs = thresholds.device_offline_minutes * 60 * 1000;
  const tenMinutesMs = 10 * 60 * 1000;

  for (const device of siteDevices) {
    const rawHost = (device.hostname || '').trim();
    const deviceName =
      !rawHost || rawHost.toLowerCase() === 'unknown' ? 'Unknown device' : rawHost;

    // Rule 4: Known device offline for more than 2 minutes
    if (device.isKnown && !device.online) {
      deviceNormalStreaks.set(device.id, 0);
      const offlineDurationMs = now.getTime() - new Date(device.lastSeenAt).getTime();

      if (offlineDurationMs > offlineThresholdMs) {
        await fireOrUpdateAlert({
          siteId,
          deviceId: device.id,
          category: 'health',
          severity: 'warning',
          rule: 'device_offline',
          title: `${deviceName} is offline`,
          reason: `Known device ${deviceName} (${device.ip}) has been offline for ${formatOfflineDuration(
            offlineDurationMs
          )}; normal is under ${thresholds.device_offline_minutes} minutes`,
          now,
        });
      }
    } else if (device.online) {
      const prevStreak = deviceNormalStreaks.get(device.id) || 0;
      const nextStreak = prevStreak + 1;
      deviceNormalStreaks.set(device.id, nextStreak);

      if (nextStreak >= resolveCount) {
        await resolveOpenAlert({
          siteId,
          rule: 'device_offline',
          deviceId: device.id,
          now,
        });
      }
    }

    // Rule 5: Security: warning "New device joined" when is_known is false
    // Devices discovered in a site's first 10 minutes after agent registration are treated as known with no alert.
    // Devices appearing after that raise "New device joined" once, and are then marked known.
    if (!device.isKnown) {
      const withinInitialDiscoveryWindow =
        siteAgent &&
        new Date(device.firstSeenAt).getTime() - new Date(siteAgent.createdAt).getTime() <=
          tenMinutesMs;

      if (!withinInitialDiscoveryWindow) {
        await fireOrUpdateAlert({
          siteId,
          deviceId: device.id,
          category: 'security',
          severity: 'warning',
          rule: 'new_device',
          title: 'New device joined',
          reason: `${deviceName} (${device.ip}, ${device.mac}) joined this network`,
          now,
        });
      }

      // Mark device as known so it only alerts once (or silently becomes known in the first 10 minutes)
      await db
        .update(devices)
        .set({ isKnown: true })
        .where(eq(devices.id, device.id));
    }
  }
}

export async function evaluateAlertsForAllSites(): Promise<void> {
  try {
    const allSites = await db.select({ id: sites.id }).from(sites);
    for (const s of allSites) {
      await evaluateAlertsForSite(s.id);
    }
  } catch (err) {
    console.error('Error evaluating alerts for all sites:', err);
  }
}

// ---------------------------------------------------------------------------
// Dev-only 30-second sample generator
// Never runs when NODE_ENV is production
// ---------------------------------------------------------------------------
function randomFloat(min: number, max: number, decimals = 1): number {
  const val = Math.random() * (max - min) + min;
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export async function runDevSampleTick(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  try {
    const [sampleRow] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'sample_data'));

    const isSampleData = sampleRow ? Boolean(sampleRow.value) : false;
    if (!isSampleData) {
      return;
    }

    const allSites = await db.select().from(sites);
    const now = new Date();
    const isBandwidthTick = now.getMinutes() % 15 === 0 && now.getSeconds() < 30;

    for (const site of allSites) {
      const faultStatus = getSimulatedFaultStatus(site.id);
      const isPapatoetoe = site.name.toLowerCase().includes('papatoetoe');

      let latencyMs: number;
      let packetLossPct: number;
      let downloadMbps: number | null = null;
      let uploadMbps: number | null = null;

      if (faultStatus.active) {
        // Simulated fault: delay 330 ms and packet loss 20%
        latencyMs = 330;
        packetLossPct = 20;
      } else if (isPapatoetoe) {
        // Worse site but under the 100ms / 5% alert thresholds during normal operation
        latencyMs = randomFloat(42.0, 68.0);
        packetLossPct = randomFloat(0.8, 2.2);
        if (isBandwidthTick) {
          downloadMbps = randomFloat(85.0, 135.0);
          uploadMbps = randomFloat(20.0, 35.0);
        }
      } else {
        // Healthy site: latency 12 - 26 ms, loss 0%
        latencyMs = randomFloat(12.0, 26.0);
        packetLossPct = Math.random() < 0.9 ? 0.0 : 0.1;
        if (isBandwidthTick) {
          downloadMbps = randomFloat(210.0, 340.0);
          uploadMbps = randomFloat(55.0, 85.0);
        }
      }

      await db
        .insert(metricSamples)
        .values({
          siteId: site.id,
          measuredAt: now,
          latencyMs,
          packetLossPct,
          internetUp: true,
          downloadMbps,
          uploadMbps,
          errorRatePct: null,
        })
        .onConflictDoNothing({
          target: [metricSamples.siteId, metricSamples.measuredAt],
        });
    }
  } catch (err) {
    console.error('Error in dev sample generator tick:', err);
  }
}
