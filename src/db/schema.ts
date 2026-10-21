import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userRoleEnum = pgEnum('user_role', ['admin', 'staff']);
export const alertCategoryEnum = pgEnum('alert_category', ['health', 'security']);
export const alertSeverityEnum = pgEnum('alert_severity', ['critical', 'warning', 'info']);
export const alertStatusEnum = pgEnum('alert_status', ['open', 'resolved']);
export const commandTypeEnum = pgEnum('command_type', [
  'restart_device',
  'isolate_device',
  'reconnect_device',
]);
export const commandStatusEnum = pgEnum('command_status', [
  'pending',
  'sent',
  'succeeded',
  'failed',
]);
export const actorTypeEnum = pgEnum('actor_type', ['user', 'ai', 'agent']);
export const emailOutboxStatusEnum = pgEnum('email_outbox_status', ['queued', 'sent', 'failed']);

// ---------------------------------------------------------------------------
// 1. organisations
// ---------------------------------------------------------------------------
export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 2. users
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  firebaseUid: text('firebase_uid').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull().default('staff'),
  emailAlerts: boolean('email_alerts').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 3. sites
// ---------------------------------------------------------------------------
export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address').notNull(),
  planName: text('plan_name').notNull(),
  monthlyPriceNzd: numeric('monthly_price_nzd', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 4. setup_codes
// ---------------------------------------------------------------------------
export const setupCodes = pgTable('setup_codes', {
  code: varchar('code', { length: 64 }).primaryKey(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// 5. agents
// ---------------------------------------------------------------------------
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  hostname: text('hostname').notNull(),
  agentVersion: text('agent_version').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 6. devices
// ---------------------------------------------------------------------------
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    mac: text('mac').notNull(),
    ip: text('ip').notNull(),
    hostname: text('hostname').notNull(),
    vendor: text('vendor').notNull(),
    online: boolean('online').notNull(),
    isKnown: boolean('is_known').notNull().default(false),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('devices_site_id_mac_unique').on(table.siteId, table.mac),
    index('devices_site_id_idx').on(table.siteId),
  ]
);

// ---------------------------------------------------------------------------
// 7. metric_samples
// ---------------------------------------------------------------------------
export const metricSamples = pgTable(
  'metric_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
    latencyMs: doublePrecision('latency_ms').notNull(),
    packetLossPct: doublePrecision('packet_loss_pct').notNull(),
    internetUp: boolean('internet_up').notNull(),
    downloadMbps: doublePrecision('download_mbps'),
    uploadMbps: doublePrecision('upload_mbps'),
    errorRatePct: doublePrecision('error_rate_pct'),
  },
  (table) => [
    unique('metric_samples_site_id_measured_at_unique').on(table.siteId, table.measuredAt),
    index('metric_samples_site_id_measured_at_idx').on(table.siteId, table.measuredAt),
  ]
);

// ---------------------------------------------------------------------------
// 8. alerts
// ---------------------------------------------------------------------------
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    category: alertCategoryEnum('category').notNull(),
    severity: alertSeverityEnum('severity').notNull(),
    rule: text('rule').notNull(),
    reason: text('reason').notNull(),
    status: alertStatusEnum('status').notNull().default('open'),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('alerts_site_id_idx').on(table.siteId),
    index('alerts_status_idx').on(table.status),
  ]
);

// ---------------------------------------------------------------------------
// 9. recommendations
// ---------------------------------------------------------------------------
export const recommendations = pgTable(
  'recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => alerts.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(), // 1 to 3
    explanation: text('explanation').notNull(),
    actionText: text('action_text').notNull(),
    commandType: commandTypeEnum('command_type'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('recommendations_alert_id_idx').on(table.alertId),
  ]
);

// ---------------------------------------------------------------------------
// 10. commands
// ---------------------------------------------------------------------------
export const commands = pgTable(
  'commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    recommendationId: uuid('recommendation_id').references(() => recommendations.id, {
      onDelete: 'set null',
    }),
    type: commandTypeEnum('type').notNull(),
    targetMac: text('target_mac').notNull(),
    status: commandStatusEnum('status').notNull().default('pending'),
    approvedByUserId: uuid('approved_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    resultMessage: text('result_message'),
  },
  (table) => [
    index('commands_site_id_status_idx').on(table.siteId, table.status),
  ]
);

// ---------------------------------------------------------------------------
// 11. audit_log
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    details: jsonb('details').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_organisation_id_idx').on(table.organisationId),
    index('audit_log_site_id_idx').on(table.siteId),
  ]
);

// ---------------------------------------------------------------------------
// 12. email_outbox
// ---------------------------------------------------------------------------
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => alerts.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: emailOutboxStatusEnum('status').notNull().default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    index('email_outbox_status_idx').on(table.status),
    index('email_outbox_user_id_idx').on(table.userId),
  ]
);

// ---------------------------------------------------------------------------
// 13. settings
// ---------------------------------------------------------------------------
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

// ---------------------------------------------------------------------------
// Drizzle Relations Definitions
// ---------------------------------------------------------------------------
export const organisationsRelations = relations(organisations, ({ many }) => ({
  users: many(users),
  sites: many(sites),
  auditLogs: many(auditLog),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [users.organisationId],
    references: [organisations.id],
  }),
  approvedCommands: many(commands),
  emails: many(emailOutbox),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [sites.organisationId],
    references: [organisations.id],
  }),
  setupCodes: many(setupCodes),
  agents: many(agents),
  devices: many(devices),
  metricSamples: many(metricSamples),
  alerts: many(alerts),
  commands: many(commands),
  auditLogs: many(auditLog),
}));

export const setupCodesRelations = relations(setupCodes, ({ one }) => ({
  site: one(sites, {
    fields: [setupCodes.siteId],
    references: [sites.id],
  }),
}));

export const agentsRelations = relations(agents, ({ one }) => ({
  site: one(sites, {
    fields: [agents.siteId],
    references: [sites.id],
  }),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  site: one(sites, {
    fields: [devices.siteId],
    references: [sites.id],
  }),
  alerts: many(alerts),
}));

export const metricSamplesRelations = relations(metricSamples, ({ one }) => ({
  site: one(sites, {
    fields: [metricSamples.siteId],
    references: [sites.id],
  }),
}));

export const alertsRelations = relations(alerts, ({ one, many }) => ({
  site: one(sites, {
    fields: [alerts.siteId],
    references: [sites.id],
  }),
  device: one(devices, {
    fields: [alerts.deviceId],
    references: [devices.id],
  }),
  recommendations: many(recommendations),
  emails: many(emailOutbox),
}));

export const recommendationsRelations = relations(recommendations, ({ one, many }) => ({
  alert: one(alerts, {
    fields: [recommendations.alertId],
    references: [alerts.id],
  }),
  commands: many(commands),
}));

export const commandsRelations = relations(commands, ({ one }) => ({
  site: one(sites, {
    fields: [commands.siteId],
    references: [sites.id],
  }),
  recommendation: one(recommendations, {
    fields: [commands.recommendationId],
    references: [recommendations.id],
  }),
  approvedByUser: one(users, {
    fields: [commands.approvedByUserId],
    references: [users.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  organisation: one(organisations, {
    fields: [auditLog.organisationId],
    references: [organisations.id],
  }),
  site: one(sites, {
    fields: [auditLog.siteId],
    references: [sites.id],
  }),
}));

export const emailOutboxRelations = relations(emailOutbox, ({ one }) => ({
  user: one(users, {
    fields: [emailOutbox.userId],
    references: [users.id],
  }),
  alert: one(alerts, {
    fields: [emailOutbox.alertId],
    references: [alerts.id],
  }),
}));
