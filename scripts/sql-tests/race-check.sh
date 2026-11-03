#!/usr/bin/env bash
# =====================================================================
# 兩個連線的競態測試（hardening A1）：金鑰轉移與「金鑰新增短網址」同時進行時，不會留下孤兒短網址
# （created_by 不是金鑰目前的負責同仁：金鑰與新負責人都看不到它，之後的轉移也搬不走）。
# guard_url_api_key_id() 以 SELECT owner_id … FOR SHARE 讀金鑰目前的負責同仁，與 update_api_key 的
# FOR UPDATE 互斥。api_keys_test.sql 是單一 DO 區塊、開不了第二個連線（而且要能在正式庫原封不動執行），
# 所以互斥另以這支腳本實測；api_keys_test.sql 案例 12 另檢查函式定義含 FOR SHARE。
#
# 用法：bash scripts/sql-tests/race-check.sh [api_keys migration 檔]
#   預設用 supabase/migrations/20261103120902_api_keys.sql；可傳入改過的檔案（例如拿掉 FOR SHARE 的
#   mutant），確認這支測試抓得到。
#
# - 與 run-local.sh 相同：用本機既有的 postgres:17（--pull=never，不下載映像）、不連正式 Supabase；
#   容器名稱每次不同，結束時（含失敗、Ctrl-C）一律刪除。
# - 兩邊都以 SET ROLE service_role + service_role claims 執行（Worker 經 PostgREST 時的身分；
#   trigger 是 invoker，FOR SHARE 需要 api_keys 的 UPDATE 權限，這裡也一併驗證）。
# - 情境 1：轉移先拿到鎖、停住不 commit，同時金鑰以「驗證當下的負責人」新增短網址
#   → 新增要等轉移 commit，短網址歸新的負責同仁。
# - 情境 2：新增先拿到鎖、停住不 commit，同時轉移 → 轉移要等新增 commit，把它一起搬走。
# - 每個情境都確認後到的一方真的在等鎖（pg_stat_activity 的 wait_event_type = 'Lock'）；
#   沒看到就代表時序沒有重疊，結果不算數（INCONCLUSIVE）。
# - 全部 OK 才 exit 0；有 BAD 或 INCONCLUSIVE → exit 1；環境問題 → exit 2。
# =====================================================================
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/../.." && pwd)
API_KEYS_MIGRATION=20261103120902_api_keys.sql
MIG=${1:-"$ROOT/supabase/migrations/$API_KEYS_MIGRATION"}
IMAGE=postgres:17
NAME="tcurl-racetest-$$-$RANDOM"
# 先拿到鎖的一方停多久才 commit：要夠後到的一方開始等鎖、也夠這裡觀察到它在等
HOLD_SECONDS=4

[ -f "${MIG}" ] || { echo "找不到 migration 檔：${MIG}" >&2; exit 2; }
docker image inspect "${IMAGE}" >/dev/null 2>&1 \
  || { echo "本機沒有 ${IMAGE} 映像（本腳本不會下載映像）" >&2; exit 2; }

LOGS=$(mktemp -d "${TMPDIR:-/tmp}/tcurl-race.XXXXXX")
cleanup() {
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  rm -rf "$LOGS"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

docker run -d --rm --pull=never --name "${NAME}" -e POSTGRES_PASSWORD=postgres "${IMAGE}" >/dev/null

# 映像初始化時會先起一個只聽 unix socket 的暫時伺服器；以 TCP 檢查才會等到正式伺服器。
for _ in $(seq 1 60); do
  if docker exec "${NAME}" pg_isready -q -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "${NAME}" pg_isready -q -h 127.0.0.1 -U postgres \
  || { echo "postgres 容器未就緒" >&2; docker logs "${NAME}" >&2; exit 2; }

# psql（$1 = application_name，用來在 pg_stat_activity 找到這個連線）
psql_as() {
  local app=$1
  shift
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' -e PGAPPNAME="$app" "${NAME}" \
    psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}
q() { psql_as race_check "$@"; }

q -1 -f - < "$DIR/local-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  if [ "$(basename "$f")" = "$API_KEYS_MIGRATION" ]; then
    echo "apply $(basename "$f") <- ${MIG}"
    q -1 -f - < "${MIG}"
  else
    echo "apply $(basename "$f")"
    q -1 -f - < "$f"
  fi
done
q -1 -f - < "$DIR/local-seed.sql"

OWNER=00000000-0000-4000-8000-000000000001   # kael1996@tzuchi.org.tw（local-seed.sql）
OTHER=00000000-0000-4000-8000-000000000002   # colleague@tzuchi.org.tw（兼作執行的管理者 p_actor）
SR="SET ROLE service_role; SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);"

# 等到 SQL（回傳 count）大於 0，最多約 HOLD_SECONDS 秒；成立回 0
wait_until() {
  local i
  for i in $(seq 1 $((HOLD_SECONDS * 5))); do
    [ "$(q -c "$1")" -gt 0 ] && return 0
    sleep 0.2
  done
  return 1
}
sleeping() { echo "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$1' AND wait_event = 'PgSleep'"; }
lock_waiting() { echo "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$1' AND wait_event_type = 'Lock'"; }

# 金鑰的短網址 created_by 都等於金鑰目前的負責同仁（沒有孤兒）
orphans() {
  q -c "SELECT count(*) FROM public.urls u JOIN public.api_keys k ON k.id = u.api_key_id
        WHERE u.created_by IS DISTINCT FROM k.owner_id;"
}

results=()
record() { results+=("$1"); echo "$1"; }

# 先拿到鎖的一方（$2 = 拿鎖的 SQL）在背景開交易、停 HOLD_SECONDS 秒再 commit；
# 確認它停住之後，後到的一方（$3 = SQL）在背景執行，並確認它在等鎖。$1 = 情境名稱
race() {
  local label=$1 holder_sql=$2 waiter_sql=$3 holder_pid waiter_pid waited=no failed=no
  psql_as race_holder -c "BEGIN;" -c "$SR" -c "$holder_sql" -c "SELECT pg_sleep(${HOLD_SECONDS});" -c "COMMIT;" \
    >"$LOGS/${label}-holder.log" 2>&1 &
  holder_pid=$!
  if ! wait_until "$(sleeping race_holder)"; then
    wait "$holder_pid" || true
    cat "$LOGS/${label}-holder.log" >&2
    record "INCONCLUSIVE ${label}: 先拿鎖的一方沒有停在 pg_sleep"
    return
  fi
  psql_as race_waiter -c "$SR" -c "$waiter_sql" >"$LOGS/${label}-waiter.log" 2>&1 &
  waiter_pid=$!
  wait_until "$(lock_waiting race_waiter)" && waited=yes
  wait "$holder_pid" || { failed=yes; cat "$LOGS/${label}-holder.log" >&2; }
  wait "$waiter_pid" || { failed=yes; cat "$LOGS/${label}-waiter.log" >&2; }
  if [ "$failed" = yes ]; then
    record "BAD ${label}: 有一方執行失敗（見上方輸出）"
  elif [ "$waited" = no ]; then
    record "INCONCLUSIVE ${label}: 沒觀察到後到的一方在等鎖（時序沒有重疊）"
  else
    echo "${label}: 後到的一方有等鎖；先拿鎖：$(grep -E 'transfer|created_by' "$LOGS/${label}-holder.log" | tail -1)；後到：$(grep -E 'transfer|created_by' "$LOGS/${label}-waiter.log" | tail -1)"
  fi
}

K=$(q -c "$SR" -c "SELECT (public.create_api_key('race', 'kael1996@tzuchi.org.tw', ARRAY['read','write'], NULL,
  'tcurl_sk_race01', encode(sha256('race'::bytea), 'hex'), '${OTHER}'::uuid) ->> 'id');" | tail -1)
echo "key ${K} (owner kael1996)"

echo "== 情境 1：轉移（kael1996 → colleague）先拿到鎖，金鑰同時以驗證當下的負責人 kael1996 新增短網址"
race scenario1 \
  "SELECT 'transfer -> colleague, moved ' || (public.update_api_key('${K}'::uuid, '${OTHER}'::uuid,
     p_new_owner_email => 'colleague@tzuchi.org.tw') ->> 'url_count');" \
  "INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
     VALUES ('race1', 'https://example.org/race1', '${OWNER}', '${K}') RETURNING 'race1 created_by=' || created_by;"
got=$(q -c "SELECT created_by FROM public.urls WHERE short_code = 'race1';")
n=$(orphans)
if [ "${got}" = "${OTHER}" ] && [ "${n}" -eq 0 ]; then
  record "OK  scenario1: race1 歸目前的負責同仁 colleague（${got}），孤兒 0 筆"
else
  record "BAD scenario1: race1 created_by=${got}（應為 colleague ${OTHER}），孤兒 ${n} 筆"
fi

echo "== 情境 2：新增短網址先拿到鎖，管理者同時把金鑰轉回 kael1996"
race scenario2 \
  "INSERT INTO public.urls (short_code, original_url, created_by, api_key_id)
     VALUES ('race2', 'https://example.org/race2', '${OWNER}', '${K}') RETURNING 'race2 created_by=' || created_by;" \
  "SELECT 'transfer -> kael1996, moved ' || (public.update_api_key('${K}'::uuid, '${OTHER}'::uuid,
     p_new_owner_email => 'kael1996@tzuchi.org.tw') ->> 'url_count');"
got=$(q -c "SELECT created_by FROM public.urls WHERE short_code = 'race2';")
moved=$(q -c "SELECT count(*) FROM public.audit_logs a, public.urls u
              WHERE a.action = 'transfer_api_key' AND u.short_code = 'race2'
                AND a.new_values -> 'moved_url_ids' ? u.id::text;")
n=$(orphans)
if [ "${got}" = "${OWNER}" ] && [ "${moved}" -eq 1 ] && [ "${n}" -eq 0 ]; then
  record "OK  scenario2: race2 被轉移一起搬回 kael1996（${got}），記在 moved_url_ids，孤兒 0 筆"
else
  record "BAD scenario2: race2 created_by=${got}（應為 kael1996 ${OWNER}），moved_url_ids 含 race2 的轉移 ${moved} 筆，孤兒 ${n} 筆"
fi

ok=0
bad=0
for r in "${results[@]}"; do
  case "$r" in
    OK*) ok=$((ok + 1)) ;;
    *) bad=$((bad + 1)) ;;
  esac
done
echo "summary: ${ok} OK, ${bad} BAD/INCONCLUSIVE"
[ "${bad}" -eq 0 ] && [ "${ok}" -eq 2 ]
