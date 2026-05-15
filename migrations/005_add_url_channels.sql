-- Migration: 005_add_url_channels
-- Description: Add url_channels table for UTM channel tracking + multi QR code
-- Date: 2026-05-15

-- ============================================================
-- 1. Create url_channels table
-- ============================================================
CREATE TABLE IF NOT EXISTS url_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url_id UUID NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  group_key VARCHAR(8) NOT NULL,
  name VARCHAR(100) NOT NULL,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(200),
  utm_content VARCHAR(200),
  utm_term VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(url_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_url_channels_url_id ON url_channels(url_id);
CREATE INDEX IF NOT EXISTS idx_url_channels_group_key ON url_channels(group_key);

COMMENT ON TABLE url_channels IS '短網址管道追蹤 - 每個管道可設定獨立 UTM 參數並產生對應 QR Code';
COMMENT ON COLUMN url_channels.group_key IS '管道短碼，用於 URL 參數 g=xxx，6 位英數隨機碼';
COMMENT ON COLUMN url_channels.name IS '使用者自定義管道名稱，如「花蓮營隊海報」';

-- ============================================================
-- 2. Add channel_id to url_clicks
-- ============================================================
ALTER TABLE url_clicks ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES url_channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_url_clicks_channel_id ON url_clicks(channel_id);

COMMENT ON COLUMN url_clicks.channel_id IS '來源管道 ID，NULL 表示直接點擊（無管道）';

-- ============================================================
-- 3. RLS policies for url_channels
-- ============================================================
ALTER TABLE url_channels ENABLE ROW LEVEL SECURITY;

-- Service role 完全存取
CREATE POLICY "Service role full access on channels"
  ON url_channels TO service_role USING (true);

-- 使用者可查看自己 URL 的管道
CREATE POLICY "Users can view own URL channels"
  ON url_channels FOR SELECT
  USING (url_id IN (SELECT id FROM urls WHERE created_by = auth.uid()));

-- 使用者可新增自己 URL 的管道
CREATE POLICY "Users can insert own URL channels"
  ON url_channels FOR INSERT
  WITH CHECK (url_id IN (SELECT id FROM urls WHERE created_by = auth.uid()));

-- 使用者可更新自己 URL 的管道
CREATE POLICY "Users can update own URL channels"
  ON url_channels FOR UPDATE
  USING (url_id IN (SELECT id FROM urls WHERE created_by = auth.uid()));

-- 使用者可刪除自己 URL 的管道
CREATE POLICY "Users can delete own URL channels"
  ON url_channels FOR DELETE
  USING (url_id IN (SELECT id FROM urls WHERE created_by = auth.uid()));

-- ============================================================
-- 4. Grant permissions
-- ============================================================
GRANT ALL ON TABLE url_channels TO postgres;
GRANT ALL ON TABLE url_channels TO authenticated;
GRANT ALL ON TABLE url_channels TO service_role;

-- ============================================================
-- 5. Update get_url_stats RPC to include channel breakdown
-- ============================================================
CREATE OR REPLACE FUNCTION get_url_stats(p_url_id UUID, p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total', (
      SELECT json_build_object(
        'total_clicks', COUNT(*),
        'link_clicks', COUNT(*) FILTER (WHERE event_type = 'link_click' OR event_type = 'ad_click'),
        'qr_scans', COUNT(*) FILTER (WHERE event_type = 'qr_scan'),
        'ad_views', COUNT(*) FILTER (WHERE event_type = 'ad_view'),
        'ad_clicks', COUNT(*) FILTER (WHERE event_type = 'ad_click'),
        'last_clicked_at', MAX(clicked_at)
      )
      FROM url_clicks
      WHERE url_id = p_url_id
    ),
    'daily', COALESCE((
      SELECT json_agg(day_row ORDER BY day_row->>'date' DESC)
      FROM (
        SELECT json_build_object(
          'date', date(clicked_at),
          'total_clicks', COUNT(*),
          'link_clicks', COUNT(*) FILTER (WHERE event_type = 'link_click'),
          'qr_scans', COUNT(*) FILTER (WHERE event_type = 'qr_scan'),
          'ad_views', COUNT(*) FILTER (WHERE event_type = 'ad_view'),
          'ad_clicks', COUNT(*) FILTER (WHERE event_type = 'ad_click')
        ) AS day_row
        FROM url_clicks
        WHERE url_id = p_url_id
        GROUP BY date(clicked_at)
        ORDER BY date(clicked_at) DESC
        LIMIT p_days
      ) sub
    ), '[]'::json),
    'channels', COALESCE((
      SELECT json_agg(ch_row)
      FROM (
        SELECT json_build_object(
          'channel_id', uc.id,
          'name', uc.name,
          'group_key', uc.group_key,
          'clicks', COUNT(c.id)
        ) AS ch_row
        FROM url_channels uc
        LEFT JOIN url_clicks c ON c.channel_id = uc.id
        WHERE uc.url_id = p_url_id
        GROUP BY uc.id, uc.name, uc.group_key
      ) sub
    ), '[]'::json),
    'direct_clicks', (
      SELECT COUNT(*)
      FROM url_clicks
      WHERE url_id = p_url_id AND channel_id IS NULL
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================
-- Rollback commands (run manually if needed):
-- ============================================================
-- ALTER TABLE url_clicks DROP COLUMN IF EXISTS channel_id;
-- DROP TABLE IF EXISTS url_channels;
