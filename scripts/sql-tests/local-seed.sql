-- =====================================================================
-- 本機 SQL 測試的種子資料（只給 scripts/sql-tests/run-local.sh 用；在套用全部 migration 之後執行）
--
-- 測試檔（api_keys_test.sql）本身不新增 auth.users，因為它也要原封不動地在正式庫跑：
-- 它以 email 找負責同仁 kael1996@tzuchi.org.tw，另外挑「任一其他」慈濟帳號與「任一非慈濟」帳號。
-- 這裡準備本機對應的三位使用者，與幾筆既有短網址（模擬正式庫已有資料）。
-- =====================================================================

INSERT INTO auth.users (id, email, email_confirmed_at, last_sign_in_at, raw_user_meta_data) VALUES
  ('00000000-0000-4000-8000-000000000001', 'kael1996@tzuchi.org.tw', now(), now(), '{"full_name":"Kael"}'),
  ('00000000-0000-4000-8000-000000000002', 'colleague@tzuchi.org.tw', now(), now() - interval '3 days', '{}'),
  ('00000000-0000-4000-8000-000000000003', 'outsider@example.com', now(), NULL, '{}');

INSERT INTO public.urls (short_code, original_url, created_by) VALUES
  ('seedown1', 'https://example.org/owner-1', '00000000-0000-4000-8000-000000000001'),
  ('seedown2', 'https://example.org/owner-2', '00000000-0000-4000-8000-000000000001'),
  ('seedoth1', 'https://example.org/other-1', '00000000-0000-4000-8000-000000000002');

INSERT INTO public.url_clicks (url_id, event_type)
SELECT id, 'link_click' FROM public.urls WHERE short_code IN ('seedown1', 'seedoth1');
