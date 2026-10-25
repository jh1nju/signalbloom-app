import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { alerts, emailOutbox, sites, users } from '../../db/schema.ts';
import { queueAndSendCriticalAlertEmails } from '../alertEngine.ts';

describe('Critical alert email outbox & Resend integration', () => {
  it('writes one queued row per user with email_alerts on when a critical alert opens, never duplicates per check, and respects RESEND_API_KEY', async () => {
    const [site] = await db.select().from(sites).limit(1);
    assert.ok(site, 'Expected at least one site in database');

    const orgUsers = await db
      .select()
      .from(users)
      .where(eq(users.organisationId, site.organisationId));
    assert.ok(orgUsers.length >= 2, 'Expected admin and staff users in organisation');

    // Ensure both users start with emailAlerts = true
    for (const u of orgUsers) {
      await db.update(users).set({ emailAlerts: true }).where(eq(users.id, u.id));
    }

    // Create a temporary critical alert to test with
    const alertTitle = 'Your internet connection is down';
    const alertReason = 'Internet connection has been down for 2 checks in a row';

    const [createdAlert] = await db
      .insert(alerts)
      .values({
        siteId: site.id,
        deviceId: null,
        category: 'health',
        severity: 'critical',
        rule: 'test_critical_email_rule',
        reason: `${alertTitle}\n${alertReason}`,
        status: 'open',
        occurrenceCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
      .returning();

    const prevResendKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    try {
      // 1. Trigger email outbox on critical alert open (no RESEND_API_KEY)
      await queueAndSendCriticalAlertEmails({
        alertId: createdAlert.id,
        siteId: site.id,
        title: alertTitle,
        reason: alertReason,
      });

      const outboxRowsFirst = await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.alertId, createdAlert.id));

      assert.equal(
        outboxRowsFirst.length,
        orgUsers.length,
        'Should create one email_outbox row for each user with email_alerts on'
      );

      for (const row of outboxRowsFirst) {
        assert.equal(row.subject, `SignalBloom: ${alertTitle} at ${site.name}`);
        assert.ok(row.body.includes(alertReason), 'Body should include the alert reason');
        assert.ok(row.body.includes('http'), 'Body should include a link to the dashboard');
        assert.equal(row.status, 'queued', 'Should stay queued when RESEND_API_KEY is not set');
        assert.equal(row.sentAt, null);
      }

      // 2. Second check on the same alert must NOT create additional emails ("One email per alert, never per check")
      await queueAndSendCriticalAlertEmails({
        alertId: createdAlert.id,
        siteId: site.id,
        title: alertTitle,
        reason: alertReason,
      });

      const outboxRowsSecond = await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.alertId, createdAlert.id));

      assert.equal(
        outboxRowsSecond.length,
        orgUsers.length,
        'Never create a second email per check for the same alert'
      );

      // Clean up first test alert emails
      await db.delete(emailOutbox).where(eq(emailOutbox.alertId, createdAlert.id));

      // 3. Turn off email_alerts for one user and verify only opted-in users receive an outbox row,
      // and test Resend sending when RESEND_API_KEY is set
      const [firstUser, secondUser] = orgUsers;
      await db.update(users).set({ emailAlerts: false }).where(eq(users.id, secondUser.id));

      process.env.RESEND_API_KEY = 're_test_mock_key';
      const resendPayloads: any[] = [];

      const mockFetch: typeof fetch = async (input, init) => {
        resendPayloads.push({
          url: String(input),
          headers: init?.headers,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ id: 'mock_resend_id' }), { status: 200 });
      };

      await queueAndSendCriticalAlertEmails({
        alertId: createdAlert.id,
        siteId: site.id,
        title: alertTitle,
        reason: alertReason,
        fetchFn: mockFetch,
      });

      const outboxAfterToggle = await db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.alertId, createdAlert.id));

      assert.equal(outboxAfterToggle.length, 1, 'Only user with email_alerts on should get an email');
      assert.equal(outboxAfterToggle[0].userId, firstUser.id);
      assert.equal(outboxAfterToggle[0].status, 'sent');
      assert.ok(outboxAfterToggle[0].sentAt !== null, 'sentAt should be populated when sent');
      assert.equal(resendPayloads.length, 1);
      assert.equal(resendPayloads[0].body.from, 'onboarding@resend.dev');
      assert.deepEqual(resendPayloads[0].body.to, [firstUser.email]);
    } finally {
      if (prevResendKey !== undefined) {
        process.env.RESEND_API_KEY = prevResendKey;
      } else {
        delete process.env.RESEND_API_KEY;
      }
      // Restore all users to emailAlerts = true and clean up temporary alert
      for (const u of orgUsers) {
        await db.update(users).set({ emailAlerts: true }).where(eq(users.id, u.id));
      }
      await db.delete(emailOutbox).where(eq(emailOutbox.alertId, createdAlert.id));
      await db
        .delete(alerts)
        .where(and(eq(alerts.id, createdAlert.id), eq(alerts.rule, 'test_critical_email_rule')));
    }
  });
});
