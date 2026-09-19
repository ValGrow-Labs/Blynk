-- 006_rider_location_tracking.sql
-- Latest-location-only columns for live rider tracking (plan
-- docs/superpowers/plans/2026-09-19-blynk-live-location-tracking.md §6, §D.5).
-- No history table: every write overwrites these five columns. No cleanup
-- job is needed because nothing here ever grows independently of `deliveries`
-- itself.
ALTER TABLE deliveries
  ADD COLUMN current_latitude NUMERIC(9, 6),
  ADD COLUMN current_longitude NUMERIC(9, 6),
  ADD COLUMN location_accuracy_m NUMERIC(7, 1),
  ADD COLUMN location_captured_at TIMESTAMPTZ,
  ADD COLUMN location_received_at TIMESTAMPTZ;

ALTER TABLE deliveries
  ADD CONSTRAINT chk_delivery_lat CHECK (current_latitude IS NULL OR current_latitude BETWEEN -90.0 AND 90.0),
  ADD CONSTRAINT chk_delivery_lon CHECK (current_longitude IS NULL OR current_longitude BETWEEN -180.0 AND 180.0),
  ADD CONSTRAINT chk_delivery_location_accuracy CHECK (location_accuracy_m IS NULL OR location_accuracy_m > 0.0);
