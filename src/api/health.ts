import { Router, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { metricSamples, devices, settings } from '../db/schema.ts';
import { eq, and, sql, desc, gte } from 'drizzle-orm';

export const healthRouter = Router();

interface MetricLimit {
  full: number;
  zero: number;
}

interface HealthLimits {
  uptime: MetricLimit;
  latency: MetricLimit;
  packet_loss: MetricLimit;
  speed: MetricLimit;
  devices: MetricLimit;
}

interface HealthWeights {
  uptime: number;
  latency: number;
  packet_loss: number;
  speed: number;
  devices: number;
}

const DEFAULT_WEIGHTS: HealthWeights = {
  uptime: 30,
  latency: 25,
  packet_loss: 20,
  speed: 15,
  devices: 10,
};

const DEFAULT_LIMITS: HealthLimits = {
  uptime: { full: 100, zero: 90 },
  latency: { full: 30, zero: 200 },
  packet_loss: { full: 0, zero: 10 },
  speed: { full: 100, zero: 5 },
  devices: { full: 100, zero: 50 },
};

function calculateScore(val: number, limit: MetricLimit, higherIsBetter: boolean): number {
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/sites/:siteId/health
healthRouter.get('/sites/:siteId/health', async (req: Request, res: Response) => {
  const { siteId } = req.params;

  if (!siteId || !UUID_REGEX.test(siteId)) {
    return res.status(400).json({
      error: {
        code: 'invalid_site_id',
        message: 'A valid site ID is required.',
      },
    });
  }

  try {
    let weights = DEFAULT_WEIGHTS;
    let limits = DEFAULT_LIMITS;

    const [weightsRow] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'health_weights'));

    if (weightsRow && typeof weightsRow.value === 'object') {
      weights = { ...DEFAULT_WEIGHTS, ...(weightsRow.value as any) };
    } else {
      await db
        .insert(settings)
        .values({ key: 'health_weights', value: DEFAULT_WEIGHTS })
        .onConflictDoUpdate({ target: settings.key, set: { value: DEFAULT_WEIGHTS } });
    }

    const [limitsRow] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'health_limits'));

    if (limitsRow && typeof limitsRow.value === 'object') {
      limits = { ...DEFAULT_LIMITS, ...(limitsRow.value as any) };
    } else {
      await db
        .insert(settings)
        .values({ key: 'health_limits', value: DEFAULT_LIMITS })
        .onConflictDoUpdate({ target: settings.key, set: { value: DEFAULT_LIMITS } });
    }

    const [windowRow] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'score_window_minutes'));

    let scoreWindowMinutes = 5;
    if (windowRow && windowRow.value !== null && windowRow.value !== undefined) {
      const parsed =
        typeof windowRow.value === 'number'
          ? windowRow.value
          : typeof windowRow.value === 'object' && 'minutes' in (windowRow.value as any)
            ? Number((windowRow.value as any).minutes)
            : Number(windowRow.value);
      if (!isNaN(parsed) && parsed > 0) {
        scoreWindowMinutes = parsed;
      }
    } else {
      await db
        .insert(settings)
        .values({ key: 'score_window_minutes', value: 5 })
        .onConflictDoUpdate({ target: settings.key, set: { value: 5 } });
    }

    const windowStart = new Date(Date.now() - scoreWindowMinutes * 60 * 1000);
    let recentSamples = await db
      .select()
      .from(metricSamples)
      .where(
        and(
          eq(metricSamples.siteId, siteId),
          gte(metricSamples.measuredAt, windowStart)
        )
      )
      .orderBy(desc(metricSamples.measuredAt));

    // Fallback if no samples in the window (e.g. dev environment idle): use most recent samples for window
    if (recentSamples.length === 0) {
      const fallbackLimit = Math.max(1, Math.round(scoreWindowMinutes * 2));
      recentSamples = await db
        .select()
        .from(metricSamples)
        .where(eq(metricSamples.siteId, siteId))
        .orderBy(desc(metricSamples.measuredAt))
        .limit(fallbackLimit);
    }

    const currentDevices = await db
      .select()
      .from(devices)
      .where(eq(devices.siteId, siteId));

    interface PartResult {
      key: string;
      label: string;
      technicalTerm: string;
      valueFormatted: string;
      rawVal: number;
      score: number;
      weight: number;
    }

    const evaluatedParts: PartResult[] = [];

    // Part 1: Internet uptime
    if (recentSamples.length > 0) {
      const upCount = recentSamples.filter((s) => s.internetUp).length;
      const uptimePct = (upCount / recentSamples.length) * 100;
      const score = calculateScore(uptimePct, limits.uptime, true);
      const uptimeFormatted = uptimePct >= 99.95 ? '100% online' : `${uptimePct.toFixed(1)}% online`;

      evaluatedParts.push({
        key: 'uptime',
        label: 'Internet uptime',
        technicalTerm: 'How often your internet connection was working.',
        valueFormatted: uptimeFormatted,
        rawVal: uptimePct,
        score,
        weight: Number(weights.uptime) || 30,
      });
    }

    // Part 2: Delay
    if (recentSamples.length > 0) {
      const avgLatency =
        recentSamples.reduce((acc, s) => acc + s.latencyMs, 0) / recentSamples.length;
      const score = calculateScore(avgLatency, limits.latency, false);
      evaluatedParts.push({
        key: 'latency',
        label: 'Delay',
        technicalTerm: 'Latency: how long data takes to reach the internet, in milliseconds.',
        valueFormatted: `${avgLatency.toFixed(1)} ms`,
        rawVal: avgLatency,
        score,
        weight: Number(weights.latency) || 25,
      });
    }

    // Part 3: Packet loss
    if (recentSamples.length > 0) {
      const avgLoss =
        recentSamples.reduce((acc, s) => acc + s.packetLossPct, 0) / recentSamples.length;
      const score = calculateScore(avgLoss, limits.packet_loss, false);
      evaluatedParts.push({
        key: 'packet_loss',
        label: 'Packet loss',
        technicalTerm: "The share of data that didn't arrive and had to be resent.",
        valueFormatted: `${avgLoss.toFixed(1)}%`,
        rawVal: avgLoss,
        score,
        weight: Number(weights.packet_loss) || 20,
      });
    }

    // Part 4: Internet speed
    const [latestSpeedSample] = await db
      .select({ downloadMbps: metricSamples.downloadMbps, measuredAt: metricSamples.measuredAt })
      .from(metricSamples)
      .where(
        and(
          eq(metricSamples.siteId, siteId),
          sql`${metricSamples.downloadMbps} IS NOT NULL`
        )
      )
      .orderBy(desc(metricSamples.measuredAt))
      .limit(1);

    if (latestSpeedSample && latestSpeedSample.downloadMbps !== null) {
      const speedMbps = latestSpeedSample.downloadMbps;
      const score = calculateScore(speedMbps, limits.speed, true);
      evaluatedParts.push({
        key: 'speed',
        label: 'Internet speed',
        technicalTerm: 'Download speed, in megabits per second (Mbps).',
        valueFormatted: `${speedMbps.toFixed(0)} Mbps`,
        rawVal: speedMbps,
        score,
        weight: Number(weights.speed) || 15,
      });
    }

    // Part 5: Devices online
    if (currentDevices.length > 0) {
      const onlineCount = currentDevices.filter((d) => d.online).length;
      const onlinePct = (onlineCount / currentDevices.length) * 100;
      const score = calculateScore(onlinePct, limits.devices, true);
      evaluatedParts.push({
        key: 'devices',
        label: 'Devices online',
        technicalTerm: "How many of this site's known devices are connected right now.",
        valueFormatted: `${onlineCount} of ${currentDevices.length} online`,
        rawVal: onlinePct,
        score,
        weight: Number(weights.devices) || 10,
      });
    }

    // Combine scores with remaining weights
    let overallScore = 100;
    const totalAvailableWeight = evaluatedParts.reduce((acc, p) => acc + p.weight, 0);

    if (totalAvailableWeight > 0) {
      const weightedSum = evaluatedParts.reduce((acc, p) => acc + p.score * p.weight, 0);
      overallScore = Math.max(0, Math.min(100, Math.round(weightedSum / totalAvailableWeight)));
    }

    // Traffic-light classification
    let statusWord: 'Healthy' | 'Needs attention' | 'Problem' = 'Healthy';
    let statusColor: 'green' | 'amber' | 'red' = 'green';

    if (overallScore >= 80) {
      statusWord = 'Healthy';
      statusColor = 'green';
    } else if (overallScore >= 50) {
      statusWord = 'Needs attention';
      statusColor = 'amber';
    } else {
      statusWord = 'Problem';
      statusColor = 'red';
    }

    // Sort parts: lowest score first
    const partsLowestFirst = [...evaluatedParts].sort((a, b) => a.score - b.score);

    // 24-hour historical telemetry for charts
    const rawChartData = await db
      .select({
        measuredAt: metricSamples.measuredAt,
        latencyMs: metricSamples.latencyMs,
        packetLossPct: metricSamples.packetLossPct,
        internetUp: metricSamples.internetUp,
        downloadMbps: metricSamples.downloadMbps,
        uploadMbps: metricSamples.uploadMbps,
      })
      .from(metricSamples)
      .where(
        and(
          eq(metricSamples.siteId, siteId),
          sql`${metricSamples.measuredAt} >= NOW() - INTERVAL '24 hours'`
        )
      )
      .orderBy(metricSamples.measuredAt);

    const chartStep = Math.max(1, Math.floor(rawChartData.length / 144));
    const sampledChartData = [];
    for (let i = 0; i < rawChartData.length; i += chartStep) {
      sampledChartData.push(rawChartData[i]);
    }

    const bandwidthPoints = rawChartData
      .filter((d) => d.downloadMbps !== null && !isNaN(Number(d.downloadMbps)))
      .map((d) => ({
        time: d.measuredAt.toISOString(),
        download: Number(d.downloadMbps),
        upload: d.uploadMbps !== null ? Number(d.uploadMbps) : null,
      }));

    return res.json({
      siteId,
      score: overallScore,
      statusWord,
      statusColor,
      scoreWindowMinutes,
      parts: partsLowestFirst,
      weights,
      limits,
      lastEvaluatedAt: new Date().toISOString(),
      sampleCount: recentSamples.length,
      charts: {
        telemetry: sampledChartData.map((d) => ({
          time: d.measuredAt.toISOString(),
          latency: d.latencyMs,
          loss: d.packetLossPct,
          up: d.internetUp,
        })),
        bandwidth: bandwidthPoints,
      },
    });
  } catch (err: any) {
    console.error('Failed to calculate site health:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Failed to calculate network health score.',
      },
    });
  }
});
