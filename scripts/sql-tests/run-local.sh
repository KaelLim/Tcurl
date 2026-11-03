#!/usr/bin/env bash
# =====================================================================
# 本機 SQL 測試：用本機既有的 postgres:17 映像起一個用完即丟的容器，
# 建立 Supabase 替身（local-stub.sql）→ 依檔名順序套用 supabase/migrations/*.sql →
# 種子資料（local-seed.sql）→ 執行 SQL 測試（預設 api_keys_test.sql）→ 印出報告。
#
# 用法：bash scripts/sql-tests/run-local.sh [測試檔.sql]
#
# - 不 pull 任何映像（--pull=never；本機沒有 postgres:17 就直接失敗）、不連正式 Supabase。
# - 容器名稱每次不同，結束時（含失敗、Ctrl-C）一律刪除。
# - 測試檔是單一 DO 區塊，最後 RAISE EXCEPTION 'API_KEYS_TEST …' 讓整段回滾，
#   所以 psql 一定以非 0 結束；本腳本從錯誤訊息解析 PASS / FAIL 行決定成敗：
#   全部 PASS 才 exit 0；有 FAIL、沒有任何 PASS、或沒有出現 API_KEYS_TEST 報告 → exit 1。
# - Supabase 替身與正式環境的差異見 local-stub.sql 開頭註解。
# =====================================================================
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$DIR/../.." && pwd)
TEST_FILE=${1:-"$DIR/api_keys_test.sql"}
IMAGE=postgres:17
NAME="tcurl-sqltest-$$-$RANDOM"

[ -f "$TEST_FILE" ] || { echo "找不到測試檔：$TEST_FILE" >&2; exit 2; }
docker image inspect "$IMAGE" >/dev/null 2>&1 \
  || { echo "本機沒有 $IMAGE 映像（本腳本不會下載映像）" >&2; exit 2; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM

docker run -d --rm --pull=never --name "$NAME" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null

# 映像初始化時會先起一個只聽 unix socket 的暫時伺服器；以 TCP 檢查才會等到正式伺服器。
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$NAME" pg_isready -q -h 127.0.0.1 -U postgres \
  || { echo "postgres 容器未就緒" >&2; docker logs "$NAME" >&2; exit 1; }

# client_min_messages=warning：略過 migration 的 NOTICE（例如 uuid-ossp already exists）
run_psql() {
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$NAME" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

run_psql -1 -f - < "$DIR/local-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "apply $(basename "$f")"
  run_psql -1 -f - < "$f"
done
run_psql -1 -f - < "$DIR/local-seed.sql"

echo "run $(basename "$TEST_FILE")"
set +e
out=$(run_psql -f - < "$TEST_FILE" 2>&1)
rc=$?
set -e

if ! grep -q 'API_KEYS_TEST' <<<"$out"; then
  echo "$out"
  echo "沒有 API_KEYS_TEST 報告（psql exit ${rc}）" >&2
  exit 1
fi

report=$(grep -E 'API_KEYS_TEST|^(PASS|FAIL) ' <<<"$out" | sed -E 's/^.*(API_KEYS_TEST)/\1/' || true)
echo "$report"
pass=$(grep -c '^PASS ' <<<"$report" || true)
fail=$(grep -c '^FAIL ' <<<"$report" || true)
echo "summary: $pass PASS, $fail FAIL"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]
