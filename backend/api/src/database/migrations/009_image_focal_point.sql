-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 009: Image focal point
-- ============================================================================
-- Product tiles and promotion banners CROP their uploaded image to fill a
-- fixed shape (`BoxFit.cover` in Flutter, `background-size: cover` in Blynk
-- Ops). That crop is anchored at the CENTRE, so an image whose subject sits
-- off-centre loses exactly the part that mattered - a supermarket banner whose
-- "Super Market" headline sits along the top has that headline cropped away.
--
-- These four columns store a FOCAL POINT per image: two percentages that say
-- which point of the picture must stay visible. The renderer anchors its crop
-- there instead of at the centre.
--
--   products.image_focal_x / image_focal_y            -> the product photo
--   promotions.background_focal_x / background_focal_y -> the card background
--     (both IMAGE and ARTWORK - they share background_image_url)
--
-- Why a focal point rather than a crop-and-re-encode tool:
--
--   * Nothing is processed, re-uploaded or destroyed. The operator's original
--     file is untouched and the decision is reversible at any time.
--   * ONE stored point serves EVERY shape the image is drawn at - a phone
--     tile, a tablet tile, the carousel, the order summary. Those aspect
--     ratios differ, so a single baked crop cannot satisfy all of them.
--
-- Purely additive. The default is 50/50, which is the centre - precisely what
-- `cover` already anchors at today - so every existing row renders EXACTLY as
-- it does now and no backfill is needed.
--
-- SMALLINT, not NUMERIC: a percent of the image's width/height is as fine as
-- this decision ever needs to be, and whole numbers keep the control's
-- keyboard step honest (1% per arrow press).

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS image_focal_x SMALLINT NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS image_focal_y SMALLINT NOT NULL DEFAULT 50;

ALTER TABLE products
    DROP CONSTRAINT IF EXISTS chk_product_image_focal_x;
ALTER TABLE products
    ADD CONSTRAINT chk_product_image_focal_x
        CHECK (image_focal_x BETWEEN 0 AND 100);

ALTER TABLE products
    DROP CONSTRAINT IF EXISTS chk_product_image_focal_y;
ALTER TABLE products
    ADD CONSTRAINT chk_product_image_focal_y
        CHECK (image_focal_y BETWEEN 0 AND 100);

ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS background_focal_x SMALLINT NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS background_focal_y SMALLINT NOT NULL DEFAULT 50;

ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS chk_promotion_background_focal_x;
ALTER TABLE promotions
    ADD CONSTRAINT chk_promotion_background_focal_x
        CHECK (background_focal_x BETWEEN 0 AND 100);

ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS chk_promotion_background_focal_y;
ALTER TABLE promotions
    ADD CONSTRAINT chk_promotion_background_focal_y
        CHECK (background_focal_y BETWEEN 0 AND 100);

-- The customer and admin product reads both go through v_product_catalog, so
-- the focal point has to travel with them. The two columns are APPENDED after
-- the existing ones: `CREATE OR REPLACE VIEW` may only add columns at the end
-- of the list, never reorder or retype what is already there.
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
    p.is_active,
    p.image_focal_x,
    p.image_focal_y
FROM products p
JOIN categories c ON p.category_id = c.id
CROSS JOIN system_configurations cfg
WHERE cfg.key = 'default_markup';
