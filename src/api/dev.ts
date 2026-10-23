import { Router, Request, Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { setupCodes, sites } from '../db/schema.ts';
import {
  getAllSimulatedFaults,
  getSimulatedFaultStatus,
  startSimulatedFault,
} from '../services/alertEngine.ts';

export const devRouter = Router();

// GET /api/dev/available-codes
devRouter.get('/available-codes', async (_req: Request, res: Response) => {
  try {
    const codes = await db
      .select({
        code: setupCodes.code,
        siteId: setupCodes.siteId,
        expiresAt: setupCodes.expiresAt,
        usedAt: setupCodes.usedAt,
      })
      .from(setupCodes)
      .where(and(sql`${setupCodes.usedAt} IS NULL`, sql`${setupCodes.expiresAt} > NOW()`));

    return res.json({ codes });
  } catch (err: any) {
    return res.status(500).json({ error: { code: 'server_error', message: err.message } });
  }
});

// POST /api/dev/simulate-fault
devRouter.post('/simulate-fault', async (req: Request, res: Response) => {
  try {
    let siteId = req.body?.site_id || req.body?.siteId;
    if (!siteId) {
      const [firstSite] = await db.select().from(sites).limit(1);
      if (!firstSite) {
        return res.status(400).json({
          error: { code: 'no_site', message: 'No sites found in database.' },
        });
      }
      siteId = firstSite.id;
    }

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (!site) {
      return res.status(404).json({
        error: { code: 'site_not_found', message: 'Selected site was not found.' },
      });
    }

    const result = await startSimulatedFault(site.id);

    return res.status(200).json({
      simulated_fault: {
        site_id: result.siteId,
        site_name: site.name,
        active: result.active,
        delay_ms: result.delayMs,
        packet_loss_pct: result.packetLossPct,
        duration_seconds: result.durationSeconds,
        expires_at: result.expiresAt,
        message: `Simulating fault for ${site.name}: delay 330 ms and packet loss 20% for the next 3 minutes, then returning to normal automatically.`,
      },
    });
  } catch (err: any) {
    console.error('Failed to start simulated fault:', err);
    return res.status(500).json({
      error: { code: 'server_error', message: err.message || 'Could not start fault simulation.' },
    });
  }
});

// GET /api/dev/simulate-fault
devRouter.get('/simulate-fault', async (req: Request, res: Response) => {
  const siteId = req.query.site_id as string | undefined;
  if (siteId) {
    return res.json({ status: getSimulatedFaultStatus(siteId) });
  }
  return res.json({ faults: getAllSimulatedFaults() });
});
