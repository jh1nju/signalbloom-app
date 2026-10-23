import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  setupCodes,
  agents,
  sites,
  metricSamples,
  devices,
  commands,
  auditLog,
} from '../db/schema.ts';
import { formatDeviceFriendlyName } from '../services/geminiService.ts';

export const agentRouter = Router();

// Standard API Error Helper matching docs/API.md
function apiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({
    error: {
      code,
      message,
    },
  });
}

export interface AuthenticatedAgentRequest extends Request {
  agent?: {
    id: string;
    siteId: string;
    hostname: string;
    agentVersion: string;
    createdAt: Date;
  };
}

// Bearer Token Auth Middleware
export async function requireAgentAuth(
  req: AuthenticatedAgentRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return apiError(res, 401, 'invalid_token', 'Site token is missing or not valid.');
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return apiError(res, 401, 'invalid_token', 'Site token is missing or not valid.');
  }

  // Hash the incoming bearer token using SHA-256
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  try {
    const [agent] = await db
      .select({
        id: agents.id,
        siteId: agents.siteId,
        hostname: agents.hostname,
        agentVersion: agents.agentVersion,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.tokenHash, tokenHash));

    if (!agent) {
      return apiError(res, 401, 'invalid_token', 'Site token is missing or not valid.');
    }

    req.agent = agent;
    next();
  } catch (err: any) {
    console.error('Agent auth lookup failed:', err);
    return apiError(res, 401, 'invalid_token', 'Site token is missing or not valid.');
  }
}

// ---------------------------------------------------------------------------
// 1. POST /api/agent/register
// ---------------------------------------------------------------------------
agentRouter.post('/agent/register', async (req: Request, res: Response) => {
  const { setup_code, agent_version, hostname } = req.body || {};

  if (!setup_code || typeof setup_code !== 'string' || !agent_version || !hostname) {
    return apiError(
      res,
      400,
      'invalid_body',
      'Missing required fields: setup_code, agent_version, hostname.'
    );
  }

  try {
    const trimmedCode = setup_code.trim();
    const [codeRecord] = await db
      .select()
      .from(setupCodes)
      .where(eq(setupCodes.code, trimmedCode));

    if (!codeRecord) {
      return apiError(res, 404, 'code_not_found', 'Setup code does not exist.');
    }

    const now = new Date();
    if (codeRecord.usedAt !== null || new Date(codeRecord.expiresAt) <= now) {
      return apiError(
        res,
        410,
        'code_used_or_expired',
        'Setup code has already been used or has expired.'
      );
    }

    // Mark the setup code as used
    await db
      .update(setupCodes)
      .set({ usedAt: now })
      .where(eq(setupCodes.code, trimmedCode));

    // Generate a random 32-byte cryptographically secure token
    const rawTokenBytes = crypto.randomBytes(32).toString('hex');
    const siteToken = `sbt_live_${rawTokenBytes}`;
    const tokenHash = crypto.createHash('sha256').update(siteToken).digest('hex');

    // Create the agent record in the agents table
    await db.insert(agents).values({
      siteId: codeRecord.siteId,
      tokenHash,
      hostname: String(hostname).trim(),
      agentVersion: String(agent_version).trim(),
      lastSeenAt: now,
    });

    return res.status(201).json({
      site_id: codeRecord.siteId,
      site_token: siteToken,
      interval_seconds: 30,
      bandwidth_interval_seconds: 900,
    });
  } catch (err: any) {
    console.error('Registration failed:', err);
    return apiError(res, 500, 'server_error', 'An unexpected error occurred during registration.');
  }
});

// ---------------------------------------------------------------------------
// 2. POST /api/ingest
// ---------------------------------------------------------------------------
agentRouter.post(
  '/ingest',
  requireAgentAuth,
  async (req: AuthenticatedAgentRequest, res: Response) => {
    const agent = req.agent!;
    const { site_id, readings, devices: incomingDevices } = req.body || {};

    if (!site_id || typeof site_id !== 'string') {
      return apiError(res, 400, 'invalid_body', 'Request body is invalid.');
    }

    // Token belongs to another site check
    if (site_id !== agent.siteId) {
      return apiError(res, 403, 'site_mismatch', 'Site token belongs to another site.');
    }

    const readingsList = Array.isArray(readings) ? readings : [];
    if (readingsList.length > 500) {
      return apiError(res, 413, 'too_many_readings', 'Maximum 500 readings per request.');
    }

    try {
      const now = new Date();
      let acceptedCount = 0;
      let duplicateCount = 0;

      // 1. Process readings (skip duplicates for same site and measured_at)
      for (const r of readingsList) {
        if (!r.measured_at || r.latency_ms === undefined || r.packet_loss_pct === undefined) {
          continue;
        }

        const measuredAt = new Date(r.measured_at);
        const insertRes = await db
          .insert(metricSamples)
          .values({
            siteId: agent.siteId,
            measuredAt,
            latencyMs: Number(r.latency_ms),
            packetLossPct: Number(r.packet_loss_pct),
            internetUp: Boolean(r.internet_up),
            downloadMbps:
              r.download_mbps !== null && r.download_mbps !== undefined
                ? Number(r.download_mbps)
                : null,
            uploadMbps:
              r.upload_mbps !== null && r.upload_mbps !== undefined
                ? Number(r.upload_mbps)
                : null,
            errorRatePct:
              r.error_rate_pct !== null && r.error_rate_pct !== undefined
                ? Number(r.error_rate_pct)
                : null,
          })
          .onConflictDoNothing({
            target: [metricSamples.siteId, metricSamples.measuredAt],
          })
          .returning({ id: metricSamples.id });

        if (insertRes.length > 0) {
          acceptedCount++;
        } else {
          duplicateCount++;
        }
      }

      // 2. Upsert devices on (site_id, mac)
      // Devices found in a site's first 10 minutes after registration are treated as known with no alert.
      const tenMinutesMs = 10 * 60 * 1000;
      const isInitialDiscoveryWindow =
        now.getTime() - new Date(agent.createdAt).getTime() <= tenMinutesMs;

      const devicesList = Array.isArray(incomingDevices) ? incomingDevices : [];
      for (const d of devicesList) {
        if (!d.mac || !d.ip) continue;

        await db
          .insert(devices)
          .values({
            siteId: agent.siteId,
            mac: String(d.mac).trim(),
            ip: String(d.ip).trim(),
            hostname: String(d.hostname || 'unknown').trim(),
            vendor: String(d.vendor || 'Unknown').trim(),
            online: Boolean(d.online),
            isKnown: isInitialDiscoveryWindow,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .onConflictDoUpdate({
            target: [devices.siteId, devices.mac],
            set: {
              ip: String(d.ip).trim(),
              hostname: String(d.hostname || 'unknown').trim(),
              vendor: String(d.vendor || 'Unknown').trim(),
              online: Boolean(d.online),
              lastSeenAt: now,
            },
          });
      }

      // 3. Update agent's lastSeenAt
      await db
        .update(agents)
        .set({ lastSeenAt: now })
        .where(eq(agents.id, agent.id));

      return res.status(202).json({
        accepted: acceptedCount,
        duplicates: duplicateCount,
      });
    } catch (err: any) {
      console.error('Ingest failed:', err);
      return apiError(res, 500, 'server_error', 'An error occurred processing ingest data.');
    }
  }
);

// ---------------------------------------------------------------------------
// 3. GET /api/agent/commands
// ---------------------------------------------------------------------------
agentRouter.get(
  '/agent/commands',
  requireAgentAuth,
  async (req: AuthenticatedAgentRequest, res: Response) => {
    const agent = req.agent!;

    try {
      // Find pending commands for the agent's site
      const pendingList = await db
        .select()
        .from(commands)
        .where(and(eq(commands.siteId, agent.siteId), eq(commands.status, 'pending')));

      // Mark returned commands as 'sent'
      const formattedCommands = [];
      for (const cmd of pendingList) {
        await db
          .update(commands)
          .set({ status: 'sent' })
          .where(eq(commands.id, cmd.id));

        formattedCommands.push({
          id: cmd.id,
          type: cmd.type,
          target: { mac: cmd.targetMac },
          approved_at: new Date(cmd.approvedAt).toISOString(),
          simulated: true,
        });
      }

      return res.status(200).json({
        commands: formattedCommands,
      });
    } catch (err: any) {
      console.error('Fetching agent commands failed:', err);
      return apiError(res, 500, 'server_error', 'Failed to retrieve commands.');
    }
  }
);

// ---------------------------------------------------------------------------
// 4. POST /api/agent/commands/:id/result
// ---------------------------------------------------------------------------
agentRouter.post(
  '/agent/commands/:id/result',
  requireAgentAuth,
  async (req: AuthenticatedAgentRequest, res: Response) => {
    const agent = req.agent!;
    const commandId = req.params.id;
    const { status, finished_at, message } = req.body || {};

    if (!status || (status !== 'succeeded' && status !== 'failed')) {
      return apiError(res, 400, 'invalid_body', "Status must be 'succeeded' or 'failed'.");
    }

    try {
      // Verify command exists and belongs to this site
      const [cmd] = await db
        .select()
        .from(commands)
        .where(eq(commands.id, commandId));

      if (!cmd || cmd.siteId !== agent.siteId) {
        return apiError(res, 404, 'command_not_found', 'Command not found.');
      }

      // Check if result has already been recorded
      if (cmd.status === 'succeeded' || cmd.status === 'failed') {
        return apiError(
          res,
          409,
          'result_already_recorded',
          'Result for this command has already been recorded.'
        );
      }

      const finishedTime = finished_at ? new Date(finished_at) : new Date();

      // Update command record
      await db
        .update(commands)
        .set({
          status,
          finishedAt: finishedTime,
          resultMessage: message ? String(message) : null,
        })
        .where(eq(commands.id, commandId));

      // Fetch site and device to obtain organisationId and friendly device name for audit_log
      const [[site], siteDevices] = await Promise.all([
        db
          .select({ organisationId: sites.organisationId })
          .from(sites)
          .where(eq(sites.id, agent.siteId)),
        db.select().from(devices).where(eq(devices.siteId, agent.siteId)),
      ]);

      const matchedDev = siteDevices.find(
        (d) => d.mac.toLowerCase() === cmd.targetMac.toLowerCase()
      );
      const deviceName = formatDeviceFriendlyName(matchedDev?.hostname, cmd.targetMac);

      if (site) {
        await db.insert(auditLog).values({
          organisationId: site.organisationId,
          siteId: agent.siteId,
          actorType: 'agent',
          actorId: agent.id,
          action: 'command_result_reported',
          details: {
            command_id: commandId,
            command_type: cmd.type,
            target_mac: cmd.targetMac,
            device_name: deviceName,
            status,
            finished_at: finishedTime.toISOString(),
            message: message || null,
          },
        });
      }

      return res.status(200).json({ recorded: true });
    } catch (err: any) {
      console.error('Recording command result failed:', err);
      return apiError(res, 500, 'server_error', 'Failed to record command result.');
    }
  }
);
