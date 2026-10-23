/**
 * Development-Only Sample Data Cleanup Script for SignalBloom
 *
 * Removes all sample readings and devices, and updates settings:
 * sample_data = false.
 *
 * FOR DEVELOPMENT USE ONLY - WILL NOT RUN IN PRODUCTION.
 */

import { db, createPool } from './index.ts';
import { devices, metricSamples, settings } from './schema.ts';
import { sql } from 'drizzle-orm';

// Strict production guard
if (process.env.NODE_ENV === 'production') {
  console.error('FATAL: Attempted to run sample cleanup script in production! Aborting.');
  process.exit(1);
}

async function runCleanup() {
  console.log('🧹 Cleaning SignalBloom sample telemetry and devices...\n');

  // Count before deletion
  const [metricCount] = await db.select({ count: sql<number>`count(*)::int` }).from(metricSamples);
  const [deviceCount] = await db.select({ count: sql<number>`count(*)::int` }).from(devices);

  // 1. Delete all metric samples
  await db.delete(metricSamples);
  console.log(`✓ Deleted ${metricCount.count} metric sample rows.`);

  // 2. Delete all devices
  await db.delete(devices);
  console.log(`✓ Deleted ${deviceCount.count} device rows.`);

  // 3. Update settings: sample_data = false
  await db
    .insert(settings)
    .values({
      key: 'sample_data',
      value: false,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: false,
      },
    });
  console.log('✓ Updated settings table: sample_data = false');

  console.log('\n================================================================');
  console.log('🗑️ SAMPLE DATA CLEANUP COMPLETE');
  console.log('================================================================');
  console.log(`  • Metric samples removed: ${metricCount.count}`);
  console.log(`  • Devices removed       : ${deviceCount.count}`);
  console.log(`  • Setting "sample_data" : false`);
  console.log('================================================================\n');
}

runCleanup()
  .catch((err) => {
    console.error('❌ Cleanup failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    const pool = createPool();
    await pool.end();
  });
