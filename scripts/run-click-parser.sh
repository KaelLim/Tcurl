#!/bin/bash
# 點擊日誌解析 Cron 腳本

cd /web/html/urlpj/shorturl-api

# 使用 npx tsx 執行
/usr/bin/npx tsx scripts/parse-click-logs.ts >> /var/log/shorturl-click-parser.log 2>&1
