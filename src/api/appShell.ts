import { Router, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { organisations, sites, settings } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

export const appShellRouter = Router();

// GET /api/app-shell
// Returns organisation info, list of sites, and sample_data status
appShellRouter.get('/app-shell', async (req: Request, res: Response) => {
  try {
    // 1. Fetch organisation (fallback to default if none)
    const [org] = await db.select().from(organisations).limit(1);

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
