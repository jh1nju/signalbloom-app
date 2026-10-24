import { Router, Response } from 'express';
import { db } from '../db/index.ts';
import {
  alerts,
  auditLog,
  commands,
  devices,
  recommendations,
  sites,
} from '../db/schema.ts';
import { and, desc, eq } from 'drizzle-orm';
import { decodeAlertTitleAndReason } from '../services/alertEngine.ts';
import {
  AI_UNAVAILABLE_MESSAGE,
  buildBasicAlertExplanation,
  formatDeviceFriendlyName,
  FormattedRecommendation,
  getCommandNounLower,
  getCommandVerbLower,
  getOrGenerateAlertRecommendations,
  getSavedAlertRecommendations,
  resolveRecommendationTargetDevice,
} from '../services/geminiService.ts';
import { AuthenticatedRequest, requireAuth, requireAdmin } from './auth.ts';

export const alertsRouter = Router();

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function formatAlertRow(
  row: typeof alerts.$inferSelect,
  aiDetails?: {
    explanation: string | null;
    recommendations: FormattedRecommendation[];
    aiAvailable: boolean;
    basicExplanation?: string;
  }
) {
  const { title, reason } = decodeAlertTitleAndReason(row.rule, row.severity, row.reason);
  const basicExplanation =
    aiDetails?.basicExplanation ?? buildBasicAlertExplanation(row.rule, reason);
  return {
    id: row.id,
    siteId: row.siteId,
    deviceId: row.deviceId,
    category: row.category,
    severity: row.severity,
    rule: row.rule,
    title,
    reason,
    status: row.status,
    occurrenceCount: row.occurrenceCount,
    firstSeenAt: new Date(row.firstSeenAt).toISOString(),
    lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    explanation: aiDetails?.explanation ?? null,
    recommendations: aiDetails?.recommendations ?? [],
    aiAvailable: aiDetails?.aiAvailable ?? true,
    basicExplanation,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/sites/:siteId/alerts
// Returns site alerts along with saved explanations/recommendations and their live fix status.
alertsRouter.get(
  '/sites/:siteId/alerts',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
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
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const siteAlerts = await db
      .select()
      .from(alerts)
      .where(eq(alerts.siteId, siteId))
      .orderBy(desc(alerts.lastSeenAt));

    const openCriticalOrWarning = siteAlerts.filter(
      (a) => a.status === 'open' && (a.severity === 'critical' || a.severity === 'warning')
    );

    const aiDetailsByAlertId = new Map<
      string,
      {
        explanation: string | null;
        recommendations: FormattedRecommendation[];
        aiAvailable: boolean;
        basicExplanation: string;
      }
    >();

    let anyAiUnavailable = false;

    for (const row of openCriticalOrWarning) {
      const { reason } = decodeAlertTitleAndReason(row.rule, row.severity, row.reason);
      const savedResult = await getSavedAlertRecommendations({
        siteId,
        alertId: row.id,
        severity: row.severity,
        rule: row.rule,
        reason,
        deviceId: row.deviceId,
      });
      if (!savedResult.aiAvailable) {
        anyAiUnavailable = true;
      }
      aiDetailsByAlertId.set(row.id, savedResult);
    }

    const formatted = siteAlerts.map((row) =>
      formatAlertRow(row, aiDetailsByAlertId.get(row.id))
    );

    const sortCriticalFirst = (
      a: ReturnType<typeof formatAlertRow>,
      b: ReturnType<typeof formatAlertRow>
    ) => {
      const rankDiff = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    };

    const activeHealthAlerts = formatted
      .filter((a) => a.status === 'open' && a.category === 'health')
      .sort(sortCriticalFirst);

    const activeSecurityAlerts = formatted
      .filter((a) => a.status === 'open' && a.category === 'security')
      .sort(sortCriticalFirst);

    const resolvedSecurityAlerts = formatted
      .filter(
        (a) =>
          a.status === 'resolved' &&
          a.category === 'security' &&
          new Date(a.lastSeenAt).getTime() >= sevenDaysAgo.getTime()
      )
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

    return res.json({
      siteId,
      activeHealthAlerts,
      activeSecurityAlerts,
      resolvedSecurityAlerts,
      aiAvailable: !anyAiUnavailable,
      aiUnavailableMessage: anyAiUnavailable ? AI_UNAVAILABLE_MESSAGE : null,
      lastEvaluatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Failed to load site alerts:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Failed to load alerts for this site.',
      },
    });
  }
});

// POST /api/sites/:siteId/alerts/:alertId/explain
alertsRouter.post(
  '/sites/:siteId/alerts/:alertId/explain',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { siteId, alertId } = req.params;

    if (!siteId || !UUID_REGEX.test(siteId) || !alertId || !UUID_REGEX.test(alertId)) {
      return res.status(400).json({
        error: {
          code: 'invalid_parameters',
          message: 'Valid siteId and alertId are required.',
        },
      });
    }

    try {
      const [row] = await db
        .select()
        .from(alerts)
        .where(and(eq(alerts.id, alertId), eq(alerts.siteId, siteId)))
        .limit(1);

      if (!row) {
        return res.status(404).json({
          error: {
            code: 'alert_not_found',
            message: 'Alert not found for this site.',
          },
        });
      }

      const { title, reason } = decodeAlertTitleAndReason(row.rule, row.severity, row.reason);
      const aiResult = await getOrGenerateAlertRecommendations({
        siteId,
        alertId: row.id,
        severity: row.severity,
        rule: row.rule,
        title,
        reason,
        deviceId: row.deviceId,
      });

      return res.json({
        alertId: row.id,
        explanation: aiResult.explanation,
        recommendations: aiResult.recommendations,
        aiAvailable: aiResult.aiAvailable,
        basicExplanation: aiResult.basicExplanation,
        nextRetryAt: aiResult.nextRetryAt,
      });
    } catch (_err: any) {
      return res.status(200).json({
        alertId,
        explanation: null,
        recommendations: [],
        aiAvailable: false,
        basicExplanation: 'This usually means there is a temporary problem on the network.',
        nextRetryAt: Date.now() + 30000,
        error: {
          code: 'ai_unavailable',
          message: AI_UNAVAILABLE_MESSAGE,
        },
      });
    }
  }
);

// POST /api/sites/:siteId/recommendations/:recommendationId/approve (Admin only — returns 403 for staff)
// Creates a pending command for the recommendation's command_type and target_mac,
// prevents a second pending fix for the same device and type, and writes an audit_log row.
alertsRouter.post(
  '/sites/:siteId/recommendations/:recommendationId/approve',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const { siteId, recommendationId } = req.params;

    if (
      !siteId ||
      !UUID_REGEX.test(siteId) ||
      !recommendationId ||
      !UUID_REGEX.test(recommendationId)
    ) {
      return res.status(400).json({
        error: {
          code: 'invalid_parameters',
          message: 'Valid siteId and recommendationId are required.',
        },
      });
    }

    try {
      const [rec] = await db
        .select()
        .from(recommendations)
        .where(eq(recommendations.id, recommendationId))
        .limit(1);

      if (!rec) {
        return res.status(404).json({
          error: {
            code: 'recommendation_not_found',
            message: 'Recommendation not found.',
          },
        });
      }

      const [alertRow] = await db
        .select()
        .from(alerts)
        .where(and(eq(alerts.id, rec.alertId), eq(alerts.siteId, siteId)))
        .limit(1);

      if (!alertRow) {
        return res.status(404).json({
          error: {
            code: 'alert_not_found',
            message: 'Alert not found for this site.',
          },
        });
      }

      if (!rec.commandType) {
        return res.status(400).json({
          error: {
            code: 'no_command_type',
            message: 'This recommendation does not have an automated device fix.',
          },
        });
      }

      const siteDevices = await db.select().from(devices).where(eq(devices.siteId, siteId));

      const resolved = await resolveRecommendationTargetDevice({
        siteId,
        recommendationId: rec.id,
        actionText: rec.actionText,
        commandType: rec.commandType,
        alertDeviceId: alertRow.deviceId,
        siteDevices,
        existingCommandMac:
          typeof req.body?.target_mac === 'string' && req.body.target_mac.trim()
            ? req.body.target_mac.trim()
            : null,
      });

      const targetMac = resolved.targetMac;
      if (!targetMac) {
        return res.status(400).json({
          error: {
            code: 'missing_target_mac',
            message: 'No target device MAC address is available for this fix.',
          },
        });
      }

      const targetDeviceName =
        resolved.targetDeviceName || formatDeviceFriendlyName(null, targetMac);

      // Duplicate guard: never allow a second pending fix for the same device and type
      const existingSitePending = await db
        .select()
        .from(commands)
        .where(
          and(
            eq(commands.siteId, siteId),
            eq(commands.type, rec.commandType),
            eq(commands.status, 'pending')
          )
        );

      const duplicatePending = existingSitePending.find(
        (c) => c.targetMac.toLowerCase() === targetMac.toLowerCase()
      );

      if (duplicatePending) {
        return res.status(409).json({
          error: {
            code: 'duplicate_pending_fix',
            message: 'A pending fix of this type is already waiting for the agent on this device.',
          },
          command: {
            id: duplicatePending.id,
            type: duplicatePending.type,
            targetMac: duplicatePending.targetMac,
            status: duplicatePending.status,
            approvedAt: new Date(duplicatePending.approvedAt).toISOString(),
            finishedAt: duplicatePending.finishedAt
              ? new Date(duplicatePending.finishedAt).toISOString()
              : null,
            resultMessage: duplicatePending.resultMessage ?? null,
          },
        });
      }

      const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
      if (!site) {
        return res.status(404).json({
          error: { code: 'site_not_found', message: 'Site not found.' },
        });
      }

      const actingUser = req.authUser!;
      const approvedAt = new Date();

      const [createdCmd] = await db
        .insert(commands)
        .values({
          siteId,
          recommendationId: rec.id,
          type: rec.commandType,
          targetMac,
          status: 'pending',
          approvedByUserId: actingUser.id,
          approvedAt,
        })
        .returning();

      await db.insert(auditLog).values({
        organisationId: site.organisationId,
        siteId,
        actorType: 'user',
        actorId: actingUser.id,
        action: 'fix_approved',
        details: {
          recommendation_id: rec.id,
          alert_id: rec.alertId,
          command_id: createdCmd.id,
          command_type: rec.commandType,
          target_mac: targetMac,
          device_name: targetDeviceName,
          approved_at: approvedAt.toISOString(),
        },
      });

      return res.status(201).json({
        command: {
          id: createdCmd.id,
          type: createdCmd.type,
          targetMac: createdCmd.targetMac,
          status: createdCmd.status,
          approvedAt: new Date(createdCmd.approvedAt).toISOString(),
          finishedAt: null,
          resultMessage: null,
        },
        deviceName: targetDeviceName,
      });
    } catch (err: any) {
      console.error('Failed to approve fix:', err);
      return res.status(500).json({
        error: {
          code: 'server_error',
          message: 'Failed to approve fix.',
        },
      });
    }
  }
);

// POST /api/sites/:siteId/recommendations/:recommendationId/self-handle (Admin only — returns 403 for staff)
// Marks the recommendation as handled by the user ("I'll do it myself"), with no command created,
// and writes an audit_log row.
alertsRouter.post(
  '/sites/:siteId/recommendations/:recommendationId/self-handle',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const { siteId, recommendationId } = req.params;

    if (
      !siteId ||
      !UUID_REGEX.test(siteId) ||
      !recommendationId ||
      !UUID_REGEX.test(recommendationId)
    ) {
      return res.status(400).json({
        error: {
          code: 'invalid_parameters',
          message: 'Valid siteId and recommendationId are required.',
        },
      });
    }

    try {
      const [rec] = await db
        .select()
        .from(recommendations)
        .where(eq(recommendations.id, recommendationId))
        .limit(1);

      if (!rec) {
        return res.status(404).json({
          error: {
            code: 'recommendation_not_found',
            message: 'Recommendation not found.',
          },
        });
      }

      const [alertRow] = await db
        .select()
        .from(alerts)
        .where(and(eq(alerts.id, rec.alertId), eq(alerts.siteId, siteId)))
        .limit(1);

      if (!alertRow) {
        return res.status(404).json({
          error: {
            code: 'alert_not_found',
            message: 'Alert not found for this site.',
          },
        });
      }

      const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
      if (!site) {
        return res.status(404).json({
          error: { code: 'site_not_found', message: 'Site not found.' },
        });
      }

      const actingUser = req.authUser!;

      const siteDevices = await db.select().from(devices).where(eq(devices.siteId, siteId));
      const resolved = await resolveRecommendationTargetDevice({
        siteId,
        recommendationId: rec.id,
        actionText: rec.actionText,
        commandType: rec.commandType,
        alertDeviceId: alertRow.deviceId,
        siteDevices,
      });

      const targetMac = resolved.targetMac;
      const targetDeviceName =
        resolved.targetDeviceName ||
        (targetMac ? formatDeviceFriendlyName(null, targetMac) : 'device');

      const existingLogs = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.siteId, siteId), eq(auditLog.action, 'fix_self_handled')));

      const alreadyLogged = existingLogs.some((l) => {
        const d = (l.details || {}) as Record<string, any>;
        return d.recommendation_id === rec.id;
      });

      const handledAt = new Date();

      if (!alreadyLogged) {
        await db.insert(auditLog).values({
          organisationId: site.organisationId,
          siteId,
          actorType: 'user',
          actorId: actingUser.id,
          action: 'fix_self_handled',
          details: {
            recommendation_id: rec.id,
            alert_id: rec.alertId,
            command_type: rec.commandType,
            target_mac: targetMac,
            device_name: targetDeviceName,
            handled_at: handledAt.toISOString(),
          },
        });
      }

      return res.status(200).json({
        selfHandled: true,
        recommendationId: rec.id,
        handledAt: handledAt.toISOString(),
      });
    } catch (err: any) {
      console.error('Failed to mark recommendation as self-handled:', err);
      return res.status(500).json({
        error: {
          code: 'server_error',
          message: 'Failed to update recommendation.',
        },
      });
    }
  }
);

// GET /api/sites/:siteId/activity-log (Admin only — returns 403 for staff)
// Lists audit_log rows for the selected site, newest first, formatted in plain words.
alertsRouter.get(
  '/sites/:siteId/activity-log',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
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
    const [logs, siteDevices] = await Promise.all([
      db
        .select()
        .from(auditLog)
        .where(eq(auditLog.siteId, siteId))
        .orderBy(desc(auditLog.createdAt))
        .limit(100),
      db.select().from(devices).where(eq(devices.siteId, siteId)),
    ]);

    const items = logs.map((row) => {
      const details = (row.details || {}) as Record<string, any>;
      const commandType = details.command_type as string | undefined;
      const targetMac = details.target_mac as string | undefined;
      const matchedDev = targetMac
        ? siteDevices.find((d) => d.mac.toLowerCase() === targetMac.toLowerCase())
        : undefined;
      const deviceName =
        details.device_name ||
        (matchedDev
          ? formatDeviceFriendlyName(matchedDev.hostname, targetMac)
          : targetMac
            ? formatDeviceFriendlyName(null, targetMac)
            : 'device');

      const verbLower = getCommandVerbLower(commandType);
      const nounLower = getCommandNounLower(commandType);

      let plainText = '';
      let subText: string | null = null;

      if (row.action === 'fix_approved') {
        plainText = `Fix approved: ${verbLower} ${deviceName}`;
      } else if (row.action === 'fix_self_handled') {
        plainText = `I'll do it myself: ${verbLower} ${deviceName}`;
      } else if (row.action === 'command_result_reported') {
        if (details.status === 'failed') {
          plainText = `Agent: simulated ${nounLower} didn't work`;
        } else {
          plainText = `Agent: simulated ${nounLower} completed`;
        }
        if (typeof details.message === 'string' && details.message.trim()) {
          subText = details.message.trim();
        }
      } else {
        plainText = row.action.replace(/_/g, ' ');
      }

      return {
        id: row.id,
        siteId: row.siteId,
        actorType: row.actorType,
        action: row.action,
        plainText,
        subText,
        deviceName,
        commandType: commandType ?? null,
        status: details.status ?? null,
        createdAt: new Date(row.createdAt).toISOString(),
      };
    });

    return res.json({
      siteId,
      items,
    });
  } catch (err: any) {
    console.error('Failed to fetch activity log:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Failed to load activity log for this site.',
      },
    });
  }
});

