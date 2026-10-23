import { Router, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { alerts } from '../db/schema.ts';
import { and, desc, eq } from 'drizzle-orm';
import { decodeAlertTitleAndReason } from '../services/alertEngine.ts';
import {
  AI_UNAVAILABLE_MESSAGE,
  buildBasicAlertExplanation,
  FormattedRecommendation,
  getOrGenerateAlertRecommendations,
  getSavedAlertRecommendations,
} from '../services/geminiService.ts';

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
// Returns site alerts along with any already-saved AI explanations from the recommendations table
// without triggering background Gemini generation.
alertsRouter.get('/sites/:siteId/alerts', async (req: Request, res: Response) => {
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
// Generates an AI explanation and up to 3 recommendations on-demand when an alert card
// is first shown on screen, saves them in the recommendations table, and reuses them thereafter.
alertsRouter.post(
  '/sites/:siteId/alerts/:alertId/explain',
  async (req: Request, res: Response) => {
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
    } catch (err: any) {
      console.error('Failed to generate alert explanation:', err);
      return res.status(500).json({
        error: {
          code: 'server_error',
          message: AI_UNAVAILABLE_MESSAGE,
        },
      });
    }
  }
);
