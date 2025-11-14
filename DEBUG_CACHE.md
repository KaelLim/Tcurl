# 瀏覽器快取問題除錯指南

## 問題描述
links.html 顯示 5 筆資料，但資料庫和 analytics.html 都只有 1 筆正確資料。

## 已確認
✅ 資料庫只有 1 筆資料（DA8ZFB）
✅ API `/api/urls` 回傳正確（只有 1 筆）
✅ API Response Headers 已設定防快取
✅ analytics.html 顯示正確

## 檢查步驟

### 1. 檢查 Network 面板
1. 開啟 links.html
2. 按 F12 打開開發者工具
3. 切換到 **Network** 分頁
4. 勾選 **Disable cache**
5. 按 F5 重新整理
6. 找到 `api/urls?page=1&limit=10` 請求
7. 查看：
   - **Status**: 應該是 200
   - **Size**: 應該顯示實際大小（不是 "from memory cache" 或 "from disk cache"）
   - **Response**: 應該只有 1 筆資料

### 2. 檢查 Application 面板
1. 開啟開發者工具
2. 切換到 **Application** 分頁
3. 檢查左側選單：
   - **Local Storage** → http://localhost:8080 → 查看是否有存儲的舊資料
   - **Session Storage** → http://localhost:8080 → 查看是否有存儲的舊資料
   - **IndexedDB** → 查看是否有資料庫快取
   - **Service Workers** → 查看是否有註冊的 Service Worker（如果有，點擊 Unregister）

### 3. 清除所有快取
在開發者工具中：
1. 右鍵點擊瀏覽器的重新整理按鈕
2. 選擇「**清除快取並強制重新整理**」（Empty Cache and Hard Reload）

或者：
1. 按 F12 打開開發者工具
2. 右鍵點擊重新整理按鈕（在開發者工具開啟時）
3. 選擇「**清除快取並強制重新整理**」

### 4. 檢查 Console
1. 開啟 Console 分頁
2. 執行：
   ```javascript
   fetch('/api/urls?page=1&limit=10').then(r => r.json()).then(console.log)
   ```
3. 查看回傳的資料筆數

### 5. 檢查 links.js 是否有問題
在 Console 執行：
```javascript
console.log('allUrls:', allUrls)
console.log('pagination:', pagination)
```

## 可能的原因

### 1. HTTP Proxy 快取
如果您的網路環境有 proxy，proxy 可能快取了回應。

**解決方式**：
- 在 URL 加上隨機參數：`/api/urls?page=1&limit=10&_=${Date.now()}`

### 2. Nginx 反向代理快取
如果使用 Nginx，可能在 Nginx 層級有快取。

**檢查方式**：
```bash
curl -I http://localhost:8080/api/urls?page=1&limit=10
```
查看是否有 `X-Cache-Status` 或其他快取相關 headers。

### 3. 瀏覽器擴充套件
某些瀏覽器擴充套件（如廣告攔截器、隱私工具）可能干擾。

**解決方式**：
- 開啟無痕模式（Incognito/Private）測試
- 或暫時停用所有擴充套件

### 4. DNS 快取
極少情況下，DNS 可能解析到舊的伺服器。

**解決方式**：
```bash
# Windows
ipconfig /flushdns

# Linux
sudo systemd-resolve --flush-caches

# Mac
sudo dscacheutil -flushcache
```

## 終極解決方案

如果以上都無效，在 `links.js` 中手動添加防快取參數：

```javascript
// 在 loadUrls 函數中（第 36-39 行）
const [urlsResponse, statsResponse] = await Promise.all([
  fetch(`/api/urls?page=${page}&limit=${pagination.limit}&_=${Date.now()}`),  // 添加時間戳
  fetch(`/api/urls/stats/summary?_=${Date.now()}`)  // 添加時間戳
])
```

或者在 fetch 中添加 cache: 'no-store'：

```javascript
const [urlsResponse, statsResponse] = await Promise.all([
  fetch(`/api/urls?page=${page}&limit=${pagination.limit}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  }),
  fetch('/api/urls/stats/summary', {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  })
])
```

## 快速測試命令

```bash
# 測試 API 是否回傳正確資料
curl -s 'http://localhost:8080/api/urls?page=1&limit=10' | python3 -c "import sys, json; data = json.load(sys.stdin); print(f\"總筆數: {len(data['data'])}\")"

# 測試 Headers
curl -s -D - 'http://localhost:8080/api/urls?page=1&limit=10' -o /dev/null | grep -i cache
```

## 請回報

執行完上述檢查後，請告訴我：
1. Network 面板中看到的資料筆數
2. Application 中是否有 localStorage/sessionStorage 資料
3. Console 執行 fetch 的結果
4. 是否有 Service Worker
5. 無痕模式是否正常

---

**更新時間**: 2025-11-14 21:10
