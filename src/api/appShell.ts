import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db/index.ts';
import { organisations, sites, settings, setupCodes } from '../db/schema.ts';
import { eq, and, isNull, sql } from 'drizzle-orm';

export const appShellRouter = Router();

function generateSetupCode(prefix = 'NEW'): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let randomPart = '';
  for (let i = 0; i < 4; i++) {
    randomPart += chars[crypto.randomInt(0, chars.length)];
  }
  return `SB-${prefix.toUpperCase()}-${randomPart}`;
}

// GET /api/app-shell
// Returns organisation info, list of sites, and sample_data status
appShellRouter.get('/app-shell', async (_req: Request, res: Response) => {
  try {
    // 1. Fetch organisation (fallback to default if none)
    const [org] = await db.select().from(organisations).limit(1);

    // Ensure the 4th seed site 'New Office (no agent)' exists in development
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
            planName: 'Pro',
            monthlyPriceNzd: '149.00',
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
      } else {
        // Ensure it has a valid unused setup code if no agent is registered yet
        const [activeCode] = await db
          .select({ code: setupCodes.code })
          .from(setupCodes)
          .where(
            and(
              eq(setupCodes.siteId, existingNoAgentSite.id),
              isNull(setupCodes.usedAt),
              sql`${setupCodes.expiresAt} > NOW()`
            )
          )
          .limit(1);

        if (!activeCode) {
          const [anyCode] = await db
            .select({ code: setupCodes.code })
            .from(setupCodes)
            .where(eq(setupCodes.siteId, existingNoAgentSite.id))
            .limit(1);

          if (!anyCode) {
            const code = generateSetupCode('NEW');
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await db.insert(setupCodes).values({
              code,
              siteId: existingNoAgentSite.id,
              expiresAt,
              usedAt: null,
            });
          }
        }
      }
    }

    // 2. Fetch all sites
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

    // 3. Fetch sample_data setting
    const [sampleSetting] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'sample_data'));

    const isSampleData = sampleSetting ? Boolean(sampleSetting.value) : false;

    return res.json({
      organisation: org ? { id: org.id, name: org.name } : { id: 'default', name: 'SignalBloom Network' },
      sites: allSites,
      sampleData: isSampleData,
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
