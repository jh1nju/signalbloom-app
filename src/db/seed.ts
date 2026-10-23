/**
 * Development Seed Script for SignalBloom
 *
 * Populates test organisation, sites, users, and generates one-time
 * setup codes for agent pairing that expire in 7 days.
 *
 * FOR DEVELOPMENT USE ONLY - WILL NOT RUN IN PRODUCTION.
 */

import { db, createPool } from './index.ts';
import { organisations, sites, users, setupCodes } from './schema.ts';
import { eq, and, isNull } from 'drizzle-orm';
import crypto from 'crypto';

// Strict production guard
if (process.env.NODE_ENV === 'production') {
  console.error('FATAL: Attempted to run development seed in production! Aborting.');
  process.exit(1);
}

function generateSetupCode(prefix: string): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // excludes ambiguous chars 0, 1, I, O
  let randomPart = '';
  for (let i = 0; i < 4; i++) {
    randomPart += chars[crypto.randomInt(0, chars.length)];
  }
  return `SB-${prefix.toUpperCase()}-${randomPart}`;
}

async function runSeed() {
  console.log('🌱 Starting SignalBloom development database seed...\n');

  // 1. Create or get Organisation: "Demo Dental Group"
  let [org] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.name, 'Demo Dental Group'));

  if (!org) {
    [org] = await db
      .insert(organisations)
      .values({
        name: 'Demo Dental Group',
      })
      .returning();
    console.log(`✓ Created Organisation: "${org.name}" (${org.id})`);
  } else {
    console.log(`✓ Found existing Organisation: "${org.name}" (${org.id})`);
  }

  // 2. Create Users: One Admin and One Staff
  const adminEmail = 'admin@demodental.co.nz';
  const staffEmail = 'staff@demodental.co.nz';

  let [adminUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail));

  if (!adminUser) {
    [adminUser] = await db
      .insert(users)
      .values({
        organisationId: org.id,
        firebaseUid: 'dev-admin-firebase-uid',
        email: adminEmail,
        name: 'Dr. Sarah Chen',
        role: 'admin',
        emailAlerts: true,
      })
      .returning();
    console.log(`✓ Created Admin User: ${adminUser.name} (${adminUser.email})`);
  } else {
    console.log(`✓ Found Admin User: ${adminUser.name} (${adminUser.email})`);
  }

  let [staffUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, staffEmail));

  if (!staffUser) {
    [staffUser] = await db
      .insert(users)
      .values({
        organisationId: org.id,
        firebaseUid: 'dev-staff-firebase-uid',
        email: staffEmail,
        name: 'Liam Patel',
        role: 'staff',
        emailAlerts: true,
      })
      .returning();
    console.log(`✓ Created Staff User: ${staffUser.name} (${staffUser.email})`);
  } else {
    console.log(`✓ Found Staff User: ${staffUser.name} (${staffUser.email})`);
  }

  // 3. Create Sites: Manukau Clinic, Papatoetoe Clinic, Botany Clinic, New Office (no agent)
  const siteDefs = [
    {
      name: 'Manukau Clinic',
      address: '15 Putney Way, Manukau, Auckland 2104',
      planName: 'Pro',
      monthlyPriceNzd: '149.00',
      codePrefix: 'MNK',
    },
    {
      name: 'Papatoetoe Clinic',
      address: '128 St George Street, Papatoetoe, Auckland 2025',
      planName: 'Pro',
      monthlyPriceNzd: '149.00',
      codePrefix: 'PPT',
    },
    {
      name: 'Botany Clinic',
      address: '588 Chapel Road, Botany Downs, Auckland 2013',
      planName: 'Enterprise',
      monthlyPriceNzd: '199.00',
      codePrefix: 'BTN',
    },
    {
      name: 'New Office (no agent)',
      address: '42 Queen Street, Auckland CBD 1010',
      planName: 'Pro',
      monthlyPriceNzd: '149.00',
      codePrefix: 'NEW',
    },
  ];

  // Expiration set to 7 days from now
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const generatedCodes: { siteName: string; code: string; expiresAt: string }[] = [];

  for (const def of siteDefs) {
    let [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.name, def.name));

    if (!site) {
      [site] = await db
        .insert(sites)
        .values({
          organisationId: org.id,
          name: def.name,
          address: def.address,
          planName: def.planName,
          monthlyPriceNzd: def.monthlyPriceNzd,
        })
        .returning();
      console.log(`✓ Created Site: "${site.name}" (${site.id})`);
    } else {
      console.log(`✓ Found existing Site: "${site.name}" (${site.id})`);
    }

    // Clean up any old unused codes for this site to keep seed clean
    await db
      .delete(setupCodes)
      .where(and(eq(setupCodes.siteId, site.id), isNull(setupCodes.usedAt)));

    // Create a new setup code expiring in 7 days
    const code = generateSetupCode(def.codePrefix);
    await db.insert(setupCodes).values({
      code,
      siteId: site.id,
      expiresAt,
      usedAt: null,
    });

    generatedCodes.push({
      siteName: def.name,
      code,
      expiresAt: expiresAt.toISOString(),
    });
  }

  // 4. Print setup codes prominently to stdout
  console.log('\n================================================================');
  console.log('🔑 SIGNALBLOOM DEV SETUP CODES (Expires in 7 days)');
  console.log('================================================================');
  for (const item of generatedCodes) {
    console.log(`  • ${item.siteName.padEnd(20)}: ${item.code}`);
  }
  console.log(`  Expires At: ${expiresAt.toISOString()}`);
  console.log('================================================================\n');

  console.log('✅ Seed completed successfully.');
}

// Execute
runSeed()
  .catch((err) => {
    console.error('❌ Seed script failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    const pool = createPool();
    await pool.end();
  });
