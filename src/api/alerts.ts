import { Router, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { alerts } from '../db/schema.ts';
import { desc, eq } from 'drizzle-orm';
import { decodeAlertTitleAndReason } from '../services/alertEngine.ts';

export const alertsRouter = Router();

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function formatAlertRow(row: typeof alerts.$inferSelect) {
  const { title, reason } = decodeAlertTitleAndReason(row.rule, row.severity, row.reason);
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
  };
}

// GET /api/sites/:siteId/alerts
alertsRouter.get('/sites/:siteId/alerts', async (req: Request, res: Response) => {
  const { siteId } = req.params;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const siteAlerts = await db
      .select()
      .from(alerts)
      .where(eq(alerts.siteId, siteId))
      .orderBy(desc(alerts.lastSeenAt));

    const formatted = siteAlerts.map(formatAlertRow);

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
