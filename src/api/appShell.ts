import { Router, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db/index.ts';
import {
  organisations,
  sites,
  settings,
  setupCodes,
  users,
  emailOutbox,
  alerts,
  agents,
  metricSamples,
} from '../db/schema.ts';
import { eq, and, isNull, sql, desc, asc, ne, or } from 'drizzle-orm';
import { AuthenticatedRequest, requireAuth, requireAdmin } from './auth.ts';

export const appShellRouter = Router();

function generateSetupCode(siteNameOrPrefix = 'NEW'): string {
  const cleanLetters = (siteNameOrPrefix || 'NEW').replace(/[^a-zA-Z]/g, '').toUpperCase();
  const prefix = (cleanLetters.slice(0, 3) || 'NEW').padEnd(3, 'X');
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let randomPart = '';
  for (let i = 0; i < 4; i++) {
    randomPart += chars[crypto.randomInt(0, chars.length)];
  }
  return `SB-${prefix}-${randomPart}`;
}

async function normalizeSitePlansAndDevSeed(): Promise<void> {
  const [org] = await db.select().from(organisations).limit(1);

  if (org && process.env.NODE_ENV !== 'production') {
    const [existingNoAgentSite] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.name, 'New Office (no agent)'))
      .limit(1);

    if (!existingNoAgentSite) {
      const [createdSite] = await db
        .insert(sites)
        .values({
          organisationId: org.id,
          name: 'New Office (no agent)',
          address: '42 Queen Street, Auckland CBD 1010',
          planName: 'SignalBloom Standard',
          monthlyPriceNzd: '29.00',
        })
        .returning();

      if (createdSite) {
        const code = generateSetupCode('NEW');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.insert(setupCodes).values({
          code,
          siteId: createdSite.id,
          expiresAt,
          usedAt: null,
        });
      }
    }
  }

  // Ensure all sites use plan 'SignalBloom Standard' at NZ$29 a month
  await db
    .update(sites)
    .set({
      planName: 'SignalBloom Standard',
      monthlyPriceNzd: '29.00',
    })
    .where(
      or(
        ne(sites.planName, 'SignalBloom Standard'),
        ne(sites.monthlyPriceNzd, '29.00')
      )
    );
}

export interface AdminSiteSummary {
  id: string;
  name: string;
  address: string;
  planName: string;
  monthlyPriceNzd: string;
  agentConnected: boolean;
  agentLastSeenAt: string | null;
  agentHostname: string | null;
  setupCode: string | null;
  setupCodeExpiresAt: string | null;
}

async function getAdminSitesWithStatus(): Promise<AdminSiteSummary[]> {
  await normalizeSitePlansAndDevSeed();

  const allSites = await db
    .select({
      id: sites.id,
      name: sites.name,
      address: sites.address,
      planName: sites.planName,
      monthlyPriceNzd: sites.monthlyPriceNzd,
    })
    .from(sites)
    .orderBy(sites.name);

  // Never select tokenHash from agents
  const allAgents = await db
    .select({
      id: agents.id,
      siteId: agents.siteId,
      hostname: agents.hostname,
      agentVersion: agents.agentVersion,
      lastSeenAt: agents.lastSeenAt,
    })
    .from(agents)
    .orderBy(desc(agents.lastSeenAt));

  const validCodes = await db
    .select({
      siteId: setupCodes.siteId,
      code: setupCodes.code,
      expiresAt: setupCodes.expiresAt,
    })
    .from(setupCodes)
    .where(
      and(
        isNull(setupCodes.usedAt),
        sql`${setupCodes.expiresAt} > NOW()`
      )
    )
    .orderBy(desc(setupCodes.expiresAt));

  const results: AdminSiteSummary[] = [];

  for (const s of allSites) {
    let siteAgent = allAgents.find((a) => a.siteId === s.id);

    // Check latest metric sample timestamp if present
    const [latestSample] = await db
      .select({ measuredAt: metricSamples.measuredAt })
      .from(metricSamples)
      .where(eq(metricSamples.siteId, s.id))
      .orderBy(desc(metricSamples.measuredAt))
      .limit(1);

    // In dev with sample data, if a clinic has metric readings but no agent row yet, register a dev agent record
    if (!siteAgent && latestSample && process.env.NODE_ENV !== 'production') {
      const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const seedTokenHash = crypto
        .createHash('sha256')
        .update(`seed-agent-${s.id}`)
        .digest('hex');

      const [insertedAgent] = await db
        .insert(agents)
        .values({
          siteId: s.id,
          tokenHash: seedTokenHash,
          hostname: `${slug}-probe`,
          agentVersion: '1.0.0',
          lastSeenAt: latestSample.measuredAt,
        })
        .returning({
          id: agents.id,
          siteId: agents.siteId,
          hostname: agents.hostname,
          agentVersion: agents.agentVersion,
          lastSeenAt: agents.lastSeenAt,
        });
      siteAgent = insertedAgent;
    }

    let validCode = validCodes.find((c) => c.siteId === s.id);
    if (!validCode && process.env.NODE_ENV !== 'production') {
      // Check if this site has never had a used setup code or needs an active code in dev
      const [usedCode] = await db
        .select({ code: setupCodes.code })
        .from(setupCodes)
        .where(eq(setupCodes.siteId, s.id))
        .limit(1);

      if (!usedCode) {
        const code = generateSetupCode(s.name);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.insert(setupCodes).values({
          code,
          siteId: s.id,
          expiresAt,
          usedAt: null,
        });
        validCode = { siteId: s.id, code, expiresAt };
      }
    }

    const agentConnected = Boolean(siteAgent);
    let lastSeenDate: Date | null = siteAgent ? new Date(siteAgent.lastSeenAt) : null;
    if (
      agentConnected &&
      latestSample?.measuredAt &&
      (!lastSeenDate || new Date(latestSample.measuredAt).getTime() > lastSeenDate.getTime())
    ) {
      lastSeenDate = new Date(latestSample.measuredAt);
    }

    results.push({
      id: s.id,
      name: s.name,
      address: s.address,
      planName: 'SignalBloom Standard',
      monthlyPriceNzd: '29.00',
      agentConnected,
      agentLastSeenAt: lastSeenDate ? lastSeenDate.toISOString() : null,
      agentHostname: siteAgent ? siteAgent.hostname : null,
      setupCode: validCode ? validCode.code : null,
      setupCodeExpiresAt: validCode ? new Date(validCode.expiresAt).toISOString() : null,
    });
  }

  return results;
}

// GET /api/app-shell
// Returns organisation info, list of sites, sample_data status, and authenticated user profile
appShellRouter.get('/app-shell', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const authUser = req.authUser!;
    const isAdmin = authUser.role === 'admin';

    await normalizeSitePlansAndDevSeed();

    const [org] = await db.select().from(organisations).limit(1);

    const allSites = await db
      .select({
        id: sites.id,
        name: sites.name,
        address: sites.address,
        planName: sites.planName,
        monthlyPriceNzd: sites.monthlyPriceNzd,
      })
      .from(sites)
      .orderBy(sites.name);

    const sanitizedSites = allSites.map((s) =>
      isAdmin
        ? {
            ...s,
            planName: 'SignalBloom Standard',
            monthlyPriceNzd: '29.00',
          }
        : {
            id: s.id,
            name: s.name,
            address: s.address,
          }
    );

    const [sampleSetting] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'sample_data'));

    const isSampleData = sampleSetting ? Boolean(sampleSetting.value) : false;

    return res.json({
      organisation: org
        ? { id: org.id, name: org.name }
        : { id: 'default', name: 'SignalBloom Network' },
      sites: sanitizedSites,
      sampleData: isSampleData,
      user: {
        id: authUser.id,
        name: authUser.name,
        email: authUser.email,
        role: authUser.role,
        firebaseUid: authUser.firebaseUid,
        emailAlerts: authUser.emailAlerts,
      },
    });
  } catch (err: any) {
    console.error('Failed to load app shell data:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Could not load organisation and sites.',
      },
    });
  }
});

// GET /api/sites (Admin only — returns 403 for staff)
// Lists each site with its agent status (Connected + lastSeenAt, or Not connected),
// setup code + expiry (never agent tokens), and SignalBloom Standard billing info.
appShellRouter.get(
  '/sites',
  requireAuth,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const siteSummaries = await getAdminSitesWithStatus();
      return res.json({
        sites: siteSummaries,
      });
    } catch (err: any) {
      console.error('Failed to load admin sites:', err);
      return res.status(500).json({
        error: {
          code: 'server_error',
          message: 'Could not load sites.',
        },
      });
    }
  }
);

// GET /api/setup-codes (Admin only — returns 403 for staff)
// Lists each site with its valid setup code and expiry (never agent tokens).
appShellRouter.get(
  '/setup-codes',
  requireAuth,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const siteSummaries = await getAdminSitesWithStatus();
      return res.json({
        setupCodes: siteSummaries.map((s) => ({
          siteId: s.id,
          siteName: s.name,
          siteAddress: s.address,
          code: s.setupCode,
          expiresAt: s.setupCodeExpiresAt,
        })),
      });
    } catch (err: any) {
      console.error('Failed to load setup codes:', err);
      return res.status(500).json({
        error: {
          code: 'server_error',
          message: 'Could not load setup codes.',
        },
      });
    }
  }
);

// GET /api/billing (Admin only — returns 403 for staff)
appShellRouter.get(
  '/billing',
  requireAuth,
  requireAdmin,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      await normalizeSitePlansAndDevSeed();

      const allSites = await db
        .select({
          id: sites.id,
          name: sites.name,
          address: sites.address,
          planName: sites.planName,
          monthlyPriceNzd: sites.monthlyPriceNzd,
        })
        .from(sites)
        .orderBy(sites.name);

      const normalizedSites = allSites.map((s) => ({
        ...s,
        planName: 'SignalBloom Standard',
        monthlyPriceNzd: '29.00',
        priceDisplay: 'NZ$29 a month',
      }));

      const totalMonthlyNzd = normalizedSites.length * 29;

      return res.json({
        currency: 'NZD',
        planName: 'SignalBloom Standard',
        pricePerSiteNzd: '29.00',
        label: 'Sample pricing, no payments in this prototype',
        totalMonthlyNzd: totalMonthlyNzd.toFixed(2),
        sites: normalizedSites,
      });
    } catch (err: any) {
      console.error('Failed to load billing:', err);
      return res.status(500).json({
        error: {
          code: 'server_error',
          message: 'Could not load billing details.',
        },
      });
    }
  }
);

// POST /api/sites (Admin only — returns 403 for staff)
// Creates a new site (name + address) with plan 'SignalBloom Standard' at NZ$29 a month
// and generates a fresh 24-hour setup code.
appShellRouter.post(
  '/sites',
  requireAuth,
  requireAdmin,
  async (req: AuthenticatedRequest, res: Response) => {
    const { name, address } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        error: {
          code: 'invalid_body',
          message: 'Site name is required.',
        },
      });
    }

    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({
        error: {
          code: 'invalid_body',
          message: 'Site address is required.',
        },
      });
    }

    try {
      const [org] = await db.select().from(organisations).limit(1);
      if (!org) {
        return res.status(400).json({
          error: { code: 'no_organisation', message: 'No organisation found.' },
        });
      }

      const [created] = await db
        .insert(sites)
        .values({
          organisationId: org.id,
          name: name.trim(),
          address: address.trim(),
          planName: 'SignalBloom Standard',
          monthlyPriceNzd: '29.00',
        })
        .returning();

      const code = generateSetupCode(created.name);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.insert(setupCodes).values({
        code,
        siteId: created.id,
        expiresAt,
        usedAt: null,
      });

      const expiresAtIso = expiresAt.toISOString();

      return res.status(201).json({
        site: {
          ...created,
          planName: 'SignalBloom Standard',
          monthlyPriceNzd: '29.00',
          agentConnected: false,
          agentLastSeenAt: null,
          agentHostname: null,
          setupCode: code,
          setupCodeExpiresAt: expiresAtIso,
        },
        setupCode: code,
        setupCodeExpiresAt: expiresAtIso,
      });
    } catch (err: any) {
      console.error('Failed to create site:', err);
      return res.status(500).json({
        error: {
          code: 'server_error',
          message: 'Could not create site.',
        },
      });
    }
  }
);

// GET /api/users and GET /api/users/email-alerts (Admin only — returns 403 for staff)
const handleGetOrganisationUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const authUser = req.authUser!;

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        emailAlerts: users.emailAlerts,
      })
      .from(users)
      .where(eq(users.organisationId, authUser.organisationId))
      .orderBy(asc(users.role), asc(users.name));

    return res.json({
      users: rows,
    });
  } catch (err: any) {
    console.error('Failed to load organisation users:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Could not load users.',
      },
    });
  }
};

appShellRouter.get('/users', requireAuth, requireAdmin, handleGetOrganisationUsers);
appShellRouter.get('/users/email-alerts', requireAuth, requireAdmin, handleGetOrganisationUsers);

// PATCH /api/users/:userId/email-alerts (Admin only — returns 403 for staff)
const handleUpdateUserEmailAlerts = async (req: AuthenticatedRequest, res: Response) => {
  const { userId } = req.params;
  const authUser = req.authUser!;

  const rawVal =
    req.body?.emailAlerts !== undefined ? req.body.emailAlerts : req.body?.email_alerts;

  if (typeof rawVal !== 'boolean') {
    return res.status(400).json({
      error: {
        code: 'invalid_body',
        message: 'A boolean emailAlerts value is required.',
      },
    });
  }

  try {
    const [targetUser] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.organisationId, authUser.organisationId)
        )
      )
      .limit(1);

    if (!targetUser) {
      return res.status(404).json({
        error: {
          code: 'user_not_found',
          message: 'User not found in this organisation.',
        },
      });
    }

    const [updated] = await db
      .update(users)
      .set({ emailAlerts: rawVal })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        emailAlerts: users.emailAlerts,
      });

    return res.json({
      user: updated,
    });
  } catch (err: any) {
    console.error('Failed to update email alerts preference:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Could not update email alerts preference.',
      },
    });
  }
};

appShellRouter.patch('/users/:userId/email-alerts', requireAuth, requireAdmin, handleUpdateUserEmailAlerts);
appShellRouter.post('/users/:userId/email-alerts', requireAuth, requireAdmin, handleUpdateUserEmailAlerts);

// GET /api/email-outbox (Admin only — returns 403 for staff)
// Lists all rows in email_outbox for the organisation, newest first, with recipient and site info.
const handleGetEmailOutbox = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const authUser = req.authUser!;

    const rows = await db
      .select({
        id: emailOutbox.id,
        userId: emailOutbox.userId,
        alertId: emailOutbox.alertId,
        subject: emailOutbox.subject,
        body: emailOutbox.body,
        status: emailOutbox.status,
        createdAt: emailOutbox.createdAt,
        sentAt: emailOutbox.sentAt,
        recipientName: users.name,
        recipientEmail: users.email,
        recipientRole: users.role,
        siteId: alerts.siteId,
        siteName: sites.name,
      })
      .from(emailOutbox)
      .innerJoin(users, eq(emailOutbox.userId, users.id))
      .leftJoin(alerts, eq(emailOutbox.alertId, alerts.id))
      .leftJoin(sites, eq(alerts.siteId, sites.id))
      .where(eq(users.organisationId, authUser.organisationId))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(100);

    const rawResendKey = process.env.RESEND_API_KEY?.trim() || '';
    const resendConfigured = Boolean(rawResendKey && rawResendKey !== 'MY_RESEND_API_KEY');

    return res.json({
      resendConfigured,
      outbox: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        alertId: r.alertId,
        subject: r.subject,
        body: r.body,
        status: r.status,
        createdAt: new Date(r.createdAt).toISOString(),
        sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null,
        recipientName: r.recipientName,
        recipientEmail: r.recipientEmail,
        recipientRole: r.recipientRole,
        siteId: r.siteId ?? null,
        siteName: r.siteName ?? null,
      })),
    });
  } catch (err: any) {
    console.error('Failed to load email outbox:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Could not load email outbox.',
      },
    });
  }
};

appShellRouter.get('/email-outbox', requireAuth, requireAdmin, handleGetEmailOutbox);
appShellRouter.get('/outbox', requireAuth, requireAdmin, handleGetEmailOutbox);
