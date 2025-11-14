#!/bin/bash

# Realtime 功能測試腳本
# 使用方式：./test-realtime.sh [SHORT_CODE]

echo "🚀 Realtime 功能測試腳本"
echo "========================================"

# 取得第一個短網址
if [ -z "$1" ]; then
    echo "📋 取得可用的短網址..."
    SHORT_CODE=$(curl -s 'http://localhost:8080/api/urls?page=1&limit=1' | python3 -c "import sys, json; data = json.load(sys.stdin); print(data['data'][0]['short_code']) if data['data'] else print('')")

    if [ -z "$SHORT_CODE" ]; then
        echo "❌ 找不到任何短網址，請先建立一個短網址"
        exit 1
    fi
else
    SHORT_CODE=$1
fi

echo "✅ 使用短代碼: $SHORT_CODE"
echo ""

# 顯示測試前的統計
echo "📊 測試前統計數據："
curl -s "http://localhost:8080/api/urls?page=1&limit=10" | \
    python3 -c "import sys, json; data = json.load(sys.stdin); url = next((u for u in data['data'] if u['short_code'] == '$SHORT_CODE'), None); print(f\"  總點擊數: {url['clicks']}\") if url else print('  找不到該網址')"
echo ""

# 執行 5 次點擊
echo "🔄 模擬 5 次點擊..."
for i in {1..5}; do
    echo "  點擊 $i/5..."
    curl -s -I "http://localhost:8080/s/$SHORT_CODE" > /dev/null
    sleep 0.5
done
echo ""

# 等待資料同步
echo "⏳ 等待 1 秒讓資料同步..."
sleep 1
echo ""

# 顯示測試後的統計
echo "📊 測試後統計數據："
curl -s "http://localhost:8080/api/urls?page=1&limit=10" | \
    python3 -c "import sys, json; data = json.load(sys.stdin); url = next((u for u in data['data'] if u['short_code'] == '$SHORT_CODE'), None); print(f\"  總點擊數: {url['clicks']}\") if url else print('  找不到該網址')"
echo ""

# 驗證 Realtime publication
echo "🔍 驗證 Realtime 設定："
echo "  檢查 url_clicks 是否在 Realtime publication 中..."

# 使用 Supabase CLI 執行 SQL
if command -v supabase &> /dev/null; then
    RESULT=$(supabase db execute "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'url_clicks';" 2>/dev/null)
    if [[ $RESULT == *"url_clicks"* ]]; then
        echo "  ✅ url_clicks 表已啟用 Realtime"
    else
        echo "  ❌ url_clicks 表未啟用 Realtime"
    fi
else
    echo "  ⚠️  無法驗證（supabase CLI 未安裝）"
fi

echo ""
echo "🎉 測試完成！"
echo ""
echo "💡 提示："
echo "  1. 開啟瀏覽器到 http://localhost:8080/links.html"
echo "  2. 打開開發者工具 (F12) 查看 Console"
echo "  3. 再次執行此腳本： ./test-realtime.sh $SHORT_CODE"
echo "  4. 觀察瀏覽器中的即時更新：數字自動增加 + 綠色動畫"
echo ""
