-- Migration 066 DOWN: drop SMS campaigns, runs and templates (sms_offers, migration 027, stays).
DROP INDEX IF EXISTS idx_notifications_sms_offer_user;
DROP TABLE IF EXISTS sms_campaign_runs;
DROP TABLE IF EXISTS sms_campaigns;
DROP TABLE IF EXISTS sms_templates;
