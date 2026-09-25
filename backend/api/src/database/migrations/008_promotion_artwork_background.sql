-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 008: ARTWORK promotion background
-- ============================================================================
-- Migration 005 gave operations three ways to fill a carousel card:
--
--   SOLID    -> background_color
--   GRADIENT -> background_color + background_color_end
--   IMAGE    -> background_image_url, drawn under a flat ink scrim with the
--               app's own headline and subtitle on top
--
-- IMAGE is right when the operator supplies a photograph. It is wrong when
-- they supply a FINISHED banner - artwork that already carries its own
-- wording and composition. The scrim dims it and the app's headline collides
-- with the baked-in text.
--
--   ARTWORK  -> background_image_url, drawn full-bleed: no scrim, no headline,
--               no subtitle. The operator's file is the whole card.
--
-- Purely additive: no existing row changes type, and SOLID/GRADIENT/IMAGE
-- keep rendering exactly as before.
--
-- `title` stays NOT NULL for ARTWORK too. It is not painted on the card, but
-- it is the slide's accessibility label (a screen-reader user gets nothing
-- from words baked into a picture) and the label the admin list sorts and
-- shows. Do not make it optional.

ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS promotions_background_type_check;

ALTER TABLE promotions
    ADD CONSTRAINT promotions_background_type_check
        CHECK (background_type IN ('SOLID', 'GRADIENT', 'IMAGE', 'ARTWORK'));
