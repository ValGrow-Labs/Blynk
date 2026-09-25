-- ============================================================================
-- Migration 009 DOWN: Image focal point
-- ============================================================================
-- Drops the four focal-point columns and restores v_product_catalog to its
-- migration 001 shape (the same column list, without image_focal_x/y).
--
-- The view is dropped rather than replaced: `CREATE OR REPLACE VIEW` cannot
-- REMOVE a column, and the columns have to go before the table columns they
-- select can be dropped.
--
-- This rollback loses only the focal points themselves. Every image goes back
-- to being cropped from the centre - which is what it did before 009 - so
-- nothing renders as broken, only as it did before the feature existed. No
-- image file is touched either way: 009 never processed one.

DROP VIEW IF EXISTS v_product_catalog;

ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS chk_promotion_background_focal_x,
    DROP CONSTRAINT IF EXISTS chk_promotion_background_focal_y;

ALTER TABLE promotions
    DROP COLUMN IF EXISTS background_focal_x,
    DROP COLUMN IF EXISTS background_focal_y;

ALTER TABLE products
    DROP CONSTRAINT IF EXISTS chk_product_image_focal_x,
    DROP CONSTRAINT IF EXISTS chk_product_image_focal_y;

ALTER TABLE products
    DROP COLUMN IF EXISTS image_focal_x,
    DROP COLUMN IF EXISTS image_focal_y;

CREATE OR REPLACE VIEW v_product_catalog AS
SELECT
    p.id,
    p.category_id,
    c.name AS category_name,
    p.name,
    p.slug,
    p.description,
    p.sku,
    p.barcode,
    p.unit,
    p.pack_size,
    p.image_url,
    p.purchase_cost,
    p.custom_markup_percent,
    COALESCE(p.custom_markup_percent, (cfg.value->>'markup_percent')::NUMERIC) AS effective_markup_percent,
    ROUND(
        p.purchase_cost * (1 + (COALESCE(p.custom_markup_percent, (cfg.value->>'markup_percent')::NUMERIC) / 100.0)),
        2
    ) AS calculated_selling_price,
    p.is_available,
    p.is_active
FROM products p
JOIN categories c ON p.category_id = c.id
CROSS JOIN system_configurations cfg
WHERE cfg.key = 'default_markup';
