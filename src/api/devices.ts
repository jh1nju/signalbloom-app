import { Router, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { devices } from '../db/schema.ts';
import { eq, asc } from 'drizzle-orm';

export const devicesRouter = Router();

// GET /api/sites/:siteId/devices
devicesRouter.get('/sites/:siteId/devices', async (req: Request, res: Response) => {
  const { siteId } = req.params;

  try {
    const siteDevices = await db
      .select()
      .from(devices)
      .where(eq(devices.siteId, siteId))
      .orderBy(asc(devices.online), asc(devices.hostname));

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
