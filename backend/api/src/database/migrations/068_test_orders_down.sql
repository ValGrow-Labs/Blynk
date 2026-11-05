-- Rollback of 068: test orders already placed become ordinary (cancelled) orders again (the column is dropped).
DROP INDEX IF EXISTS idx_orders_is_test;
ALTER TABLE orders DROP COLUMN IF EXISTS is_test;
