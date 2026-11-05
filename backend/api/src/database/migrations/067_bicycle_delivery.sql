-- ============================================================================
-- Migration 067: bicycle delivery - how an order is delivered
-- ============================================================================
-- Team meeting 2026-11-04 + owner 2026-11-05: a separate, cheaper bicycle delivery for short routes.
-- The customer picks Bicycle or Motorbike at checkout when both are possible; staff assign the rider
-- (a BICYCLE order only goes to a rider whose vehicle_type is BICYCLE). The money and distance live in
-- the 'bicycle_delivery' system setting (no migration for that), switched OFF by default.
--
-- Every existing order stays MOTORBIKE. Run by hand in Coolify; the API is deployed before this runs
-- and treats every order as MOTORBIKE until the column exists (the setting stays unusable meanwhile:
-- checkout-info answers bicycle.available = false).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'MOTORBIKE';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_delivery_method;
ALTER TABLE orders ADD CONSTRAINT chk_orders_delivery_method CHECK (delivery_method IN ('MOTORBIKE', 'BICYCLE'));
