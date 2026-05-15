-- Migration: 004_add_stats_rpc_functions
-- Description: Add RPC functions for stats queries to replace multi-round PostgREST calls
-- Date: 2026-03-14

-- ============================================================
-- 1. get_url_stats: 取得單一 URL 的統計資料（含每日明細）
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
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================
-- 2. get_urls_with_stats: 取得使用者的 URL 列表含統計（分頁）
-- ============================================================
CREATE OR REPLACE FUNCTION get_urls_with_stats(p_user_id UUID, p_page INT DEFAULT 1, p_limit INT DEFAULT 10)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_offset INT;
  v_total INT;
  v_total_pages INT;
  result JSON;
BEGIN
  v_offset := (p_page - 1) * p_limit;

  -- 取得總數
  SELECT COUNT(*) INTO v_total
  FROM urls
  WHERE created_by = p_user_id AND is_active = true;

  v_total_pages := CEIL(v_total::FLOAT / p_limit);

  -- 取得分頁資料含統計
  SELECT json_build_object(
    'data', COALESCE((
      SELECT json_agg(row_data)
      FROM (
        SELECT json_build_object(
          'id', u.id,
          'short_code', u.short_code,
          'original_url', u.original_url,
          'created_at', u.created_at,
          'is_active', u.is_active,
          'clicks', COALESCE(s.total, 0),
          'link_clicks', COALESCE(s.link_clicks, 0),
          'qr_scans', COALESCE(s.qr_scans, 0),
          'last_clicked_at', s.last_clicked_at,
          'qr_code_generated', COALESCE(u.qr_code_generated, false),
          'qr_code_path', u.qr_code_path,
          'qr_code_options', u.qr_code_options,
          'password_protected', COALESCE(u.password_protected, false),
          'expires_at', u.expires_at,
          'created_by', u.created_by
        ) AS row_data
        FROM urls u
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE event_type = 'link_click' OR event_type = 'ad_click') AS link_clicks,
            COUNT(*) FILTER (WHERE event_type = 'qr_scan') AS qr_scans,
            MAX(clicked_at) AS last_clicked_at
          FROM url_clicks
          WHERE url_id = u.id
        ) s ON true
        WHERE u.created_by = p_user_id AND u.is_active = true
        ORDER BY u.created_at DESC
        OFFSET v_offset
        LIMIT p_limit
      ) sub
    ), '[]'::json),
    'pagination', json_build_object(
      'page', p_page,
      'limit', p_limit,
      'total', v_total,
      'totalPages', v_total_pages,
      'hasNext', p_page < v_total_pages,
      'hasPrev', p_page > 1
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================
-- 3. get_stats_summary: 取得使用者的統計摘要
-- ============================================================
CREATE OR REPLACE FUNCTION get_stats_summary(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'totalLinks', (SELECT COUNT(*) FROM urls WHERE created_by = p_user_id),
    'activeLinks', (SELECT COUNT(*) FROM urls WHERE created_by = p_user_id AND is_active = true),
    'totalClicks', (
      SELECT COUNT(*)
      FROM url_clicks c
      INNER JOIN urls u ON u.id = c.url_id
      WHERE u.created_by = p_user_id
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================
-- 4. get_daily_stats: 取得使用者的每日統計
-- ============================================================
CREATE OR REPLACE FUNCTION get_daily_stats(p_user_id UUID, p_days INT DEFAULT 30)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  v_start_date TIMESTAMPTZ;
BEGIN
  v_start_date := NOW() - (p_days || ' days')::INTERVAL;

  -- 產生日期序列並 LEFT JOIN 點擊資料
  SELECT COALESCE(json_agg(day_row ORDER BY day_row->>'date' ASC), '[]'::json)
  INTO result
  FROM (
    SELECT json_build_object(
      'date', d.date::TEXT,
      'link_clicks', COALESCE(s.link_clicks, 0),
      'qr_scans', COALESCE(s.qr_scans, 0),
      'ad_views', COALESCE(s.ad_views, 0),
      'ad_clicks', COALESCE(s.ad_clicks, 0)
    ) AS day_row
    FROM generate_series(v_start_date::DATE, CURRENT_DATE, '1 day'::INTERVAL) AS d(date)
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE c.event_type = 'link_click') AS link_clicks,
        COUNT(*) FILTER (WHERE c.event_type = 'qr_scan') AS qr_scans,
        COUNT(*) FILTER (WHERE c.event_type = 'ad_view') AS ad_views,
        COUNT(*) FILTER (WHERE c.event_type = 'ad_click') AS ad_clicks
      FROM url_clicks c
      INNER JOIN urls u ON u.id = c.url_id
      WHERE u.created_by = p_user_id
        AND date(c.clicked_at) = d.date
    ) s ON true
  ) sub;

  RETURN result;
END;
$$;

-- ============================================================
-- Grant execute permissions
-- ============================================================
GRANT EXECUTE ON FUNCTION get_url_stats(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_url_stats(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_urls_with_stats(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_urls_with_stats(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_stats_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_stats_summary(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_daily_stats(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_stats(UUID, INT) TO service_role;

-- ============================================================
-- Add composite index for better stats query performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_url_clicks_stats
  ON url_clicks (url_id, event_type, clicked_at);

-- ============================================================
-- Rollback commands (run manually if needed):
-- ============================================================
-- DROP FUNCTION IF EXISTS get_url_stats(UUID, INT);
-- DROP FUNCTION IF EXISTS get_urls_with_stats(UUID, INT, INT);
-- DROP FUNCTION IF EXISTS get_stats_summary(UUID);
-- DROP FUNCTION IF EXISTS get_daily_stats(UUID, INT);
-- DROP INDEX IF EXISTS idx_url_clicks_stats;
