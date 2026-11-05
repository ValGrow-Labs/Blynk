-- ============================================================================
-- Migration 068: test orders (the Google Play review account)
-- ============================================================================
-- Owner's brother, 2026-11-05: the Play reviewers sign in with the review number (REVIEW_LOGIN_PHONE) and must be
-- able to place dummy orders at any time, even with the shop closed. Their orders are TEST orders: marked here,
-- kept out of the staff alerts, riders, rewards and reports, and cancelled automatically after a few minutes.
--
-- Every existing order stays an ordinary order (is_test = false). Run by hand in Coolify; the API is deployed
-- before this runs and treats the review number like any other customer until the column exists.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

-- Only test orders are indexed (a handful): the auto-cancel sweep and the daily cap read this.
CREATE INDEX IF NOT EXISTS idx_orders_is_test ON orders (placed_at) WHERE is_test;
