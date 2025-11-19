# Logo 客製化說明

TCurl 短網址系統支援靈活的 Logo 配置，您可以選擇使用圖片（PNG/JPG/SVG）或 Material Icon。

## 快速開始

### 方法一：使用圖片 Logo（推薦）

1. **準備 Logo 圖片**
   - 支援格式：`.png`、`.jpg`、`.jpeg`、`.svg`
   - 建議尺寸：
     - Sidebar（桌面版）：48x48 px
     - Header（手機版）：32x32 px
   - 建議使用 PNG 或 SVG 格式以支援透明背景

2. **上傳圖片**
   ```bash
   # 將 logo 圖片放到以下目錄
   cp your-logo.png /web/html/urlpj/shorturl-api/public/images/logo.png
   ```

3. **修改配置**
   編輯 `/web/html/urlpj/shorturl-api/public/js/logo-config.js`：
   ```javascript
   window.logoConfig = {
     type: 'image',  // 改為 'image'
     imagePath: '/images/logo.png',  // 圖片路徑
     // ... 其他設定保持不變
   }
   ```

4. **完成！** 重新整理瀏覽器即可看到新的 Logo

### 方法二：使用 Material Icon

1. **選擇圖標**
   - 前往 [Google Material Symbols](https://fonts.google.com/icons)
   - 選擇您喜歡的圖標（如 `link`、`bolt`、`star` 等）

2. **修改配置**
   編輯 `/web/html/urlpj/shorturl-api/public/js/logo-config.js`：
   ```javascript
   window.logoConfig = {
     type: 'icon',  // 改為 'icon'
     iconName: 'link',  // 改為您選擇的圖標名稱
     // ... 其他設定保持不變
   }
   ```

3. **完成！** 重新整理瀏覽器即可看到新的圖標

## 進階配置

### 調整圖片 Logo 尺寸

編輯 `logo-config.js` 中的 `size` 設定：

```javascript
size: {
  sidebar: {
    width: '48px',   // 可改為 '32px', '40px', '56px' 等
    height: '48px'
  },
  header: {
    width: '32px',
    height: '32px'
  }
}
```

### 調整圖片顯示方式

編輯 `logo-config.js` 中的 `imageSettings`：

```javascript
imageSettings: {
  objectFit: 'contain',  // 'contain' 保持比例 | 'cover' 填滿容器
  borderRadius: '0.375rem'  // '0' 方形 | '0.5rem' 圓角 | '9999px' 圓形
}
```

### 範例配置

#### 慈濟 Logo（圓形）
```javascript
window.logoConfig = {
  type: 'image',
  imagePath: '/images/tzuchi-logo.png',
  iconName: 'link',
  size: {
    sidebar: { width: '48px', height: '48px' },
    header: { width: '32px', height: '32px' }
  },
  imageSettings: {
    objectFit: 'cover',
    borderRadius: '9999px'  // 圓形
  }
}
```

#### 使用 SVG Logo
```javascript
window.logoConfig = {
  type: 'image',
  imagePath: '/images/logo.svg',  // SVG 格式
  iconName: 'link',
  size: {
    sidebar: { width: '56px', height: '56px' },
    header: { width: '40px', height: '40px' }
  },
  imageSettings: {
    objectFit: 'contain',
    borderRadius: '0'  // 無圓角
  }
}
```

## 支援的圖片格式

| 格式 | 優點 | 缺點 |
|-----|------|------|
| **PNG** | 支援透明背景、品質佳 | 檔案較大 |
| **JPG** | 檔案較小 | 不支援透明背景 |
| **SVG** | 可縮放不失真、檔案小 | 需要向量格式檔案 |
| **WebP** | 檔案最小、支援透明 | 較新的格式 |

## 常見問題

### Q: 圖片不顯示怎麼辦？
1. 檢查圖片路徑是否正確
2. 檢查圖片檔案是否存在於 `public/images/` 目錄
3. 檢查瀏覽器控制台（F12）是否有錯誤訊息
4. 嘗試硬性重新整理（Ctrl + Shift + R）

### Q: 圖片顯示太大或太小？
- 調整 `logo-config.js` 中的 `size.sidebar` 和 `size.header` 設定

### Q: 圖片被裁切了？
- 將 `imageSettings.objectFit` 改為 `'contain'`

### Q: 如何讓圖片變成圓形？
- 將 `imageSettings.borderRadius` 改為 `'9999px'`

### Q: 可以同時使用多個圖片嗎？
- 目前系統使用單一 Logo，建議使用圖片編輯軟體合併多個圖片

## 技術說明

### 檔案結構
```
/web/html/urlpj/shorturl-api/public/
├── js/
│   └── logo-config.js          # Logo 配置檔案
├── images/
│   └── logo.png                # 您的 Logo 圖片（自行上傳）
├── index.html                  # 首頁（已整合）
├── links.html                  # 連結列表（已整合）
├── analytics.html              # 數據分析（已整合）
└── edit.html                   # 編輯頁面（已整合）
```

### Logo 渲染機制
- 所有頁面載入時會自動執行 `window.renderLogo()`
- 根據 `logo-config.js` 的設定動態生成 HTML
- 支援響應式設計（桌面版和手機版使用不同尺寸）

## 支援

如有問題或需要協助，請聯繫系統管理員。
