import { Router, Request, Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { agents, auditLog, commands, devices, setupCodes, sites } from '../db/schema.ts';
import {
  clearSimulatedFaultOnApprovedFix,
  getAllSimulatedFaults,
  getSimulatedFaultStatus,
  startSimulatedFault,
} from '../services/alertEngine.ts';
import {
  formatDeviceFriendlyName,
  getCommandNounLower,
} from '../services/geminiService.ts';

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

// POST /api/dev/simulate-agent-result
// Finds the newest pending command: marks it sent, waits 3 seconds, then marks it succeeded
// with "Simulated restart of <device> completed." and writes the audit_log row,
// matching POST /api/agent/commands/:id/result.
devRouter.post('/simulate-agent-result', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      error: { code: 'not_found', message: 'Not available in production.' },
    });
  }

  try {
    const requestedSiteId = req.body?.site_id || req.body?.siteId;

    let pendingCmd: typeof commands.$inferSelect | undefined;

    if (requestedSiteId) {
      const [sitePending] = await db
        .select()
        .from(commands)
        .where(and(eq(commands.siteId, requestedSiteId), eq(commands.status, 'pending')))
        .orderBy(desc(commands.approvedAt))
        .limit(1);
      pendingCmd = sitePending;
    }

    if (!pendingCmd) {
      const [anyPending] = await db
        .select()
        .from(commands)
        .where(eq(commands.status, 'pending'))
        .orderBy(desc(commands.approvedAt))
        .limit(1);
      pendingCmd = anyPending;
    }

    if (!pendingCmd) {
      return res.status(404).json({
        error: {
          code: 'no_pending_command',
          message: 'No pending command found. Approve a fix on an alert card first.',
        },
      });
    }

    const [[site], [siteAgent], siteDevices] = await Promise.all([
      db.select().from(sites).where(eq(sites.id, pendingCmd.siteId)).limit(1),
      db.select().from(agents).where(eq(agents.siteId, pendingCmd.siteId)).limit(1),
      db.select().from(devices).where(eq(devices.siteId, pendingCmd.siteId)),
    ]);

    const matchedDev = siteDevices.find(
      (d) => d.mac.toLowerCase() === pendingCmd!.targetMac.toLowerCase()
    );
    const deviceName = formatDeviceFriendlyName(matchedDev?.hostname, pendingCmd.targetMac);
    const actionNoun = getCommandNounLower(pendingCmd.type);

    // 1. Mark command as 'sent'
    await db
      .update(commands)
      .set({ status: 'sent' })
      .where(eq(commands.id, pendingCmd.id));

    // 2. Wait 3 seconds
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 3. Mark command as 'succeeded' with "Simulated restart of <device> completed."
    const finishedTime = new Date();
    const resultMessage = `Simulated ${actionNoun} of ${deviceName} completed.`;

    await db
      .update(commands)
      .set({
        status: 'succeeded',
        finishedAt: finishedTime,
        resultMessage,
      })
      .where(eq(commands.id, pendingCmd.id));

    // 4. Write audit_log row, exactly as the agent's result endpoint would
    if (site) {
      await db.insert(auditLog).values({
        organisationId: site.organisationId,
        siteId: pendingCmd.siteId,
        actorType: 'agent',
        actorId: siteAgent?.id ?? null,
        action: 'command_result_reported',
        details: {
          command_id: pendingCmd.id,
          command_type: pendingCmd.type,
          target_mac: pendingCmd.targetMac,
          device_name: deviceName,
          status: 'succeeded',
          finished_at: finishedTime.toISOString(),
          message: resultMessage,
        },
      });
    }

    // 5. Turn off demo/simulated fault if active
    const demoFaultCleared = clearSimulatedFaultOnApprovedFix(pendingCmd.siteId);

    return res.status(200).json({
      recorded: true,
      demo_fault_cleared: demoFaultCleared,
      simulated_result: {
        command_id: pendingCmd.id,
        site_id: pendingCmd.siteId,
        site_name: site?.name ?? null,
        command_type: pendingCmd.type,
        target_mac: pendingCmd.targetMac,
        device_name: deviceName,
        status: 'succeeded',
        finished_at: finishedTime.toISOString(),
        message: resultMessage,
      },
    });
  } catch (err: any) {
    console.error('Failed to simulate agent result:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: err.message || 'Could not simulate agent result.',
      },
    });
  }
});

