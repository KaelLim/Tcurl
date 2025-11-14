# Supabase Realtime WebSocket 反向代理修復指南

## 問題診斷

當前錯誤：
```
WebSocket connection to 'wss://sbeurlpj.tzuchi-org.tw/realtime/v1/websocket' failed
```

## 問題原因

Supabase Realtime 需要 WebSocket 連接，但您的反向代理（Nginx/Kong）**缺少 WebSocket 升級配置**。

## 環境資訊

- Supabase Kong: `localhost:8000`
- 公開域名: `https://sbeurlpj.tzuchi-org.tw`
- Realtime 容器: `realtime-dev.supabase-realtime` (運行中)
- 反向代理: OpenResty/Nginx

## 解決方案

### 選項 1：修改 Nginx 配置（推薦）

找到處理 `sbeurlpj.tzuchi-org.tw` 的 Nginx 配置檔案，並添加 WebSocket 支援：

```nginx
# 在 http 區塊添加 map 指令
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    server {
        listen 443 ssl http2;
        server_name sbeurlpj.tzuchi-org.tw;

        # ... 其他配置 ...

        # Supabase Realtime WebSocket 支援
        location /realtime/v1/ {
            proxy_pass http://localhost:8000/realtime/v1/;
            proxy_http_version 1.1;

            # WebSocket 升級所需的 headers
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # WebSocket 連接保持
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;

            # 傳遞 API key
            proxy_set_header apikey $http_apikey;
            proxy_set_header Authorization $http_authorization;
        }

        # 其他 Supabase 路由
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

### 選項 2：完整的 Supabase Nginx 配置範例

根據 [BLumbye 的 GitHub Gist](https://gist.github.com/BLumbye/cc5f3c7aea6ad994cb682df3da0acba2)，完整配置：

```nginx
http {
    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

    upstream supabase {
        server 127.0.0.1:8000;
    }

    upstream supabase_studio {
        server 127.0.0.1:3050;
    }

    server {
        listen 443 ssl http2;
        server_name sbeurlpj.tzuchi-org.tw;

        # SSL 配置
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

        # Realtime WebSocket (重要！)
        location ~ ^/realtime/v1/(.*)$ {
            proxy_set_header Host $host;
            proxy_pass http://supabase;
            proxy_redirect off;

            # WebSocket 升級
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;

            # 長連接超時
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # Storage
        location ~ ^/storage/v1/(.*)$ {
            proxy_set_header Host $host;
            proxy_pass http://supabase;
            proxy_redirect off;
        }

        # Studio (可選)
        location / {
            proxy_pass http://supabase_studio;
            proxy_set_header Host $host;
        }
    }
}
```

## 查找 Nginx 配置檔案

### 方法 1：檢查 Nginx 進程
```bash
ps aux | grep nginx
# 輸出：nginx: master process /usr/local/openresty/nginx/sbin/nginx -p /usr/local/kong -c nginx.conf
```

### 方法 2：常見位置
```bash
# 標準 Nginx
/etc/nginx/nginx.conf
/etc/nginx/sites-enabled/*
/etc/nginx/conf.d/*

# OpenResty (您的情況)
/usr/local/kong/nginx.conf
/usr/local/openresty/nginx/conf/nginx.conf

# 查找配置檔案
sudo find / -name "nginx.conf" 2>/dev/null
sudo find / -name "*sbeurlpj*" 2>/dev/null
```

### 方法 3：檢查 Kong 配置
```bash
# Kong 可能使用資料庫配置而非檔案
# 檢查 Kong 服務
curl -i http://localhost:8001/services
curl -i http://localhost:8001/routes
```

## 修改後的步驟

1. **找到配置檔案**
   ```bash
   sudo find /usr/local -name "*.conf" | grep -E "(nginx|kong)"
   ```

2. **備份原配置**
   ```bash
   sudo cp /path/to/nginx.conf /path/to/nginx.conf.backup
   ```

3. **編輯配置**
   ```bash
   sudo nano /path/to/nginx.conf
   # 添加上面的 WebSocket 配置
   ```

4. **測試配置**
   ```bash
   sudo nginx -t
   # 或
   sudo /usr/local/openresty/nginx/sbin/nginx -t
   ```

5. **重新載入配置**
   ```bash
   sudo nginx -s reload
   # 或
   sudo systemctl reload nginx
   ```

## 驗證修復

### 測試 WebSocket 端點
```bash
# 使用 wscat 測試 (需要安裝: npm install -g wscat)
wscat -c "wss://sbeurlpj.tzuchi-org.tw/realtime/v1/websocket?apikey=YOUR_ANON_KEY&vsn=1.0.0"
```

### 瀏覽器測試
1. 開啟 `https://urlpj.tzuchi-org.tw/links.html`
2. 打開開發者工具 (F12)
3. 查看 Console，應該看到：
   ```
   ✅ Realtime Stats initialized
   ✅ Successfully subscribed to url_clicks changes
   ```

## 前端配置（修復後）

修復反向代理後，前端應該使用公開域名：

```javascript
// links.html
const SUPABASE_URL = 'https://sbeurlpj.tzuchi-org.tw'  // 使用公開域名
const SUPABASE_ANON_KEY = 'eyJ...'  // 您的 anon key
```

## 臨時解決方案（不推薦）

如果無法修改 Nginx 配置，可以暫時讓前端直接連接 `localhost:8000`：

```javascript
const SUPABASE_URL = 'http://localhost:8000'
```

**缺點**：
- 只能在本機測試
- 無法從其他裝置訪問
- 沒有 HTTPS 加密
- 不適合生產環境

## 參考資料

- [Nginx WebSocket Proxying](http://nginx.org/en/docs/http/websocket.html)
- [Supabase Self-hosting Realtime Config](https://supabase.com/docs/guides/self-hosting/realtime/config)
- [GitHub Issue: Realtime behind reverse proxy](https://github.com/supabase/realtime/issues/472)
- [BLumbye's Supabase Nginx Config](https://gist.github.com/BLumbye/cc5f3c7aea6ad994cb682df3da0acba2)

## 需要協助？

如果您需要協助找到 Nginx 配置檔案或修改配置，請提供：
1. `ps aux | grep nginx` 的完整輸出
2. `/usr/local/kong` 目錄結構
3. 是否使用 Docker Compose 啟動 Supabase

---

**更新日期**: 2025-11-14
**版本**: 1.0
