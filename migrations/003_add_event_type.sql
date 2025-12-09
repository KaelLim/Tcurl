-- Migration: 003_add_event_type
-- Description: Add event_type column to url_clicks for tracking different event types
-- Date: 2025-12-04

-- Add event_type column to url_clicks
ALTER TABLE url_clicks
ADD COLUMN IF NOT EXISTS event_type VARCHAR(20) DEFAULT 'link_click';

-- Migrate existing data: convert is_qr_scan to event_type
UPDATE url_clicks
SET event_type = CASE
    WHEN is_qr_scan = true THEN 'qr_scan'
    ELSE 'link_click'
END
WHERE event_type IS NULL OR event_type = 'link_click';

-- Add index for event_type queries
CREATE INDEX IF NOT EXISTS idx_url_clicks_event_type ON url_clicks(event_type);

-- Add composite index for statistics queries
CREATE INDEX IF NOT EXISTS idx_url_clicks_url_event ON url_clicks(url_id, event_type);

-- Comment explaining event_type values
COMMENT ON COLUMN url_clicks.event_type IS 'Event type: link_click, qr_scan, ad_view, ad_click';

-- =============================================
-- Rollback commands (run manually if needed):
-- =============================================
-- DROP INDEX IF EXISTS idx_url_clicks_url_event;
-- DROP INDEX IF EXISTS idx_url_clicks_event_type;
-- ALTER TABLE url_clicks DROP COLUMN IF EXISTS event_type;
