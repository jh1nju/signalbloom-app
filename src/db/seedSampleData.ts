/**
 * Development-Only Sample Data Generator for SignalBloom
 *
 * Populates realistic network topology (devices) and 24-hour metric telemetry
 * (latency, packet loss, bandwidth) for the 3 seed clinics.
 *
 * FOR DEVELOPMENT USE ONLY - WILL NOT RUN IN PRODUCTION.
 */

import { db, createPool } from './index.ts';
import { sites, devices, metricSamples, settings } from './schema.ts';
import { eq, sql } from 'drizzle-orm';

// Strict production guard
if (process.env.NODE_ENV === 'production') {
  console.error('FATAL: Attempted to run sample data script in production! Aborting.');
  process.exit(1);
}

// Helper to determine New Zealand local hour (Pacific/Auckland)
function getNZHour(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(date), 10);
}

// Random float between min and max rounded to 1 decimal place
function randomFloat(min: number, max: number, decimals = 1): number {
  const val = Math.random() * (max - min) + min;
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

async function runSampleDataSeed() {
  console.log('🚀 Generating 24-hour sample network data for SignalBloom clinics...\n');

  // 1. Fetch the 3 seed sites
  const seedSites = await db.select().from(sites);
  if (seedSites.length === 0) {
    console.error('❌ No sites found in database! Run "npm run seed" first.');
    process.exit(1);
  }

  console.log(`Found ${seedSites.length} sites: ${seedSites.map(s => s.name).join(', ')}`);

  // Device blueprints for each clinic subnet
  const siteDeviceConfigs: Record<string, { subnet: string; isDegraded: boolean }> = {
    'Manukau Clinic': { subnet: '192.168.10', isDegraded: false },
    'Papatoetoe Clinic': { subnet: '192.168.20', isDegraded: true }, // Noticeably worse site
    'Botany Clinic': { subnet: '192.168.30', isDegraded: false },
  };

  const now = new Date();
  let totalDevicesCreated = 0;
  let totalSamplesCreated = 0;

  for (const site of seedSites) {
    const config = siteDeviceConfigs[site.name];
    if (!config) {
      console.log(`\n⏭️ Skipping Site: "${site.name}" (configured with no agent, devices, or readings).`);
      continue;
    }
    const { subnet, isDegraded } = config;

    console.log(`\n📦 Configuring Site: "${site.name}" (Subnet: ${subnet}.0/24, Status: ${isDegraded ? 'DEGRADED / HIGHER LATENCY' : 'HEALTHY'})...`);

    // 2. Generate 10 to 12 realistic devices per site
    // Includes router, reception PCs, doctor laptops, receipt printers, EFTPOS terminals, medical devices, tablets
    const siteDevices = [
      {
        mac: `00:0c:42:${subnet.split('.')[2]}:00:01`,
        ip: `${subnet}.1`,
        hostname: 'gateway-core-router',
        vendor: 'MikroTik',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 30 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `d4:be:d9:${subnet.split('.')[2]}:11:02`,
        ip: `${subnet}.10`,
        hostname: 'reception-pc-01',
        vendor: 'Dell',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 20 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `d4:be:d9:${subnet.split('.')[2]}:11:03`,
        ip: `${subnet}.11`,
        hostname: 'reception-pc-02',
        vendor: 'Dell',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 15 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `3c:52:82:${subnet.split('.')[2]}:20:04`,
        ip: `${subnet}.21`,
        hostname: 'dr-chen-surgery-pc',
        vendor: 'HP',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 18 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `3c:52:82:${subnet.split('.')[2]}:20:05`,
        ip: `${subnet}.22`,
        hostname: 'dr-patel-surgery-pc',
        vendor: 'HP',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 14 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `00:11:32:${subnet.split('.')[2]}:30:06`,
        ip: `${subnet}.45`,
        hostname: 'eftpos-terminal-counter1',
        vendor: 'Verifone',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 25 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `00:11:32:${subnet.split('.')[2]}:30:07`,
        ip: `${subnet}.46`,
        hostname: 'eftpos-terminal-counter2',
        vendor: 'Verifone',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 25 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `00:26:73:${subnet.split('.')[2]}:40:08`,
        ip: `${subnet}.50`,
        hostname: 'hp-laserjet-reception',
        vendor: 'HP',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 22 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `00:26:73:${subnet.split('.')[2]}:40:09`,
        ip: `${subnet}.51`,
        hostname: 'brother-label-printer',
        vendor: 'Brother',
        online: false, // 1st offline device
        isKnown: true,
        firstSeen: new Date(now.getTime() - 12 * 24 * 3600 * 1000),
        lastSeen: new Date(now.getTime() - 18 * 3600 * 1000), // offline since 18h ago
      },
      {
        mac: `ac:bc:32:${subnet.split('.')[2]}:50:10`,
        ip: `${subnet}.65`,
        hostname: 'carestream-xray-imaging',
        vendor: 'Carestream Dental',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `98:01:a7:${subnet.split('.')[2]}:60:11`,
        ip: `${subnet}.82`,
        hostname: 'patient-checkin-ipad',
        vendor: 'Apple',
        online: true,
        isKnown: true,
        firstSeen: new Date(now.getTime() - 8 * 24 * 3600 * 1000),
        lastSeen: now,
      },
      {
        mac: `40:4e:36:${subnet.split('.')[2]}:70:12`,
        ip: `${subnet}.95`,
        hostname: 'staff-breakroom-phone',
        vendor: 'Samsung',
        online: false, // 2nd offline device
        isKnown: true,
        firstSeen: new Date(now.getTime() - 3 * 24 * 3600 * 1000),
        lastSeen: new Date(now.getTime() - 3 * 3600 * 1000), // offline since 3h ago
      },
    ];

    for (const d of siteDevices) {
      await db
        .insert(devices)
        .values({
          siteId: site.id,
          mac: d.mac,
          ip: d.ip,
          hostname: d.hostname,
          vendor: d.vendor,
          online: d.online,
          isKnown: d.isKnown,
          firstSeenAt: d.firstSeen,
          lastSeenAt: d.lastSeen,
        })
        .onConflictDoUpdate({
          target: [devices.siteId, devices.mac],
          set: {
            ip: d.ip,
            hostname: d.hostname,
            vendor: d.vendor,
            online: d.online,
            isKnown: d.isKnown,
            lastSeenAt: d.lastSeen,
          },
        });
      totalDevicesCreated++;
    }

    // 3. Generate metric_samples every 30 seconds for the last 24 hours
    // Total samples per site: 24 * 60 * 2 = 2,880 samples
    const totalIntervals = 2880;
    const intervalMs = 30 * 1000;
    const metricBatch: (typeof metricSamples.$inferInsert)[] = [];

    // Ensure we start aligned to 30-second boundaries
    const baseTimeMs = Math.floor(now.getTime() / intervalMs) * intervalMs;

    for (let i = totalIntervals - 1; i >= 0; i--) {
      const sampleTime = new Date(baseTimeMs - i * intervalMs);
      const nzHour = getNZHour(sampleTime);
      const isBusinessHours = nzHour >= 9 && nzHour < 17; // 9am to 5pm NZ time

      let latencyMs: number;
      let packetLossPct: number;
      let downloadMbps: number | null = null;
      let uploadMbps: number | null = null;

      // Bandwidth test occurs every 15 minutes (every 30th sample of 30s)
      const isBandwidthInterval = i % 30 === 0;

      if (!isDegraded) {
        // HEALTHY SITES (Manukau, Botany): Latency 5 to 40ms, higher during business hours
        if (isBusinessHours) {
          latencyMs = randomFloat(18.0, 36.5);
          packetLossPct = Math.random() < 0.85 ? 0.0 : randomFloat(0.1, 0.9);
          if (isBandwidthInterval) {
            downloadMbps = randomFloat(120.0, 260.0);
            uploadMbps = randomFloat(35.0, 65.0);
          }
        } else {
          // Off-peak
          latencyMs = randomFloat(6.0, 16.5);
          packetLossPct = Math.random() < 0.95 ? 0.0 : randomFloat(0.1, 0.4);
          if (isBandwidthInterval) {
            downloadMbps = randomFloat(280.0, 395.0);
            uploadMbps = randomFloat(65.0, 95.0);
          }
        }
      } else {
        // NOTICEABLY WORSE SITE (Papatoetoe Clinic): Higher latency & packet loss, lower bandwidth
        if (isBusinessHours) {
          // Elevated latency with intermittent congestion spikes
          latencyMs = randomFloat(38.0, 85.0);
          if (Math.random() < 0.12) latencyMs += randomFloat(25.0, 50.0); // Spikes up to ~130ms
          packetLossPct = randomFloat(1.2, 4.8); // Noticeable packet loss
          if (isBandwidthInterval) {
            downloadMbps = randomFloat(60.0, 115.0); // Degraded speed
            uploadMbps = randomFloat(12.0, 24.0);
          }
        } else {
          // Off-peak still noticeably higher than other sites
          latencyMs = randomFloat(20.0, 38.0);
          packetLossPct = Math.random() < 0.7 ? 0.0 : randomFloat(0.2, 1.2);
          if (isBandwidthInterval) {
            downloadMbps = randomFloat(140.0, 220.0);
            uploadMbps = randomFloat(28.0, 48.0);
          }
        }
      }

      metricBatch.push({
        siteId: site.id,
        measuredAt: sampleTime,
        latencyMs: Math.round(latencyMs * 10) / 10,
        packetLossPct: Math.round(packetLossPct * 10) / 10,
        internetUp: true,
        downloadMbps: downloadMbps !== null ? Math.round(downloadMbps * 10) / 10 : null,
        uploadMbps: uploadMbps !== null ? Math.round(uploadMbps * 10) / 10 : null,
        errorRatePct: null, // Per spec: error_rate_pct null
      });
    }

    // Insert metrics in chunks of 500 to optimize throughput
    const chunkSize = 500;
    for (let c = 0; c < metricBatch.length; c += chunkSize) {
      const chunk = metricBatch.slice(c, c + chunkSize);
      await db
        .insert(metricSamples)
        .values(chunk)
        .onConflictDoNothing({
          target: [metricSamples.siteId, metricSamples.measuredAt],
        });
    }

    totalSamplesCreated += metricBatch.length;
    console.log(`  ✓ Inserted ${siteDevices.length} devices and ${metricBatch.length} metric readings for ${site.name}`);
  }

  // 4. Set settings row: sample_data = true
  await db
    .insert(settings)
    .values({
      key: 'sample_data',
      value: true,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: true,
      },
    });
  console.log('\n✓ Updated settings table: sample_data = true');

  console.log('\n================================================================');
  console.log('📊 SAMPLE DATA CREATION SUMMARY');
  console.log('================================================================');
  console.log(`  • Devices created/updated       : ${totalDevicesCreated}`);
  console.log(`  • Metric samples (last 24 hours): ${totalSamplesCreated}`);
  console.log(`  • Setting "sample_data"         : true`);
  console.log('================================================================\n');

  console.log('✅ Sample data generated successfully.');
}

runSampleDataSeed()
  .catch((err) => {
    console.error('❌ Sample data seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    const pool = createPool();
    await pool.end();
  });
