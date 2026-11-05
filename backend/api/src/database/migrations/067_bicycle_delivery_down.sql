-- Rollback of 067: bicycle orders already placed become ordinary orders again (the column is dropped).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_delivery_method;
ALTER TABLE orders DROP COLUMN IF EXISTS delivery_method;
