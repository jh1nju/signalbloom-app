-- =============================================================================
-- Migration: 0000_initial_schema.sql
-- Description: Initial schema for SignalBloom with UUID primary keys & timestamptz
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'staff');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_category AS ENUM ('health', 'security');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('critical', 'warning', 'info');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_status AS ENUM ('open', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE command_type AS ENUM ('restart_device', 'isolate_device', 'reconnect_device');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE command_status AS ENUM ('pending', 'sent', 'succeeded', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE actor_type AS ENUM ('user', 'ai', 'agent');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE email_outbox_status AS ENUM ('queued', 'sent', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1. organisations
CREATE TABLE IF NOT EXISTS "organisations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. users
CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "firebase_uid" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" user_role NOT NULL DEFAULT 'staff',
  "email_alerts" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. sites
CREATE TABLE IF NOT EXISTS "sites" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "plan_name" TEXT NOT NULL,
  "monthly_price_nzd" NUMERIC(10, 2) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. setup_codes
CREATE TABLE IF NOT EXISTS "setup_codes" (
  "code" VARCHAR(64) PRIMARY KEY,
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used_at" TIMESTAMPTZ
);

-- 5. agents
CREATE TABLE IF NOT EXISTS "agents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "token_hash" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "agent_version" TEXT NOT NULL,
  "last_seen_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. devices
CREATE TABLE IF NOT EXISTS "devices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "mac" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "vendor" TEXT NOT NULL,
  "online" BOOLEAN NOT NULL,
  "is_known" BOOLEAN NOT NULL DEFAULT FALSE,
  "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "devices_site_id_mac_unique" UNIQUE ("site_id", "mac")
);
CREATE INDEX IF NOT EXISTS "devices_site_id_idx" ON "devices"("site_id");

-- 7. metric_samples
CREATE TABLE IF NOT EXISTS "metric_samples" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "measured_at" TIMESTAMPTZ NOT NULL,
  "latency_ms" DOUBLE PRECISION NOT NULL,
  "packet_loss_pct" DOUBLE PRECISION NOT NULL,
  "internet_up" BOOLEAN NOT NULL,
  "download_mbps" DOUBLE PRECISION,
  "upload_mbps" DOUBLE PRECISION,
  "error_rate_pct" DOUBLE PRECISION,
  CONSTRAINT "metric_samples_site_id_measured_at_unique" UNIQUE ("site_id", "measured_at")
);
CREATE INDEX IF NOT EXISTS "metric_samples_site_id_measured_at_idx" ON "metric_samples"("site_id", "measured_at");

-- 8. alerts
CREATE TABLE IF NOT EXISTS "alerts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "device_id" UUID REFERENCES "devices"("id") ON DELETE SET NULL,
  "category" alert_category NOT NULL,
  "severity" alert_severity NOT NULL,
  "rule" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" alert_status NOT NULL DEFAULT 'open',
  "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS "alerts_site_id_idx" ON "alerts"("site_id");
CREATE INDEX IF NOT EXISTS "alerts_status_idx" ON "alerts"("status");

-- 9. recommendations
CREATE TABLE IF NOT EXISTS "recommendations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "alert_id" UUID NOT NULL REFERENCES "alerts"("id") ON DELETE CASCADE,
  "rank" INTEGER NOT NULL,
  "explanation" TEXT NOT NULL,
  "action_text" TEXT NOT NULL,
  "command_type" command_type,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "recommendations_alert_id_idx" ON "recommendations"("alert_id");

-- 10. commands
CREATE TABLE IF NOT EXISTS "commands" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "recommendation_id" UUID REFERENCES "recommendations"("id") ON DELETE SET NULL,
  "type" command_type NOT NULL,
  "target_mac" TEXT NOT NULL,
  "status" command_status NOT NULL DEFAULT 'pending',
  "approved_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "approved_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "finished_at" TIMESTAMPTZ,
  "result_message" TEXT
);
CREATE INDEX IF NOT EXISTS "commands_site_id_status_idx" ON "commands"("site_id", "status");

-- 11. audit_log
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "site_id" UUID REFERENCES "sites"("id") ON DELETE SET NULL,
  "actor_type" actor_type NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "audit_log_organisation_id_idx" ON "audit_log"("organisation_id");
CREATE INDEX IF NOT EXISTS "audit_log_site_id_idx" ON "audit_log"("site_id");

-- 12. email_outbox
CREATE TABLE IF NOT EXISTS "email_outbox" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "alert_id" UUID NOT NULL REFERENCES "alerts"("id") ON DELETE CASCADE,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" email_outbox_status NOT NULL DEFAULT 'queued',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "sent_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "email_outbox_status_idx" ON "email_outbox"("status");
CREATE INDEX IF NOT EXISTS "email_outbox_user_id_idx" ON "email_outbox"("user_id");

-- 13. settings (with placeholder seeds)
CREATE TABLE IF NOT EXISTS "settings" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL
);

-- Seed placeholder weights and thresholds
INSERT INTO "settings" ("key", "value")
VALUES
  (
    'health_weights',
    '{"latency": 0.25, "packet_loss": 0.35, "uptime": 0.25, "error_rate": 0.15}'::JSONB
  ),
  (
    'alert_thresholds',
    '{"latency_warn_ms": 60, "latency_crit_ms": 150, "packet_loss_warn_pct": 2.0, "packet_loss_crit_pct": 10.0, "error_rate_warn_pct": 1.0}'::JSONB
  )
ON CONFLICT ("key") DO NOTHING;
