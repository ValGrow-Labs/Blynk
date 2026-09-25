-- ============================================================================
-- Migration 008 DOWN: ARTWORK promotion background
-- ============================================================================
-- Restores the migration 005 constraint (SOLID, GRADIENT, IMAGE).
--
-- This rollback REFUSES to run while any ARTWORK promotion exists. Narrowing
-- the constraint under live data would otherwise have to either fail with an
-- opaque constraint violation or silently rewrite those rows to IMAGE - which
-- would put the app's headline and a 0.66 ink scrim back over a finished
-- banner, wrecking the campaign without telling anyone.
--
-- The operator decides instead. Retype or deactivate the rows named below,
-- then run the rollback again:
--
--   UPDATE promotions SET background_type = 'IMAGE' WHERE background_type = 'ARTWORK';
--
-- (That is a deliberate, destructive-to-the-look choice, which is exactly why
-- this migration will not make it for you.)

DO $$
DECLARE
    artwork_count INTEGER;
    artwork_titles TEXT;
BEGIN
    SELECT COUNT(*), COALESCE(string_agg(title, ', ' ORDER BY title), '')
      INTO artwork_count, artwork_titles
      FROM promotions
     WHERE background_type = 'ARTWORK';

    IF artwork_count > 0 THEN
        RAISE EXCEPTION
            'Cannot roll back migration 008: % promotion(s) still use background_type ARTWORK (%). Convert or delete them first - see the comment at the top of 008_promotion_artwork_background_down.sql.',
            artwork_count, artwork_titles
            USING ERRCODE = 'check_violation';
    END IF;
END
$$;

ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS promotions_background_type_check;

ALTER TABLE promotions
    ADD CONSTRAINT promotions_background_type_check
        CHECK (background_type IN ('SOLID', 'GRADIENT', 'IMAGE'));
