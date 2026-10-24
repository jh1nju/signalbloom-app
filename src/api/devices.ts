import { Router, Response } from 'express';
import { db } from '../db/index.ts';
import { devices, agents, metricSamples, setupCodes } from '../db/schema.ts';
import { eq, asc, and, isNull, sql, desc } from 'drizzle-orm';
import { AuthenticatedRequest, requireAuth } from './auth.ts';

export const devicesRouter = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/sites/:siteId/devices
devicesRouter.get(
  '/sites/:siteId/devices',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { siteId } = req.params;
    const isAdmin = req.authUser?.role === 'admin';

    if (!siteId || !UUID_REGEX.test(siteId)) {
      return res.status(400).json({
        error: {
          code: 'invalid_site_id',
          message: 'A valid site ID is required.',
        },
      });
    }

    try {
      const [[agentRow], [anySampleRow], [validCodeRow], siteDevices] = await Promise.all([
        db
          .select({ id: agents.id })
          .from(agents)
          .where(eq(agents.siteId, siteId))
          .limit(1),
        db
          .select({ id: metricSamples.id })
          .from(metricSamples)
          .where(eq(metricSamples.siteId, siteId))
          .limit(1),
        db
          .select({
            code: setupCodes.code,
            expiresAt: setupCodes.expiresAt,
          })
          .from(setupCodes)
          .where(
            and(
              eq(setupCodes.siteId, siteId),
              isNull(setupCodes.usedAt),
              sql`${setupCodes.expiresAt} > NOW()`
            )
          )
          .orderBy(desc(setupCodes.expiresAt))
          .limit(1),
        db
          .select()
          .from(devices)
          .where(eq(devices.siteId, siteId))
          .orderBy(asc(devices.online), asc(devices.hostname)),
      ]);

      const hasRegisteredAgent = Boolean(agentRow);
      const hasReadings = Boolean(anySampleRow);
      const setupCode = isAdmin && validCodeRow ? validCodeRow.code : null;
      const setupCodeExpiresAt =
        isAdmin && validCodeRow ? new Date(validCodeRow.expiresAt).toISOString() : null;

    const nowMs = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    // Normalize display name and sort: offline first, then case-insensitive by name
    const formatted = siteDevices
      .map((d) => {
        const rawHost = (d.hostname || '').trim();
        const displayName =
          !rawHost || rawHost.toLowerCase() === 'unknown' ? 'Unknown device' : rawHost;
        const firstSeenDate = new Date(d.firstSeenAt);
        const isNew = nowMs - firstSeenDate.getTime() <= twentyFourHoursMs;

        return {
          id: d.id,
          siteId: d.siteId,
          name: displayName,
          hostname: d.hostname,
          ip: d.ip,
          mac: d.mac,
          vendor: d.vendor,
          online: Boolean(d.online),
          isKnown: Boolean(d.isKnown),
          firstSeenAt: firstSeenDate.toISOString(),
          lastSeenAt: new Date(d.lastSeenAt).toISOString(),
          isNew,
        };
      })
      .sort((a, b) => {
        if (a.online !== b.online) {
          return a.online ? 1 : -1; // Offline (false) first
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

    const total = formatted.length;
    const onlineCount = formatted.filter((d) => d.online).length;
    const offlineCount = total - onlineCount;

    return res.json({
      siteId,
      hasRegisteredAgent,
      hasReadings,
      setupCode,
      setupCodeExpiresAt,
      summary: {
        total,
        online: onlineCount,
        offline: offlineCount,
      },
      devices: formatted,
      lastEvaluatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Failed to fetch site devices:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Failed to load devices for this site.',
      },
    });
  }
});
