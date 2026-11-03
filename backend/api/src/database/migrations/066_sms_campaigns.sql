-- ============================================================================
-- Migration 066: SMS campaigns, templates and run history
-- ============================================================================
-- Owner's brother, 2026-11-03: "no time limits and fully customised, automatic SMS schedule
-- things". Contract: docs/superpowers/plans/2026-11-03-sms-campaigns.md.
--
-- * sms_templates: saved texts (name + Sinhala / Tamil / English) staff pick when they compose.
-- * sms_campaigns: an SMS that is not sent right now. kind ONCE (send at a time), RECURRING
--   (daily / weekly / monthly) or TRIGGER (checked once a day: days after the last order, days
--   after sign-up, no order for N days). `audience` is the stored audience (a string such as
--   'ALL', or a customer-group / CUSTOM filter object), `schedule` the kind's own settings.
--   `next_run_at` is when the 60-second runner next looks at it (NULL = nothing due: paused,
--   cancelled or completed).
-- * sms_campaign_runs: one row per run (recipients, parts, skipped counts, status). The unique
--   (campaign_id, run_key) is what stops a crash or two workers from running one occurrence twice.
--
-- Offers sent right now keep their own history (sms_offers, migration 027). The two settings
-- (`sms_sending`, `sms_limits`) live in system_configurations and need no migration. The API is
-- deployed before this runs (migrations are run by hand in Coolify): the runner and the routes
-- treat a missing table as "no campaigns" (SQLSTATE 42P01) until it exists.

CREATE TABLE IF NOT EXISTS sms_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(80) NOT NULL,
    message_si TEXT NULL,
    message_ta TEXT NULL,
    message_en TEXT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_templates_name ON sms_templates (LOWER(name));

CREATE TABLE IF NOT EXISTS sms_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    kind VARCHAR(12) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    audience JSONB NOT NULL DEFAULT '{"group":"ALL"}'::jsonb,
    fallback_language VARCHAR(2) NOT NULL,
    message_si TEXT NULL,
    message_ta TEXT NULL,
    message_en TEXT NULL,
    schedule JSONB NOT NULL,
    next_run_at TIMESTAMPTZ NULL,
    last_run_at TIMESTAMPTZ NULL,
    run_count INTEGER NOT NULL DEFAULT 0,
    recipients_total INTEGER NOT NULL DEFAULT 0,
    parts_total INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_sms_campaigns_kind CHECK (kind IN ('ONCE', 'RECURRING', 'TRIGGER')),
    CONSTRAINT chk_sms_campaigns_status CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED')),
    CONSTRAINT chk_sms_campaigns_fallback CHECK (fallback_language IN ('si', 'ta', 'en'))
);

-- The runner's query: active campaigns whose time has come.
CREATE INDEX IF NOT EXISTS idx_sms_campaigns_due ON sms_campaigns (next_run_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_sms_campaigns_created ON sms_campaigns (created_at DESC);

CREATE TABLE IF NOT EXISTS sms_campaign_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES sms_campaigns(id) ON DELETE CASCADE,
    -- ONCE: 'once'. RECURRING: the Colombo 'YYYY-MM-DDTHH:mm' of the run. TRIGGER: the Colombo 'YYYY-MM-DD'.
    -- A failed attempt adds ':fail:<n>'.
    run_key VARCHAR(64) NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL,
    recipients INTEGER NOT NULL DEFAULT 0,
    parts INTEGER NOT NULL DEFAULT 0,
    skipped_opted_out INTEGER NOT NULL DEFAULT 0,
    skipped_capped INTEGER NOT NULL DEFAULT 0,
    skipped_no_phone INTEGER NOT NULL DEFAULT 0,
    reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_sms_campaign_runs_status CHECK (status IN ('SENT', 'EMPTY', 'BLOCKED_BUDGET', 'FAILED')),
    CONSTRAINT uq_sms_campaign_runs_key UNIQUE (campaign_id, run_key)
);

CREATE INDEX IF NOT EXISTS idx_sms_campaign_runs_campaign ON sms_campaign_runs (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_campaign_runs_created ON sms_campaign_runs (created_at DESC);

-- The per-customer cap counts a customer's recent SMS_OFFER rows.
CREATE INDEX IF NOT EXISTS idx_notifications_sms_offer_user
    ON notifications (user_id, created_at DESC) WHERE notification_type = 'SMS_OFFER';
