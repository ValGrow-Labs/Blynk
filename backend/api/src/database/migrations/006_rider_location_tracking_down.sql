ALTER TABLE deliveries
  DROP CONSTRAINT IF EXISTS chk_delivery_lat,
  DROP CONSTRAINT IF EXISTS chk_delivery_lon,
  DROP CONSTRAINT IF EXISTS chk_delivery_location_accuracy;

ALTER TABLE deliveries
  DROP COLUMN IF EXISTS current_latitude,
  DROP COLUMN IF EXISTS current_longitude,
  DROP COLUMN IF EXISTS location_accuracy_m,
  DROP COLUMN IF EXISTS location_captured_at,
  DROP COLUMN IF EXISTS location_received_at;
