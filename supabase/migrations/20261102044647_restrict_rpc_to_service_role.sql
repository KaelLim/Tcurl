-- =====================================================================
-- TCurl：收回 authenticated 對 SECURITY DEFINER 函式的 EXECUTE（advisor 0029）
--
-- 統計 RPC 只由 Worker 以 service role 呼叫（src/routes/url-stats.ts）：
--   p_user_id 取自已驗證的使用者 JWT；get_url_stats 先以使用者 client 在 RLS 下確認擁有權。
-- 前端不直接呼叫任何 RPC；get_current_user_profile 沒有任何呼叫端。
-- 函式內 [FIX-2] 的呼叫者檢查保留，作為第二道防線。
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.get_daily_stats(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_stats_summary(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_url_stats(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_urls_with_stats(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_current_user_profile() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_daily_stats(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_stats_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_url_stats(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_urls_with_stats(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_current_user_profile() TO service_role;
