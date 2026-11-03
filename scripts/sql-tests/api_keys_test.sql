-- =====================================================================
-- API 金鑰 migration（supabase/migrations/20261103000000_api_keys.sql）的 SQL 測試
--
-- 單一 DO 區塊，最後一定 RAISE EXCEPTION 'API_KEYS_TEST …'，整段回滾、不留任何資料。
-- 報告在錯誤訊息裡：第一行 passed=N failed=M，之後每個案例一行 PASS / FAIL
-- （FAIL 後面列出失敗的子檢查）。
--
-- 本機：bash scripts/sql-tests/run-local.sh（docker 拋棄式 postgres:17，見該檔說明）
-- 正式庫（Task 9，套用 migration 之後）：以 Supabase MCP execute_sql 原封不動執行本檔。
--   本檔不新增 auth.users：以 email 找 kael1996@tzuchi.org.tw，另挑任一其他「有效的
--   @tzuchi.org.tw」帳號（登入過、未刪除、未停權；v_other，兼作執行的管理者 p_actor）、
--   任一第三位使用者（v_third），以及任一非慈濟帳號（若有）。案例 2b 會暫時改 v_other 的
--   auth.users.last_sign_in_at / banned_until，案例 6 會暫時改負責同仁的 banned_until / deleted_at，
--   都在同一案例內就改回，且整段最後回滾。
--
-- 模擬呼叫者：request.jwt.claims 的 role（service_role = Worker；authenticated / anon = 網頁直連），
--             request.headers 的 x-tcurl-api-key-id（Worker 處理金鑰請求時帶的標頭）。
--             案例 7、8 的網頁直連操作另以 SET LOCAL ROLE authenticated / anon 執行，讓 RLS 生效
--             （Cloud 的 postgres 可切換到這兩個角色，2026-11-03 以 pg_has_role 確認）。
--             案例 14 的 role 用 supabase_admin 與任意字串，只改 claims、不切換資料庫角色。
-- =====================================================================
DO $$
DECLARE
  v_report text := '';
  v_case text;
  v_fail text;

  v_tag text := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  v_owner uuid;
  v_owner_email text;
  v_other uuid;
  v_other_email text;
  v_third uuid;
  v_outsider_email text;
  v_actor uuid;
  v_saved_ts timestamptz;

  v_k1 uuid;
  v_k1_hash text := encode(sha256(convert_to('k1-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_k2 uuid;
  v_k2_hash text := encode(sha256(convert_to('k2-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_k3 uuid;
  v_k3_hash text := encode(sha256(convert_to('k3-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_kro_hash text := encode(sha256(convert_to('kro-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_kro uuid;
  v_k4 uuid;
  v_k4_hash text := encode(sha256(convert_to('k4-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  -- 格式正確、但不該被當成雜湊或前綴傳進來的「完整金鑰」（tcurl_sk_ + 43 字元）
  v_fake_key text := 'tcurl_sk_' || rpad(replace(gen_random_uuid()::text, '-', ''), 43, 'Zq');

  v_manual uuid;
  v_u7 uuid;
  v_u8 uuid;
  v_u8b uuid;
  v_k1_url uuid;
  v_u10a uuid;
  v_u10b uuid;
  v_u10x uuid;

  v_u13 uuid;
  v_uid uuid;

  v_res json;
  v_row jsonb;
  v_cnt int;
  v_cnt2 int;
  v_cnt3 int;
  v_txt text;
  v_msg text;
  v_detail text;
  v_ts timestamptz;
  v_shape text[] := ARRAY['id', 'name', 'key_prefix', 'scopes', 'owner_id', 'owner_email',
    'owner_status', 'owner_last_sign_in_at', 'created_by_email', 'created_at', 'expires_at',
    'revoked_at', 'last_used_at', 'status', 'url_count'];
  v_rpcs text[] := ARRAY[
    'public.verify_api_key(text)',
    'public.create_api_key(text,text,text[],timestamptz,text,text,uuid)',
    'public.revoke_api_key(uuid,uuid)',
    'public.update_api_key(uuid,uuid,text,timestamptz,boolean,text)',
    'public.list_api_keys()',
    'public.get_urls_with_stats(uuid,integer,integer,uuid)',
    'public.get_stats_summary(uuid,uuid)',
    'public.get_daily_stats(uuid,integer,uuid)'];
BEGIN
  -- ------------------------------------------------------------------
  -- 準備：使用者與一筆負責同仁「手動建立」的短網址（api_key_id 為 null）
  -- ------------------------------------------------------------------
  SELECT id, email INTO v_owner, v_owner_email
    FROM auth.users WHERE lower(email) = 'kael1996@tzuchi.org.tw' ORDER BY id LIMIT 1;
  SELECT id, email INTO v_other, v_other_email
    FROM auth.users
   WHERE id <> v_owner AND deleted_at IS NULL AND last_sign_in_at IS NOT NULL
     AND (banned_until IS NULL OR banned_until <= now())
     AND lower(email) ~ '^[^@[:space:]]+@tzuchi\.org\.tw$'
   ORDER BY id LIMIT 1;
  SELECT id INTO v_third FROM auth.users WHERE id NOT IN (v_owner, v_other) ORDER BY id LIMIT 1;
  SELECT email INTO v_outsider_email
    FROM auth.users
   WHERE email IS NOT NULL AND deleted_at IS NULL
     AND lower(email) !~ '^[^@[:space:]]+@tzuchi\.org\.tw$'
   ORDER BY id LIMIT 1;
  v_actor := v_other;

  IF v_owner IS NULL OR v_other IS NULL OR v_third IS NULL THEN
    RAISE EXCEPTION 'API_KEYS_TEST %', E'passed=0 failed=1\nFAIL 0 setup: need kael1996@tzuchi.org.tw, '
      'another active @tzuchi.org.tw account and a third account';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers', '', true);
  INSERT INTO public.urls (short_code, original_url, created_by)
  VALUES ('akm' || v_tag, 'https://example.org/api-keys-test/manual', v_owner)
  RETURNING id INTO v_manual;

  -- ------------------------------------------------------------------
  v_case := '1 create_api_key: owner email trimmed + case-insensitive; issue_api_key audit without key_hash';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_res := public.create_api_key(
      p_name => '  API test key 1 ', p_owner_email => '  KAEL1996@TZUCHI.ORG.TW ',
      p_scopes => ARRAY['read', 'write'], p_expires_at => now() + interval '365 days',
      p_key_prefix => 'tcurl_sk_test01', p_key_hash => v_k1_hash, p_actor => v_actor);
    v_k1 := (v_res ->> 'id')::uuid;
    v_fail := v_fail || CASE WHEN v_k1 IS NOT NULL THEN '' ELSE ' id;' END;
    v_fail := v_fail || CASE WHEN (v_res ->> 'owner_id')::uuid = v_owner THEN '' ELSE ' owner_id;' END;
    v_fail := v_fail || CASE WHEN v_res ->> 'owner_email' = v_owner_email THEN '' ELSE ' owner_email;' END;
    v_fail := v_fail || CASE WHEN v_res ->> 'name' = 'API test key 1' THEN '' ELSE ' name-trim;' END;
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'active' AND v_res ->> 'owner_status' = 'active'
                             THEN '' ELSE ' status;' END;
    v_fail := v_fail || CASE WHEN v_res::jsonb ?& v_shape THEN '' ELSE ' shape;' END;
    v_fail := v_fail || CASE WHEN (v_res ->> 'url_count')::int = 0 THEN '' ELSE ' url_count;' END;
    v_fail := v_fail || CASE WHEN NOT (v_res::jsonb ? 'key_hash') AND position(v_k1_hash IN v_res::text) = 0
                             THEN '' ELSE ' result-has-hash;' END;
    v_fail := v_fail || CASE WHEN (SELECT key_hash FROM public.api_keys WHERE id = v_k1) = v_k1_hash
                             AND (SELECT created_by FROM public.api_keys WHERE id = v_k1) = v_actor
                             THEN '' ELSE ' stored-row;' END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE action = 'issue_api_key' AND api_key_id = v_k1 AND resource_type = 'api_key'
       AND resource_id = v_k1 AND user_id = v_actor
       AND NOT coalesce(new_values ? 'key_hash', false)
       AND position(v_k1_hash IN coalesce(new_values::text, '') || coalesce(old_values::text, '')) = 0;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' audit=%s;', v_cnt) END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '2 create_api_key: unknown owner -> P0002 owner_not_found';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => 'nobody-' || v_tag || '@tzuchi.org.tw',
        p_scopes => ARRAY['read'], p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test02',
        p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
        p_actor => v_actor);
      v_fail := v_fail || ' unknown:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'owner_not_found' THEN ''
                               ELSE format(' unknown:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    -- 非 @tzuchi.org.tw 的既有帳號不能當負責同仁（spec §6.6）
    IF v_outsider_email IS NOT NULL THEN
      BEGIN
        PERFORM public.create_api_key(
          p_name => 'x', p_owner_email => v_outsider_email,
          p_scopes => ARRAY['read'], p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test02',
          p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
          p_actor => v_actor);
        v_fail := v_fail || ' outsider:no-error;';
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'owner_not_found' THEN ''
                                 ELSE format(' outsider:%s %s;', SQLSTATE, SQLERRM) END;
      END;
    ELSE
      v_case := v_case || ' (no non-@tzuchi.org.tw account found: outsider check skipped)';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  -- spec §6.6：負責同仁必須「至少登入過一次」；停權中的帳號也不能成為負責同仁（否則發出去的
  -- 金鑰每次都 owner_banned → 401，與 §6.2.1「轉給有效的同仁後金鑰恢復可用」不符）。
  -- 暫時改 v_other 的 last_sign_in_at / banned_until，同一案例內就改回（整段最後也會回滾）。
  v_case := '2b create/update_api_key: owner never signed in / currently banned -> P0002 owner_not_found';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_fail := v_fail || CASE WHEN public.api_key_owner_id(v_other_email) = v_other THEN '' ELSE ' precondition;' END;

    SELECT last_sign_in_at INTO v_saved_ts FROM auth.users WHERE id = v_other;
    UPDATE auth.users SET last_sign_in_at = NULL WHERE id = v_other;
    v_fail := v_fail || CASE WHEN public.api_key_owner_id(v_other_email) IS NULL THEN '' ELSE ' never-signed-in:owner-id;' END;
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => v_other_email,
        p_scopes => ARRAY['read'], p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test2b',
        p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
        p_actor => v_actor);
      v_fail := v_fail || ' never-signed-in-create:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'owner_not_found' THEN ''
                               ELSE format(' never-signed-in-create:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.update_api_key(v_k1, v_actor, p_new_owner_email => v_other_email);
      v_fail := v_fail || ' never-signed-in-transfer:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'owner_not_found' THEN ''
                               ELSE format(' never-signed-in-transfer:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    UPDATE auth.users SET last_sign_in_at = v_saved_ts WHERE id = v_other;

    SELECT banned_until INTO v_saved_ts FROM auth.users WHERE id = v_other;
    UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = v_other;
    v_fail := v_fail || CASE WHEN public.api_key_owner_id(v_other_email) IS NULL THEN '' ELSE ' banned:owner-id;' END;
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => v_other_email,
        p_scopes => ARRAY['read'], p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test2b',
        p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
        p_actor => v_actor);
      v_fail := v_fail || ' banned-create:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'owner_not_found' THEN ''
                               ELSE format(' banned-create:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.update_api_key(v_k1, v_actor, p_new_owner_email => v_other_email);
      v_fail := v_fail || ' banned-transfer:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'owner_not_found' THEN ''
                               ELSE format(' banned-transfer:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    -- 停權期限已過 → 又可以當負責同仁
    UPDATE auth.users SET banned_until = now() - interval '1 day' WHERE id = v_other;
    v_fail := v_fail || CASE WHEN public.api_key_owner_id(v_other_email) = v_other THEN '' ELSE ' ban-expired;' END;
    UPDATE auth.users SET banned_until = v_saved_ts WHERE id = v_other;

    -- 被拒的轉移沒有改到金鑰，也沒有寫稽核
    v_fail := v_fail || CASE WHEN (SELECT owner_id FROM public.api_keys WHERE id = v_k1) = v_owner
                             THEN '' ELSE ' k1-owner-changed;' END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs WHERE action = 'transfer_api_key' AND api_key_id = v_k1;
    v_fail := v_fail || CASE WHEN v_cnt = 0 THEN '' ELSE format(' transfer-audit=%s;', v_cnt) END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '3 create_api_key: past expiry / bad scopes / blank name -> 22023';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => v_owner_email, p_scopes => ARRAY['read', 'write'],
        p_expires_at => now() - interval '1 day', p_key_prefix => 'tcurl_sk_test03',
        p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
        p_actor => v_actor);
      v_fail := v_fail || ' past-expiry:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' THEN '' ELSE format(' past-expiry:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => v_owner_email, p_scopes => '{admin}',
        p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test03',
        p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
        p_actor => v_actor);
      v_fail := v_fail || ' scopes-admin:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' THEN '' ELSE format(' scopes-admin:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => v_owner_email, p_scopes => '{}',
        p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test03',
        p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
        p_actor => v_actor);
      v_fail := v_fail || ' scopes-empty:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' THEN '' ELSE format(' scopes-empty:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.create_api_key(
        p_name => E' \t ', p_owner_email => v_owner_email, p_scopes => ARRAY['read'],
        p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test03',
        p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
        p_actor => v_actor);
      v_fail := v_fail || ' blank-name:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' THEN '' ELSE format(' blank-name:%s %s;', SQLSTATE, SQLERRM) END;
    END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '4 verify_api_key: ok + scopes + last_used_at (written at most once a minute)';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_res := public.verify_api_key(v_k1_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'ok' THEN '' ELSE format(' status=%s;', v_res ->> 'status') END;
    v_fail := v_fail || CASE WHEN (v_res ->> 'key_id')::uuid = v_k1 AND (v_res ->> 'owner_id')::uuid = v_owner
                             AND v_res ->> 'name' = 'API test key 1' THEN '' ELSE ' ids;' END;
    v_fail := v_fail || CASE WHEN (v_res -> 'scopes')::jsonb = '["read", "write"]'::jsonb THEN '' ELSE ' scopes;' END;
    v_fail := v_fail || CASE WHEN position(v_k1_hash IN v_res::text) = 0 THEN '' ELSE ' result-has-hash;' END;
    SELECT last_used_at INTO v_ts FROM public.api_keys WHERE id = v_k1;
    v_fail := v_fail || CASE WHEN v_ts = now() THEN '' ELSE ' last_used_at-not-set;' END;
    UPDATE public.api_keys SET last_used_at = now() - interval '30 seconds' WHERE id = v_k1;
    PERFORM public.verify_api_key(v_k1_hash);
    SELECT last_used_at INTO v_ts FROM public.api_keys WHERE id = v_k1;
    v_fail := v_fail || CASE WHEN v_ts = now() - interval '30 seconds' THEN '' ELSE ' rewritten-within-1min;' END;
    UPDATE public.api_keys SET last_used_at = now() - interval '2 minutes' WHERE id = v_k1;
    PERFORM public.verify_api_key(v_k1_hash);
    SELECT last_used_at INTO v_ts FROM public.api_keys WHERE id = v_k1;
    v_fail := v_fail || CASE WHEN v_ts = now() THEN '' ELSE ' not-rewritten-after-1min;' END;
    -- read-only key; duplicate scopes are normalised
    PERFORM public.create_api_key(
      p_name => 'API test key ro', p_owner_email => v_owner_email, p_scopes => ARRAY['read', 'read'],
      p_expires_at => NULL, p_key_prefix => 'tcurl_sk_testro', p_key_hash => v_kro_hash,
      p_actor => v_actor);
    v_res := public.verify_api_key(v_kro_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'ok' AND (v_res -> 'scopes')::jsonb = '["read"]'::jsonb
                             THEN '' ELSE format(' read-only=%s;', v_res::text) END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '5 verify_api_key: expired / revoked (+ revoke_api_key audit, idempotent) / not_found; unknown id -> P0002';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    UPDATE public.api_keys SET expires_at = now() - interval '1 second' WHERE id = v_k1;
    v_res := public.verify_api_key(v_k1_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'expired' THEN '' ELSE format(' expired=%s;', v_res ->> 'status') END;
    v_fail := v_fail || CASE WHEN NOT (v_res::jsonb ? 'owner_id') THEN '' ELSE ' non-ok-leaks-owner;' END;

    v_res := public.revoke_api_key(v_k1, v_actor);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'revoked' AND v_res ->> 'revoked_at' IS NOT NULL
                             THEN '' ELSE ' revoke-result;' END;
    v_fail := v_fail || CASE WHEN (SELECT revoked_by FROM public.api_keys WHERE id = v_k1) = v_actor
                             THEN '' ELSE ' revoked_by;' END;
    v_res := public.verify_api_key(v_k1_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'revoked' THEN '' ELSE format(' revoked=%s;', v_res ->> 'status') END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE action = 'revoke_api_key' AND api_key_id = v_k1 AND resource_type = 'api_key'
       AND resource_id = v_k1 AND user_id = v_actor
       AND NOT coalesce(new_values ? 'key_hash', false) AND NOT coalesce(old_values ? 'key_hash', false);
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' audit=%s;', v_cnt) END;

    -- 再撤銷一次：不變、不再寫稽核
    SELECT revoked_at INTO v_ts FROM public.api_keys WHERE id = v_k1;
    UPDATE public.api_keys SET revoked_at = revoked_at - interval '1 hour' WHERE id = v_k1;
    v_res := public.revoke_api_key(v_k1, v_actor);
    v_fail := v_fail || CASE WHEN (SELECT revoked_at FROM public.api_keys WHERE id = v_k1) = v_ts - interval '1 hour'
                             THEN '' ELSE ' re-revoke-changed;' END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs WHERE action = 'revoke_api_key' AND api_key_id = v_k1;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' re-revoke-audit=%s;', v_cnt) END;

    v_res := public.verify_api_key(encode(sha256(convert_to('nope-' || gen_random_uuid()::text, 'UTF8')), 'hex'));
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'not_found' THEN '' ELSE format(' not_found=%s;', v_res ->> 'status') END;
    v_res := public.verify_api_key(NULL);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'not_found' THEN '' ELSE ' null-hash;' END;

    BEGIN
      PERFORM public.revoke_api_key(gen_random_uuid(), v_actor);
      v_fail := v_fail || ' revoke-unknown:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'api_key_not_found' THEN ''
                               ELSE format(' revoke-unknown:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.update_api_key(p_key_id => gen_random_uuid(), p_actor => v_actor, p_name => 'x');
      v_fail := v_fail || ' update-unknown:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'api_key_not_found' THEN ''
                               ELSE format(' update-unknown:%s %s;', SQLSTATE, SQLERRM) END;
    END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '6 verify_api_key: owner banned -> owner_banned; owner soft-deleted -> owner_missing';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_res := public.create_api_key(
      p_name => 'API test key 2', p_owner_email => v_owner_email, p_scopes => ARRAY['write', 'read'],
      p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test02', p_key_hash => v_k2_hash,
      p_actor => v_actor);
    v_k2 := (v_res ->> 'id')::uuid;
    v_fail := v_fail || CASE WHEN v_res ->> 'expires_at' IS NULL AND (v_res -> 'scopes')::jsonb = '["read", "write"]'::jsonb
                             THEN '' ELSE ' create-k2;' END;
    v_res := public.verify_api_key(v_k2_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'ok' THEN '' ELSE format(' before=%s;', v_res ->> 'status') END;

    SELECT banned_until INTO v_saved_ts FROM auth.users WHERE id = v_owner;
    UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = v_owner;
    v_res := public.verify_api_key(v_k2_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'owner_banned' THEN '' ELSE format(' banned=%s;', v_res ->> 'status') END;
    SELECT e INTO v_row FROM jsonb_array_elements(public.list_api_keys()::jsonb) e WHERE e ->> 'id' = v_k2::text;
    v_fail := v_fail || CASE WHEN v_row ->> 'owner_status' = 'banned' THEN '' ELSE ' list-banned;' END;
    UPDATE auth.users SET banned_until = v_saved_ts WHERE id = v_owner;

    SELECT deleted_at INTO v_saved_ts FROM auth.users WHERE id = v_owner;
    UPDATE auth.users SET deleted_at = now() WHERE id = v_owner;
    v_res := public.verify_api_key(v_k2_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'owner_missing' THEN '' ELSE format(' soft-deleted=%s;', v_res ->> 'status') END;
    UPDATE auth.users SET deleted_at = v_saved_ts WHERE id = v_owner;

    v_res := public.verify_api_key(v_k2_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'ok' THEN '' ELSE format(' after-restore=%s;', v_res ->> 'status') END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  -- 以真正的 authenticated / anon 角色（RLS 生效）加上對應的 JWT claims 模擬網頁直連 Supabase。
  -- RLS 違規也是 42501，所以另外比對 guard 的訊息（以 'api_key_id ' 開頭）。
  v_case := '7 guard: anon/authenticated cannot set or change urls.api_key_id; other edits still work';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak7' || v_tag, 'https://example.org/api-keys-test/k2-a', v_owner, v_k2)
    RETURNING id INTO v_u7;

    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_owner)::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
      VALUES ('ak7i' || v_tag, 'https://example.org/api-keys-test/forged', v_owner, v_k2);
      v_fail := v_fail || ' insert-with-key:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'api_key_id %' THEN ''
                               ELSE format(' insert-with-key:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      UPDATE public.urls SET api_key_id = v_k2 WHERE id = v_manual;
      v_fail := v_fail || ' set-key:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'api_key_id %' THEN ''
                               ELSE format(' set-key:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      UPDATE public.urls SET api_key_id = NULL WHERE id = v_u7;
      v_fail := v_fail || ' clear-key:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'api_key_id %' THEN ''
                               ELSE format(' clear-key:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    UPDATE public.urls SET original_url = 'https://example.org/api-keys-test/manual-edited' WHERE id = v_manual;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE ' edit-manual;' END;
    UPDATE public.urls SET is_active = true, api_key_id = v_k2 WHERE id = v_u7;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE ' edit-key-url-same-key;' END;
    INSERT INTO public.urls (short_code, original_url, created_by)
    VALUES ('ak7w' || v_tag, 'https://example.org/api-keys-test/web', v_owner);
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE ' web-insert;' END;

    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    BEGIN
      INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
      VALUES ('ak7a' || v_tag, 'https://example.org/api-keys-test/anon', NULL, v_k2);
      v_fail := v_fail || ' anon-insert-with-key:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '42501' AND SQLERRM LIKE 'api_key_id %' THEN ''
                               ELSE format(' anon-insert-with-key:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

    v_fail := v_fail || CASE WHEN (SELECT api_key_id FROM public.urls WHERE id = v_manual) IS NULL
                             AND (SELECT api_key_id FROM public.urls WHERE id = v_u7) = v_k2
                             AND (SELECT original_url FROM public.urls WHERE id = v_manual)
                                 = 'https://example.org/api-keys-test/manual-edited'
                             THEN '' ELSE ' rows-after;' END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '8 audit: x-tcurl-api-key-id header recorded only for service_role (create/update/delete), ignored otherwise';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.headers', json_build_object('x-tcurl-api-key-id', v_k2)::text, true);
    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak8' || v_tag, 'https://example.org/api-keys-test/k2-b', v_owner, v_k2)
    RETURNING id INTO v_u8;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE resource_id = v_u8 AND action = 'create_url' AND api_key_id = v_k2;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' create-attributed=%s;', v_cnt) END;

    -- 一般使用者帶同一個標頭：不採信
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_owner)::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.urls SET original_url = 'https://example.org/api-keys-test/k2-b-edited' WHERE id = v_u8;
    RESET ROLE;
    SELECT count(*), count(*) FILTER (WHERE api_key_id IS NULL AND user_id = v_owner) INTO v_cnt, v_cnt2
      FROM public.audit_logs WHERE resource_id = v_u8 AND action = 'update_url';
    v_fail := v_fail || CASE WHEN v_cnt = 1 AND v_cnt2 = 1 THEN '' ELSE format(' user-header=%s/%s;', v_cnt2, v_cnt) END;

    -- 用金鑰改（spec §8.12）：service_role 帶標頭的 UPDATE，update_url 與 update_qrcode 都記上金鑰
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.headers', json_build_object('x-tcurl-api-key-id', v_k2)::text, true);
    UPDATE public.urls SET original_url = 'https://example.org/api-keys-test/k2-b-key-edited' WHERE id = v_u8;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE resource_id = v_u8 AND action = 'update_url' AND api_key_id = v_k2 AND user_id IS NULL;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' update-attributed=%s;', v_cnt) END;
    UPDATE public.urls SET qr_code_options = '{"dotsColor":"#000000"}'::jsonb WHERE id = v_u8;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE resource_id = v_u8 AND action = 'update_qrcode' AND api_key_id = v_k2;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' update-qrcode-attributed=%s;', v_cnt) END;

    -- service_role 但標頭不是 uuid：忽略，寫入照常成功
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.headers', '{"x-tcurl-api-key-id":"not-a-uuid"}', true);
    INSERT INTO public.urls (short_code, original_url, created_by)
    VALUES ('ak8b' || v_tag, 'https://example.org/api-keys-test/bad-header', v_owner)
    RETURNING id INTO v_u8b;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE resource_id = v_u8b AND action = 'create_url' AND api_key_id IS NULL;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' bad-header=%s;', v_cnt) END;

    -- service_role 沒有標頭（準備階段建立的手動短網址）
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE resource_id = v_manual AND action = 'create_url' AND api_key_id IS NULL;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' no-header=%s;', v_cnt) END;

    -- 刪除也記上金鑰
    PERFORM set_config('request.headers', json_build_object('x-tcurl-api-key-id', v_k2)::text, true);
    DELETE FROM public.urls WHERE id = v_u8b;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE resource_id = v_u8b AND action = 'delete_url' AND api_key_id = v_k2;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' delete-attributed=%s;', v_cnt) END;
    PERFORM set_config('request.headers', '', true);
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '9 stats RPCs: p_api_key_id limits to that key''s urls; null keeps manual urls; api_key_name/revoked';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.headers', '', true);
    INSERT INTO public.url_clicks (url_id, event_type) VALUES (v_u8, 'link_click'), (v_manual, 'link_click');
    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak9' || v_tag, 'https://example.org/api-keys-test/k1', v_owner, v_k1)
    RETURNING id INTO v_k1_url;
    SELECT count(*) INTO v_cnt2 FROM public.urls WHERE api_key_id = v_k2 AND created_by = v_owner AND is_active;

    v_res := public.get_urls_with_stats(v_owner, 1, 100, v_k2);
    SELECT count(*),
           count(*) FILTER (WHERE e ->> 'api_key_id' = v_k2::text AND e ->> 'created_by' = v_owner::text
                              AND e ->> 'api_key_name' = 'API test key 2'
                              AND (e ->> 'api_key_revoked')::boolean = false)
      INTO v_cnt, v_cnt3
      FROM jsonb_array_elements((v_res -> 'data')::jsonb) e;
    v_fail := v_fail || CASE WHEN v_cnt = v_cnt2 AND v_cnt3 = v_cnt2 AND v_cnt2 >= 2 THEN ''
                             ELSE format(' with-key rows=%s matching=%s expected=%s;', v_cnt, v_cnt3, v_cnt2) END;
    v_fail := v_fail || CASE WHEN (v_res -> 'pagination' ->> 'total')::int = v_cnt2 THEN '' ELSE ' with-key-total;' END;
    v_fail := v_fail || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements((v_res -> 'data')::jsonb) e
                                           WHERE e ->> 'id' = v_u8::text
                                             AND e ?& ARRAY['id', 'short_code', 'original_url', 'created_at',
                                               'is_active', 'clicks', 'link_clicks', 'qr_scans', 'ad_views',
                                               'ad_clicks', 'last_clicked_at', 'qr_code_generated',
                                               'qr_code_path', 'qr_code_options', 'password_protected',
                                               'expires_at', 'created_by', 'api_key_id', 'api_key_name',
                                               'api_key_revoked']
                                             AND (e ->> 'clicks')::int = 1)
                             THEN '' ELSE ' row-shape;' END;

    v_res := public.get_urls_with_stats(v_owner, 1, 100);
    v_fail := v_fail || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements((v_res -> 'data')::jsonb) e
                                           WHERE e ->> 'id' = v_manual::text AND e -> 'api_key_id' = 'null'::jsonb
                                             AND e -> 'api_key_name' = 'null'::jsonb
                                             AND e -> 'api_key_revoked' = 'false'::jsonb)
                             AND EXISTS (SELECT 1 FROM jsonb_array_elements((v_res -> 'data')::jsonb) e
                                          WHERE e ->> 'id' = v_u8::text)
                             THEN '' ELSE ' no-key-missing-rows;' END;

    v_res := public.get_urls_with_stats(v_owner, 1, 100, v_k1);
    v_fail := v_fail || CASE WHEN json_array_length(v_res -> 'data') = 1
                             AND (v_res -> 'data' -> 0 ->> 'id')::uuid = v_k1_url
                             AND (v_res -> 'data' -> 0 ->> 'api_key_revoked')::boolean
                             THEN '' ELSE ' revoked-key-row;' END;

    v_res := public.get_urls_with_stats(v_other, 1, 100, v_k2);
    v_fail := v_fail || CASE WHEN json_array_length(v_res -> 'data') = 0 THEN '' ELSE ' other-user-with-k2;' END;

    v_res := public.get_stats_summary(v_owner, v_k2);
    v_fail := v_fail || CASE WHEN (v_res ->> 'totalLinks')::int = v_cnt2 AND (v_res ->> 'activeLinks')::int = v_cnt2
                             AND (v_res ->> 'totalClicks')::int = 1
                             THEN '' ELSE format(' summary-with-key=%s;', v_res::text) END;
    v_res := public.get_stats_summary(v_owner);
    v_fail := v_fail || CASE WHEN (v_res ->> 'totalLinks')::int >= v_cnt2 + 2 AND (v_res ->> 'totalClicks')::int >= 2
                             THEN '' ELSE format(' summary-no-key=%s;', v_res::text) END;

    v_res := public.get_daily_stats(v_owner, 7, v_k2);
    v_fail := v_fail || CASE WHEN json_array_length(v_res) = 8
                             AND (SELECT (e ->> 'link_clicks')::int FROM json_array_elements(v_res) e
                                   WHERE (e ->> 'date')::date = CURRENT_DATE) = 1
                             THEN '' ELSE format(' daily-with-key=%s;', v_res::text) END;
    v_res := public.get_daily_stats(v_owner, 7);
    v_fail := v_fail || CASE WHEN (SELECT (e ->> 'link_clicks')::int FROM json_array_elements(v_res) e
                                    WHERE (e ->> 'date')::date = CURRENT_DATE) >= 2
                             THEN '' ELSE ' daily-no-key;' END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  -- 模擬負責同仁帳號被刪除：auth.users 的 ON DELETE SET NULL 會把 api_keys.owner_id 與
  -- 他「所有」短網址的 created_by 都設成 null；這裡照樣模擬（另放一筆 api_key_id 被錯設、
  -- 屬於第三位使用者的短網址，轉移時不得被搬走）。
  v_case := '10 transfer: deleted owner -> owner_missing; update_api_key moves key urls (old owner or null), audit with moved url ids, revoked stays revoked';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.headers', '', true);
    v_res := public.create_api_key(
      p_name => 'API test key 3', p_owner_email => v_owner_email, p_scopes => ARRAY['read', 'write'],
      p_expires_at => now() + interval '90 days', p_key_prefix => 'tcurl_sk_test03',
      p_key_hash => v_k3_hash, p_actor => v_actor);
    v_k3 := (v_res ->> 'id')::uuid;
    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak10a' || v_tag, 'https://example.org/api-keys-test/k3-a', v_owner, v_k3)
    RETURNING id INTO v_u10a;
    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak10b' || v_tag, 'https://example.org/api-keys-test/k3-b', v_owner, v_k3)
    RETURNING id INTO v_u10b;
    -- 新增時 created_by 一律取金鑰目前的負責同仁（案例 13），所以「錯設」只能事後以 UPDATE 造出來
    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak10x' || v_tag, 'https://example.org/api-keys-test/k3-x', v_owner, v_k3)
    RETURNING id INTO v_u10x;
    UPDATE public.urls SET created_by = v_third WHERE id = v_u10x;

    UPDATE public.api_keys SET owner_id = NULL WHERE id = v_k3;
    UPDATE public.urls SET created_by = NULL WHERE id IN (v_u10a, v_u10b);
    v_res := public.verify_api_key(v_k3_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'owner_missing' THEN '' ELSE format(' deleted=%s;', v_res ->> 'status') END;
    SELECT e INTO v_row FROM jsonb_array_elements(public.list_api_keys()::jsonb) e WHERE e ->> 'id' = v_k3::text;
    v_fail := v_fail || CASE WHEN v_row ->> 'owner_status' = 'deleted' THEN '' ELSE ' list-deleted;' END;

    v_res := public.update_api_key(v_k3, v_actor, p_new_owner_email => ' ' || upper(v_other_email) || ' ');
    v_fail := v_fail || CASE WHEN (v_res ->> 'owner_id')::uuid = v_other THEN '' ELSE ' result-owner;' END;
    v_fail := v_fail || CASE WHEN (SELECT created_by FROM public.urls WHERE id = v_u10a) = v_other
                             AND (SELECT created_by FROM public.urls WHERE id = v_u10b) = v_other
                             THEN '' ELSE ' rescue-null-urls;' END;
    v_fail := v_fail || CASE WHEN (SELECT created_by FROM public.urls WHERE id = v_u10x) = v_third
                             THEN '' ELSE ' moved-third-party-url;' END;
    v_fail := v_fail || CASE WHEN (SELECT created_by FROM public.urls WHERE id = v_manual) = v_owner
                             THEN '' ELSE ' moved-manual-url;' END;
    v_res := public.verify_api_key(v_k3_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'ok' AND (v_res ->> 'owner_id')::uuid = v_other
                             THEN '' ELSE format(' after-transfer=%s;', v_res ->> 'status') END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE action = 'transfer_api_key' AND api_key_id = v_k3 AND resource_type = 'api_key'
       AND resource_id = v_k3 AND user_id = v_actor
       AND old_values ? 'owner_id' AND old_values -> 'owner_id' = 'null'::jsonb
       AND new_values ->> 'owner_id' = v_other::text
       AND NOT coalesce(new_values ? 'key_hash', false) AND NOT coalesce(old_values ? 'key_hash', false);
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' audit-from-null=%s;', v_cnt) END;
    -- 稽核列記下被搬移的短網址 id（各筆 update_url 稽核列沒有歸屬，只能靠這裡對應）
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE action = 'transfer_api_key' AND api_key_id = v_k3 AND new_values ->> 'owner_id' = v_other::text
       AND (new_values ->> 'urls_moved')::int = 2
       AND jsonb_typeof(new_values -> 'moved_url_ids') = 'array'
       AND ARRAY(SELECT x FROM jsonb_array_elements_text(new_values -> 'moved_url_ids') x ORDER BY x)
           = ARRAY(SELECT x::text FROM unnest(ARRAY[v_u10a, v_u10b]) x ORDER BY 1);
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' moved-url-ids=%s;', v_cnt) END;

    -- 一般轉移（原負責人仍在）：只搬原負責人的短網址
    v_res := public.update_api_key(v_k3, v_actor, p_new_owner_email => v_owner_email);
    v_fail := v_fail || CASE WHEN (SELECT created_by FROM public.urls WHERE id = v_u10a) = v_owner
                             AND (SELECT created_by FROM public.urls WHERE id = v_u10b) = v_owner
                             AND (SELECT created_by FROM public.urls WHERE id = v_u10x) = v_third
                             THEN '' ELSE ' transfer-back;' END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE action = 'transfer_api_key' AND api_key_id = v_k3
       AND old_values ->> 'owner_id' = v_other::text AND new_values ->> 'owner_id' = v_owner::text;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' audit-back=%s;', v_cnt) END;

    -- 已撤銷的金鑰也可以轉移，但仍維持撤銷
    v_res := public.update_api_key(v_k1, v_actor, p_new_owner_email => v_other_email);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'revoked' AND (v_res ->> 'owner_id')::uuid = v_other
                             AND (SELECT created_by FROM public.urls WHERE id = v_k1_url) = v_other
                             THEN '' ELSE ' revoked-transfer;' END;
    v_res := public.verify_api_key(v_k1_hash);
    v_fail := v_fail || CASE WHEN v_res ->> 'status' = 'revoked' THEN '' ELSE format(' revoked-after=%s;', v_res ->> 'status') END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE action = 'transfer_api_key' AND api_key_id = v_k1
       AND new_values -> 'moved_url_ids' = jsonb_build_array(v_k1_url);
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' k1-moved-url-ids=%s;', v_cnt) END;

    -- 沒有短網址可搬：urls_moved = 0、moved_url_ids = []
    SELECT id INTO v_kro FROM public.api_keys WHERE key_hash = v_kro_hash;
    PERFORM public.update_api_key(v_kro, v_actor, p_new_owner_email => v_other_email);
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE action = 'transfer_api_key' AND api_key_id = v_kro
       AND (new_values ->> 'urls_moved')::int = 0 AND new_values -> 'moved_url_ids' = '[]'::jsonb;
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' empty-moved-url-ids=%s;', v_cnt) END;

    BEGIN
      PERFORM public.update_api_key(v_k3, v_actor, p_new_owner_email => 'nobody-' || v_tag || '@tzuchi.org.tw');
      v_fail := v_fail || ' unknown-new-owner:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = 'P0002' AND SQLERRM = 'owner_not_found' THEN ''
                               ELSE format(' unknown-new-owner:%s %s;', SQLSTATE, SQLERRM) END;
    END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '10b update_api_key: rename / set + clear expiry, update_api_key audit, invalid input -> 22023';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_res := public.update_api_key(v_k3, v_actor, p_name => '  Renamed key 3 ', p_expires_at => now() + interval '365 days');
    v_fail := v_fail || CASE WHEN v_res ->> 'name' = 'Renamed key 3'
                             AND (v_res ->> 'expires_at')::timestamptz = now() + interval '365 days'
                             THEN '' ELSE ' rename+expiry;' END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE action = 'update_api_key' AND api_key_id = v_k3 AND resource_type = 'api_key'
       AND resource_id = v_k3 AND user_id = v_actor
       AND old_values ->> 'name' = 'API test key 3' AND new_values ->> 'name' = 'Renamed key 3'
       AND NOT coalesce(new_values ? 'key_hash', false) AND NOT coalesce(old_values ? 'key_hash', false);
    v_fail := v_fail || CASE WHEN v_cnt = 1 THEN '' ELSE format(' audit=%s;', v_cnt) END;
    v_res := public.update_api_key(v_k3, v_actor, p_clear_expiry => true);
    v_fail := v_fail || CASE WHEN v_res ->> 'expires_at' IS NULL AND v_res ->> 'name' = 'Renamed key 3'
                             THEN '' ELSE ' clear-expiry;' END;
    -- 沒有任何變更：不寫稽核
    PERFORM public.update_api_key(v_k3, v_actor);
    SELECT count(*) INTO v_cnt FROM public.audit_logs WHERE action = 'update_api_key' AND api_key_id = v_k3;
    v_fail := v_fail || CASE WHEN v_cnt = 2 THEN '' ELSE format(' noop-audit=%s;', v_cnt) END;
    BEGIN
      PERFORM public.update_api_key(v_k3, v_actor, p_expires_at => now() - interval '1 minute');
      v_fail := v_fail || ' past-expiry:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' THEN '' ELSE format(' past-expiry:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.update_api_key(v_k3, v_actor, p_name => '   ');
      v_fail := v_fail || ' blank-name:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' THEN '' ELSE format(' blank-name:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.update_api_key(v_k3, v_actor, p_expires_at => now() + interval '90 days', p_clear_expiry => true);
      v_fail := v_fail || ' expiry-and-clear:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' THEN '' ELSE format(' expiry-and-clear:%s %s;', SQLSTATE, SQLERRM) END;
    END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '11 list_api_keys: public fields only, owner_status, status, url_count';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_res := public.list_api_keys();
    v_fail := v_fail || CASE WHEN json_typeof(v_res) = 'array' THEN '' ELSE ' not-array;' END;
    SELECT e INTO v_row FROM jsonb_array_elements(v_res::jsonb) e WHERE e ->> 'id' = v_k3::text;
    v_fail := v_fail || CASE WHEN v_row ?& v_shape THEN '' ELSE ' shape;' END;
    v_fail := v_fail || CASE WHEN v_row ->> 'owner_status' = 'active' AND (v_row ->> 'owner_id')::uuid = v_owner
                             AND v_row ->> 'owner_email' = v_owner_email
                             AND (v_row ->> 'owner_last_sign_in_at')::timestamptz IS NOT DISTINCT FROM
                                 (SELECT last_sign_in_at FROM auth.users WHERE id = v_owner)
                             THEN '' ELSE format(' owner=%s;', v_row::text) END;
    v_fail := v_fail || CASE WHEN (v_row ->> 'url_count')::int = 3 THEN '' ELSE format(' url_count=%s;', v_row ->> 'url_count') END;
    v_fail := v_fail || CASE WHEN v_row ->> 'status' = 'active' AND v_row ->> 'name' = 'Renamed key 3'
                             AND v_row ->> 'key_prefix' = 'tcurl_sk_test03'
                             AND v_row ->> 'created_by_email' = v_other_email
                             AND v_row -> 'scopes' = '["read", "write"]'::jsonb
                             THEN '' ELSE format(' fields=%s;', v_row::text) END;
    v_fail := v_fail || CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res::jsonb) e WHERE e ? 'key_hash')
                             AND position(v_k1_hash IN v_res::text) = 0 AND position(v_k2_hash IN v_res::text) = 0
                             AND position(v_k3_hash IN v_res::text) = 0
                             THEN '' ELSE ' leaks-hash;' END;
    SELECT e INTO v_row FROM jsonb_array_elements(v_res::jsonb) e WHERE e ->> 'id' = v_k1::text;
    v_fail := v_fail || CASE WHEN v_row ->> 'status' = 'revoked' AND (v_row ->> 'url_count')::int = 1
                             THEN '' ELSE ' k1-revoked;' END;
    UPDATE public.api_keys SET expires_at = now() - interval '1 minute', owner_id = NULL WHERE id = v_k2;
    SELECT e INTO v_row FROM jsonb_array_elements(public.list_api_keys()::jsonb) e WHERE e ->> 'id' = v_k2::text;
    v_fail := v_fail || CASE WHEN v_row ->> 'status' = 'expired' AND v_row ->> 'owner_status' = 'deleted'
                             AND v_row -> 'owner_email' = 'null'::jsonb
                             THEN '' ELSE format(' k2-expired-deleted=%s;', v_row::text) END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_case := '12 privileges: 8 new/changed RPCs service_role only, SECURITY DEFINER + empty search_path; internal helpers owner only; api_keys locked; no hash in audit; guard reads the key FOR SHARE';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    FOREACH v_txt IN ARRAY v_rpcs LOOP
      v_fail := v_fail || CASE WHEN NOT has_function_privilege('anon', v_txt, 'EXECUTE')
                               AND NOT has_function_privilege('authenticated', v_txt, 'EXECUTE')
                               AND NOT has_function_privilege('public', v_txt, 'EXECUTE')
                               THEN '' ELSE format(' exposed:%s;', v_txt) END;
      v_fail := v_fail || CASE WHEN has_function_privilege('service_role', v_txt, 'EXECUTE')
                               THEN '' ELSE format(' no-service_role:%s;', v_txt) END;
      v_fail := v_fail || CASE WHEN (SELECT prosecdef AND proconfig = ARRAY['search_path=""']
                                       FROM pg_proc WHERE oid = to_regprocedure(v_txt))
                               THEN '' ELSE format(' definer/search_path:%s;', v_txt) END;
    END LOOP;
    -- 內部工具：只有擁有者能執行（由上面的 SECURITY DEFINER RPC 以擁有者身分呼叫），
    -- 而且是 invoker、search_path 為空：就算權限被誤開，一般角色也讀不到 auth.users / api_keys
    FOREACH v_txt IN ARRAY ARRAY['public.api_key_owner_id(text)', 'public.api_key_json(uuid)'] LOOP
      v_fail := v_fail || CASE WHEN NOT has_function_privilege('anon', v_txt, 'EXECUTE')
                               AND NOT has_function_privilege('authenticated', v_txt, 'EXECUTE')
                               AND NOT has_function_privilege('service_role', v_txt, 'EXECUTE')
                               AND NOT has_function_privilege('public', v_txt, 'EXECUTE')
                               THEN '' ELSE format(' internal-exposed:%s;', v_txt) END;
      v_fail := v_fail || CASE WHEN (SELECT NOT prosecdef AND proconfig = ARRAY['search_path=""']
                                       FROM pg_proc WHERE oid = to_regprocedure(v_txt))
                               THEN '' ELSE format(' internal-invoker/search_path:%s;', v_txt) END;
    END LOOP;
    -- trigger 函式：一般角色不能直接執行
    FOREACH v_txt IN ARRAY ARRAY['public.guard_url_api_key_id()', 'public.log_url_changes()'] LOOP
      v_fail := v_fail || CASE WHEN NOT has_function_privilege('anon', v_txt, 'EXECUTE')
                               AND NOT has_function_privilege('authenticated', v_txt, 'EXECUTE')
                               AND NOT has_function_privilege('public', v_txt, 'EXECUTE')
                               THEN '' ELSE format(' trigger-fn-exposed:%s;', v_txt) END;
    END LOOP;
    -- guard 讀金鑰目前的負責同仁時要 FOR SHARE（與 update_api_key 的 FOR UPDATE 互斥，見案例 13 的說明）。
    -- 互斥本身需要兩個連線，由 scripts/sql-tests/race-check.sh 實測；這裡只檢查定義裡沒有拿掉它（唯讀 catalog）
    -- 先去掉 `--` 註解再比對，避免「-- was: FOR SHARE」這類註解騙過檢查
    v_fail := v_fail || CASE WHEN regexp_replace(pg_get_functiondef('public.guard_url_api_key_id()'::regprocedure), '--[^\n]*', '', 'g') ~* '\mFOR\s+SHARE\M'
                             THEN '' ELSE ' guard-without-for-share;' END;
    v_fail := v_fail || CASE WHEN to_regprocedure('public.get_urls_with_stats(uuid,integer,integer)') IS NULL
                             AND to_regprocedure('public.get_stats_summary(uuid)') IS NULL
                             AND to_regprocedure('public.get_daily_stats(uuid,integer)') IS NULL
                             THEN '' ELSE ' old-overloads-left;' END;
    v_fail := v_fail || CASE WHEN NOT has_table_privilege('anon', 'public.api_keys', 'SELECT')
                             AND NOT has_table_privilege('authenticated', 'public.api_keys', 'SELECT')
                             AND NOT has_table_privilege('authenticated', 'public.api_keys', 'INSERT')
                             AND NOT has_table_privilege('authenticated', 'public.api_keys', 'UPDATE')
                             AND has_table_privilege('service_role', 'public.api_keys', 'SELECT')
                             AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.api_keys'::regclass)
                             THEN '' ELSE ' api_keys-table;' END;
    -- 第二道防線：就算權限被誤開，一般使用者身分呼叫金鑰 RPC 也會被拒
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_owner)::text, true);
    BEGIN
      PERFORM public.list_api_keys();
      v_fail := v_fail || ' authenticated-list:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '42501' THEN '' ELSE format(' authenticated-list:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.verify_api_key(v_k3_hash);
      v_fail := v_fail || ' authenticated-verify:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '42501' THEN '' ELSE format(' authenticated-verify:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE resource_type = 'api_key'
       AND (coalesce(old_values ? 'key_hash', false) OR coalesce(new_values ? 'key_hash', false)
            OR position(v_k1_hash IN coalesce(old_values::text, '') || coalesce(new_values::text, '')) > 0
            OR position(v_k2_hash IN coalesce(old_values::text, '') || coalesce(new_values::text, '')) > 0
            OR position(v_k3_hash IN coalesce(old_values::text, '') || coalesce(new_values::text, '')) > 0
            OR position(v_kro_hash IN coalesce(old_values::text, '') || coalesce(new_values::text, '')) > 0);
    v_fail := v_fail || CASE WHEN v_cnt = 0 THEN '' ELSE format(' audit-has-hash=%s;', v_cnt) END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  -- Worker 以驗證當下的負責同仁寫 created_by；驗證與寫入之間金鑰若被轉移（已 commit），
  -- 新短網址仍要歸目前的負責同仁，否則金鑰與新負責人都看不到它，之後的轉移也搬不走。
  -- 這裡直接改 api_keys.owner_id 模擬「已 commit 的轉移」；與進行中轉移的互斥（FOR SHARE）
  -- 需要兩個連線，單一 DO 區塊測不到：本機以 scripts/sql-tests/race-check.sh 實測，案例 12 另檢查定義含 FOR SHARE。
  v_case := '13 guard: key url INSERT takes created_by from the key''s current owner; no owner / unknown key -> 42501';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.headers', '', true);
    v_res := public.create_api_key(
      p_name => 'API test key 4', p_owner_email => v_owner_email, p_scopes => ARRAY['read', 'write'],
      p_expires_at => NULL, p_key_prefix => 'tcurl_sk_test04', p_key_hash => v_k4_hash, p_actor => v_actor);
    v_k4 := (v_res ->> 'id')::uuid;
    UPDATE public.api_keys SET owner_id = v_other WHERE id = v_k4;

    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak13a' || v_tag, 'https://example.org/api-keys-test/k4-a', v_owner, v_k4)
    RETURNING id, created_by INTO v_u13, v_uid;
    v_fail := v_fail || CASE WHEN v_uid = v_other THEN '' ELSE format(' stale-owner=%s;', v_uid) END;
    v_fail := v_fail || CASE WHEN (SELECT created_by FROM public.urls WHERE id = v_u13) = v_other
                             THEN '' ELSE ' stored-created_by;' END;
    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak13b' || v_tag, 'https://example.org/api-keys-test/k4-b', NULL, v_k4)
    RETURNING created_by INTO v_uid;
    v_fail := v_fail || CASE WHEN v_uid = v_other THEN '' ELSE format(' null-created_by=%s;', v_uid) END;
    -- 直接連線（沒有 JWT claims）也一樣
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
    VALUES ('ak13c' || v_tag, 'https://example.org/api-keys-test/k4-c', v_third, v_k4)
    RETURNING created_by INTO v_uid;
    v_fail := v_fail || CASE WHEN v_uid = v_other THEN '' ELSE format(' direct-connection=%s;', v_uid) END;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    -- 沒有 api_key_id 的新增不受影響
    INSERT INTO public.urls (short_code, original_url, created_by)
    VALUES ('ak13d' || v_tag, 'https://example.org/api-keys-test/no-key', v_third)
    RETURNING created_by INTO v_uid;
    v_fail := v_fail || CASE WHEN v_uid = v_third THEN '' ELSE ' no-key-insert;' END;

    -- 負責同仁的帳號已刪除（owner_id = null）
    UPDATE public.api_keys SET owner_id = NULL WHERE id = v_k4;
    BEGIN
      INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
      VALUES ('ak13e' || v_tag, 'https://example.org/api-keys-test/k4-no-owner', v_owner, v_k4);
      v_fail := v_fail || ' no-owner:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '42501' AND SQLERRM = 'api_key_id has no owner' THEN ''
                               ELSE format(' no-owner:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    -- 不存在的金鑰（在外鍵檢查之前就被 trigger 擋下）
    BEGIN
      INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
      VALUES ('ak13f' || v_tag, 'https://example.org/api-keys-test/unknown-key', v_owner, gen_random_uuid());
      v_fail := v_fail || ' unknown-key:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '42501' AND SQLERRM = 'api_key_id does not exist' THEN ''
                               ELSE format(' unknown-key:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    SELECT count(*) INTO v_cnt FROM public.urls WHERE short_code IN ('ak13e' || v_tag, 'ak13f' || v_tag);
    v_fail := v_fail || CASE WHEN v_cnt = 0 THEN '' ELSE format(' rejected-rows=%s;', v_cnt) END;

    -- 修改不受影響：service role 改 created_by 不會被改回負責同仁
    UPDATE public.urls SET created_by = v_third WHERE id = v_u13;
    v_fail := v_fail || CASE WHEN (SELECT created_by FROM public.urls WHERE id = v_u13) = v_third
                             THEN '' ELSE ' update-overridden;' END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  -- spec §6.2.2「不是 service_role 時」：白名單。日後 access token hook 發出其他 role 時也不放行。
  -- 只改 claims（資料庫角色仍是執行者），所以這裡只測 guard 與 RPC 內的 auth.role() 判斷。
  v_case := '14 role whitelist: JWT roles other than service_role (supabase_admin, custom) rejected by guard and key RPCs -> 42501';
  v_fail := '';
  BEGIN
    FOREACH v_txt IN ARRAY ARRAY['supabase_admin', 'tcurl_custom_' || v_tag] LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('role', v_txt, 'sub', v_owner)::text, true);
      BEGIN
        INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
        VALUES ('ak14' || v_tag, 'https://example.org/api-keys-test/role', v_owner, v_k3);
        v_fail := v_fail || format(' %s:insert-with-key:no-error;', v_txt);
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail || CASE WHEN SQLSTATE = '42501' AND SQLERRM = 'api_key_id can only be set by the service role'
                                 THEN '' ELSE format(' %s:insert-with-key:%s %s;', v_txt, SQLSTATE, SQLERRM) END;
      END;
      BEGIN
        UPDATE public.urls SET api_key_id = v_k3 WHERE id = v_manual;
        v_fail := v_fail || format(' %s:set-key:no-error;', v_txt);
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail || CASE WHEN SQLSTATE = '42501' AND SQLERRM = 'api_key_id cannot be changed'
                                 THEN '' ELSE format(' %s:set-key:%s %s;', v_txt, SQLSTATE, SQLERRM) END;
      END;
      BEGIN
        PERFORM public.verify_api_key(v_k3_hash);
        v_fail := v_fail || format(' %s:verify:no-error;', v_txt);
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail || CASE WHEN SQLSTATE = '42501' THEN '' ELSE format(' %s:verify:%s %s;', v_txt, SQLSTATE, SQLERRM) END;
      END;
      BEGIN
        PERFORM public.create_api_key(
          p_name => 'x', p_owner_email => v_owner_email, p_scopes => ARRAY['read'], p_expires_at => NULL,
          p_key_prefix => 'tcurl_sk_test14',
          p_key_hash => encode(sha256(convert_to('x-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
          p_actor => v_actor);
        v_fail := v_fail || format(' %s:create:no-error;', v_txt);
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail || CASE WHEN SQLSTATE = '42501' THEN '' ELSE format(' %s:create:%s %s;', v_txt, SQLSTATE, SQLERRM) END;
      END;
      BEGIN
        PERFORM public.revoke_api_key(v_k3, v_actor);
        v_fail := v_fail || format(' %s:revoke:no-error;', v_txt);
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail || CASE WHEN SQLSTATE = '42501' THEN '' ELSE format(' %s:revoke:%s %s;', v_txt, SQLSTATE, SQLERRM) END;
      END;
      BEGIN
        PERFORM public.update_api_key(v_k3, v_actor, p_name => 'x');
        v_fail := v_fail || format(' %s:update:no-error;', v_txt);
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail || CASE WHEN SQLSTATE = '42501' THEN '' ELSE format(' %s:update:%s %s;', v_txt, SQLSTATE, SQLERRM) END;
      END;
      BEGIN
        PERFORM public.list_api_keys();
        v_fail := v_fail || format(' %s:list:no-error;', v_txt);
      EXCEPTION WHEN OTHERS THEN
        v_fail := v_fail || CASE WHEN SQLSTATE = '42501' THEN '' ELSE format(' %s:list:%s %s;', v_txt, SQLSTATE, SQLERRM) END;
      END;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_fail := v_fail || CASE WHEN (SELECT revoked_at IS NULL AND name = 'Renamed key 3' FROM public.api_keys WHERE id = v_k3)
                             AND (SELECT api_key_id FROM public.urls WHERE id = v_manual) IS NULL
                             AND NOT EXISTS (SELECT 1 FROM public.urls WHERE short_code = 'ak14' || v_tag)
                             THEN '' ELSE ' rows-changed;' END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  -- 管理者歸屬（§6.8）不能無聲遺失：p_actor 為 null 一律拒絕，且不動資料。
  v_case := '15 create/revoke/update_api_key: p_actor null -> 22023 invalid_actor, nothing changed';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    v_txt := encode(sha256(convert_to('a15-' || gen_random_uuid()::text, 'UTF8')), 'hex');
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => v_owner_email, p_scopes => ARRAY['read'], p_expires_at => NULL,
        p_key_prefix => 'tcurl_sk_test15', p_key_hash => v_txt, p_actor => NULL);
      v_fail := v_fail || ' create:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' AND SQLERRM = 'invalid_actor' THEN ''
                               ELSE format(' create:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.revoke_api_key(v_k3, NULL);
      v_fail := v_fail || ' revoke:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' AND SQLERRM = 'invalid_actor' THEN ''
                               ELSE format(' revoke:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    BEGIN
      PERFORM public.update_api_key(v_k3, NULL, p_name => 'Renamed by nobody');
      v_fail := v_fail || ' update:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' AND SQLERRM = 'invalid_actor' THEN ''
                               ELSE format(' update:%s %s;', SQLSTATE, SQLERRM) END;
    END;
    v_fail := v_fail || CASE WHEN NOT EXISTS (SELECT 1 FROM public.api_keys WHERE key_hash = v_txt)
                             AND (SELECT revoked_at IS NULL AND name = 'Renamed key 3' FROM public.api_keys WHERE id = v_k3)
                             THEN '' ELSE ' rows-changed;' END;
    SELECT count(*) INTO v_cnt FROM public.audit_logs
     WHERE resource_type = 'api_key' AND user_id IS NULL
       AND (api_key_id = v_k3 OR api_key_id IN (SELECT id FROM public.api_keys WHERE key_hash = v_txt));
    v_fail := v_fail || CASE WHEN v_cnt = 0 THEN '' ELSE format(' audit-without-actor=%s;', v_cnt) END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, SQLERRM);
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  -- Worker 若誤把完整金鑰當成雜湊或前綴傳入，CHECK 違反（23514）的 DETAIL 會回顯整列資料。
  -- create_api_key 先檢查格式，拋不帶輸入值的 22023；CHECK 保留當第二道防線。
  v_case := '16 create_api_key: malformed key_hash / key_prefix -> 22023 without echoing the input, no row';
  v_fail := '';
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    FOREACH v_txt IN ARRAY ARRAY[v_fake_key, upper(encode(sha256(convert_to(v_fake_key, 'UTF8')), 'hex')),
                                 left(encode(sha256(convert_to(v_fake_key, 'UTF8')), 'hex'), 63), ''] LOOP
      BEGIN
        PERFORM public.create_api_key(
          p_name => 'x', p_owner_email => v_owner_email, p_scopes => ARRAY['read'], p_expires_at => NULL,
          p_key_prefix => 'tcurl_sk_test16', p_key_hash => v_txt, p_actor => v_actor);
        v_fail := v_fail || format(' hash[%s]:no-error;', char_length(v_txt));
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
        v_fail := v_fail || CASE WHEN SQLSTATE = '22023' AND v_msg = 'invalid_key_hash'
                                      AND (v_txt = '' OR position(v_txt IN v_msg || coalesce(v_detail, '')) = 0)
                                 THEN '' ELSE format(' hash[%s]:%s %s;', char_length(v_txt), SQLSTATE, left(v_msg, 40)) END;
      END;
    END LOOP;
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => v_owner_email, p_scopes => ARRAY['read'], p_expires_at => NULL,
        p_key_prefix => 'tcurl_sk_test16', p_key_hash => NULL, p_actor => v_actor);
      v_fail := v_fail || ' hash[null]:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' AND SQLERRM = 'invalid_key_hash' THEN ''
                               ELSE format(' hash[null]:%s %s;', SQLSTATE, left(SQLERRM, 40)) END;
    END;
    FOREACH v_txt IN ARRAY ARRAY[v_fake_key, 'tcurl_sk_test16x', 'sk_test16', 'TCURL_SK_test16', ''] LOOP
      BEGIN
        PERFORM public.create_api_key(
          p_name => 'x', p_owner_email => v_owner_email, p_scopes => ARRAY['read'], p_expires_at => NULL,
          p_key_prefix => v_txt,
          p_key_hash => encode(sha256(convert_to('p16-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
          p_actor => v_actor);
        v_fail := v_fail || format(' prefix[%s]:no-error;', char_length(v_txt));
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
        v_fail := v_fail || CASE WHEN SQLSTATE = '22023' AND v_msg = 'invalid_key_prefix'
                                      AND (v_txt = '' OR position(v_txt IN v_msg || coalesce(v_detail, '')) = 0)
                                 THEN '' ELSE format(' prefix[%s]:%s %s;', char_length(v_txt), SQLSTATE, left(v_msg, 40)) END;
      END;
    END LOOP;
    BEGIN
      PERFORM public.create_api_key(
        p_name => 'x', p_owner_email => v_owner_email, p_scopes => ARRAY['read'], p_expires_at => NULL,
        p_key_prefix => NULL,
        p_key_hash => encode(sha256(convert_to('p16-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
        p_actor => v_actor);
      v_fail := v_fail || ' prefix[null]:no-error;';
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail || CASE WHEN SQLSTATE = '22023' AND SQLERRM = 'invalid_key_prefix' THEN ''
                               ELSE format(' prefix[null]:%s %s;', SQLSTATE, left(SQLERRM, 40)) END;
    END;
    -- 前綴剛好是 tcurl_sk_ 開頭的 15 字元（Worker 的正常情況）照常建立
    v_res := public.create_api_key(
      p_name => 'API test key 16', p_owner_email => v_owner_email, p_scopes => ARRAY['read'], p_expires_at => NULL,
      p_key_prefix => left(v_fake_key, 15),
      p_key_hash => encode(sha256(convert_to(v_fake_key, 'UTF8')), 'hex'), p_actor => v_actor);
    v_fail := v_fail || CASE WHEN v_res ->> 'key_prefix' = left(v_fake_key, 15) THEN '' ELSE ' valid-create;' END;
    SELECT count(*) INTO v_cnt FROM public.api_keys
     WHERE key_prefix LIKE 'tcurl_sk_test16%' OR key_prefix IN ('sk_test16', 'TCURL_SK_test16');
    v_fail := v_fail || CASE WHEN v_cnt = 0 THEN '' ELSE format(' rejected-rows=%s;', v_cnt) END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail || format(' unexpected %s: %s;', SQLSTATE, left(SQLERRM, 40));
  END;
  v_report := v_report || E'\n' || CASE WHEN v_fail = '' THEN 'PASS ' || v_case
                                        ELSE 'FAIL ' || v_case || ' --' || v_fail END;

  -- ------------------------------------------------------------------
  v_report := format('passed=%s failed=%s', regexp_count(v_report, '\nPASS '), regexp_count(v_report, '\nFAIL '))
              || v_report;
  RAISE EXCEPTION 'API_KEYS_TEST %', v_report;
END
$$;
