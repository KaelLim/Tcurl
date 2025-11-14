# Supabase Realtime WebSocket 403 錯誤修復指南

## 問題診斷

**錯誤訊息**：
```
WebSocket connection to 'wss://sbeurlpj.tzuchi-org.tw/realtime/v1/websocket' failed
HTTP/2 403 Forbidden
```

**原因**：
反向代理（Nginx/Kong）**沒有正確處理 WebSocket 升級請求**，導致：
1. WebSocket Upgrade headers 沒有被傳遞
2. Kong 拒絕了非 WebSocket 的 HTTP 請求（回傳 403）

## 已完成的資料庫配置

✅ `url_clicks` 表已加入 `supabase_realtime` publication
✅ `url_clicks` 表的 RLS 政策已設定（允許 public SELECT 和 INSERT）
✅ `realtime.messages` 表的 RLS 政策已設定（允許 public SELECT）

**資料庫層面已經正確配置，問題出在反向代理層！**

## 解決方案：修復反向代理 WebSocket 支援

### 找到反向代理配置

您的反向代理處理 `sbeurlpj.tzuchi-org.tw` 域名，需要找到它的配置檔案。

**可能的位置**：

```bash
# 1. 檢查是否有外部 Nginx
/etc/nginx/sites-enabled/*
/etc/nginx/conf.d/*
/usr/local/nginx/conf/*

# 2. 檢查 Docker 容器
docker ps | grep nginx
docker ps | grep proxy

# 3. 檢查其他反向代理服務
systemctl list-units | grep -E "(nginx|apache|caddy|traefik)"
```

### 必需的 Nginx 配置

在處理 `sbeurlpj.tzuchi-org.tw` 的 Nginx 配置檔案中，添加以下內容：

```nginx
# 在 http 區塊最上層添加
http {
    # WebSocket 升級所需的 map
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    # ... 其他配置 ...

    server {
        listen 443 ssl http2;
        server_name sbeurlpj.tzuchi-org.tw;

        # SSL 證書配置
        ssl_certificate /path/to/cert.pem;
        ssl_certificate_key /path/to/key.pem;

        # ===== 關鍵：Realtime WebSocket 支援 =====
        location /realtime/v1/ {
            proxy_pass http://localhost:8000/realtime/v1/;

            # HTTP 版本必須是 1.1
            proxy_http_version 1.1;

            # WebSocket 升級 headers（必需！）
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;

            # 基本 proxy headers
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # WebSocket 連接保持（24小時）
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;

            # 傳遞認證 headers
            proxy_set_header apikey $http_apikey;
            proxy_set_header Authorization $http_authorization;
        }

        # 其他 Supabase 端點（REST API, Auth, Storage 等）
        location / {
            proxy_pass http://localhost:8000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

### 為什麼需要這些設定？

1. **`map $http_upgrade $connection_upgrade`**
   根據客戶端的 `Upgrade` header 動態設定 `Connection` header

2. **`proxy_http_version 1.1`**
   WebSocket 需要 HTTP/1.1 協議

3. **`proxy_set_header Upgrade $http_upgrade`**
   傳遞 WebSocket 升級請求

4. **`proxy_set_header Connection $connection_upgrade`**
   告訴上游伺服器升級連接

5. **`proxy_read_timeout 86400s`**
   WebSocket 連接可能持續很長時間

### 修改步驟

```bash
# 1. 找到配置檔案
sudo find /etc /usr/local -name "*.conf" -exec grep -l "sbeurlpj.tzuchi-org.tw" {} \;

# 2. 備份原配置
sudo cp /path/to/nginx.conf /path/to/nginx.conf.backup.$(date +%Y%m%d)

# 3. 編輯配置
sudo nano /path/to/nginx.conf
# 添加上述 WebSocket 配置

# 4. 測試配置語法
sudo nginx -t

# 5. 重新載入配置
sudo nginx -s reload
# 或
sudo systemctl reload nginx
```

## 驗證修復

### 測試 1：檢查 WebSocket 升級

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://sbeurlpj.tzuchi-org.tw/realtime/v1/websocket?apikey=YOUR_ANON_KEY&vsn=1.0.0"
```

**期望結果**：
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

如果看到 `101 Switching Protocols`，表示 WebSocket 升級成功！

### 測試 2：瀏覽器測試

1. 開啟 `https://urlpj.tzuchi-org.tw/links.html`
2. 打開開發者工具 (F12) → Console
3. 應該看到：
   ```
   ✅ Realtime Stats initialized
   🔔 Subscribing to url_clicks changes...
   ✅ Successfully subscribed to url_clicks changes
   ✅ Realtime 統計已啟用 - 點擊數據將即時更新
   ```

### 測試 3：測試即時更新

1. 保持 `links.html` 頁面開啟
2. 在另一個分頁點擊任何短網址
3. 回到 `links.html`，應該看到：
   - 點擊數字自動 +1
   - 綠色脈衝動畫
   - 通知訊息：「有人點擊了您的短網址！」

## 如果找不到反向代理配置

### 檢查是否使用 Docker Compose

```bash
# 查找 docker-compose.yml
find /home /opt /root -name "docker-compose.yml" -o -name "docker-compose.yaml" 2>/dev/null

# 如果找到，查看是否有反向代理服務
cat docker-compose.yml | grep -A 20 -i "nginx\|proxy"
```

### 檢查是否使用 Traefik

```bash
# 檢查 Traefik
docker ps | grep traefik

# 查看 Traefik 配置
docker exec traefik cat /etc/traefik/traefik.yml
```

### 檢查是否使用 Caddy

```bash
# 檢查 Caddy
which caddy
systemctl status caddy

# 查看 Caddy 配置
cat /etc/caddy/Caddyfile
```

## 臨時解決方案（僅供測試）

如果無法立即修改反向代理配置，可以暫時讓前端直接連接到 `localhost:8000`：

```javascript
// links.html - 僅供本機測試
const SUPABASE_URL = 'http://localhost:8000'
```

**缺點**：
- ❌ 只能在伺服器本機測試
- ❌ 無法從其他裝置訪問
- ❌ 沒有 HTTPS 加密
- ❌ 不適合生產環境

## 完整的反向代理配置範例

根據 [BLumbye 的 GitHub Gist](https://gist.github.com/BLumbye/cc5f3c7aea6ad994cb682df3da0acba2)：

```nginx
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

    upstream supabase {
        server 127.0.0.1:8000;
    }

    server {
        listen 443 ssl http2;
        server_name sbeurlpj.tzuchi-org.tw;

        ssl_certificate /path/to/cert.pem;
        ssl_certificate_key /path/to/key.pem;

        # REST API
        location ~ ^/rest/v1/(.*)$ {
            proxy_set_header Host $host;
            proxy_pass http://supabase;
            proxy_redirect off;
        }

        # Auth
        location ~ ^/auth/v1/(.*)$ {
            proxy_set_header Host $host;
            proxy_pass http://supabase;
            proxy_redirect off;
        }

        # Realtime (重要！)
        location ~ ^/realtime/v1/(.*)$ {
            proxy_set_header Host $host;
            proxy_pass http://supabase;
            proxy_redirect off;

            # WebSocket 支援
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # Storage
        location ~ ^/storage/v1/(.*)$ {
            proxy_set_header Host $host;
            proxy_pass http://supabase;
            proxy_redirect off;
        }
    }
}
```

## 需要協助？

如果您需要協助：

1. 告訴我您的反向代理類型（Nginx / Traefik / Caddy / Apache）
2. 提供配置檔案的位置
3. 或者提供 `docker-compose.yml` 的內容

我可以幫您生成正確的配置。

## 參考資料

- [Nginx WebSocket Proxying](http://nginx.org/en/docs/http/websocket.html)
- [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [GitHub: Realtime behind reverse proxy issue](https://github.com/supabase/realtime/issues/472)
- [BLumbye's Supabase Nginx Config](https://gist.github.com/BLumbye/cc5f3c7aea6ad994cb682df3da0acba2)

---

**更新日期**: 2025-11-14
**問題**: WebSocket 403 Forbidden
**根本原因**: 反向代理缺少 WebSocket 升級配置
**解決方案**: 添加 `Upgrade` 和 `Connection` headers 到 Nginx 配置
