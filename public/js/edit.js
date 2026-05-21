// 將 hex 顏色和透明度轉換為 rgba
function hexToRgba(hex, opacity) {
  if (!hex || !hex.startsWith('#')) return 'rgba(255, 255, 255, 1)'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
}

// 編輯頁面邏輯
let currentUrlId = null
let currentUrlData = null

// DOM 元素
const originalUrlInput = document.getElementById('originalUrl')
const shortCodeInput = document.getElementById('shortCode')
const createdAtInput = document.getElementById('createdAt')
const shareShortUrlBtn = document.getElementById('shareShortUrlBtn')
const copyShortCodeBtn = document.getElementById('copyShortCodeBtn')
const copyAdUrlBtn = document.getElementById('copyAdUrlBtn')
const isActiveToggle = document.getElementById('isActiveToggle')
const passwordToggle = document.getElementById('passwordToggle')
const passwordInputContainer = document.getElementById('passwordInputContainer')
const passwordInput = document.getElementById('passwordInput')
const togglePasswordBtn = document.getElementById('togglePassword')
const expiresToggle = document.getElementById('expiresToggle')
const expiresInputContainer = document.getElementById('expiresInputContainer')
const expiresInput = document.getElementById('expiresInput')
const saveBtn = document.getElementById('saveBtn')
const cancelBtn = document.getElementById('cancelBtn')
const deleteBtn = document.getElementById('deleteBtn')
const loadingOverlay = document.getElementById('loadingOverlay')

// QR Code 元素
const qrCodeContainer = document.getElementById('qrCodeContainer')
const noQrCode = document.getElementById('noQrCode')
const qrCodeCanvas = document.getElementById('qrCodeCanvas')
const downloadQrBtn = document.getElementById('downloadQrBtn')
const customizeQrBtn = document.getElementById('customizeQrBtn')

// QR Code 實例和配置
let currentQRCode = null
let currentQRConfig = null  // 儲存當前配置

// 統計元素
const totalClicksEl = document.getElementById('totalClicks')
const linkClicksEl = document.getElementById('linkClicks')
const qrScansEl = document.getElementById('qrScans')
const lastClickedEl = document.getElementById('lastClicked')

// 從 URL 獲取 ID（支援 /edit/{id} 和 /edit.html?id={id} 兩種格式）
function getUrlId() {
  // 優先從 URL 路徑讀取（/edit/{id}）
  const pathMatch = window.location.pathname.match(/\/edit\/([^\/]+)/)
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1]
  }

  // 備用：從查詢參數讀取（/edit.html?id={id}）
  const params = new URLSearchParams(window.location.search)
  return params.get('id')
}

// 載入 URL 資料 - 使用 Supabase JS
async function loadUrlData() {
  try {
    currentUrlId = getUrlId()
    if (!currentUrlId) {
      utils.showNotification('缺少連結 ID', 'error')
      setTimeout(() => window.location.href = '/links', 2000)
      return
    }

    loadingOverlay.classList.remove('hidden')

    // 使用 api.js 的 getUrl 方法（透過 Supabase JS）
    currentUrlData = await api.getUrl(currentUrlId)

    // 填充表單
    populateForm()

    // 先載入統計，再載入管道（管道統計需要總點擊數）
    await loadStats()
    await loadChannels()

    loadingOverlay.classList.add('hidden')
  } catch (error) {
    console.error('載入失敗:', error)
    utils.showNotification('載入連結資料失敗: ' + error.message, 'error')
    loadingOverlay.classList.add('hidden')
    setTimeout(() => window.location.href = '/links', 2000)
  }
}

// 填充表單
function populateForm() {
  // 基本資訊
  originalUrlInput.value = currentUrlData.original_url || ''
  shortCodeInput.value = currentUrlData.short_code || ''

  // 格式化建立日期
  if (currentUrlData.created_at) {
    const date = new Date(currentUrlData.created_at)
    createdAtInput.value = date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // 啟用狀態
  isActiveToggle.checked = currentUrlData.is_active !== false

  // 密碼保護 - 檢查是否有設定密碼（password_hash 存在）
  const hasPassword = currentUrlData.password_protected || (currentUrlData.password_hash && currentUrlData.password_hash !== null)

  if (hasPassword) {
    passwordToggle.checked = true
    passwordInputContainer.classList.remove('hidden')
    // 已設定密碼，留空表示不修改
    passwordInput.placeholder = '已設定密碼（留空表示不修改）'
    passwordInput.value = ''
  } else {
    passwordToggle.checked = false
    passwordInputContainer.classList.add('hidden')
    passwordInput.placeholder = '請輸入密碼'
    passwordInput.value = ''
  }

  // 過期日期
  if (currentUrlData.expires_at) {
    expiresToggle.checked = true
    expiresInputContainer.classList.remove('hidden')

    // 轉換 PostgreSQL timestamp 為 datetime-local 格式
    const expiresDate = new Date(currentUrlData.expires_at)
    // 格式: YYYY-MM-DDTHH:mm
    expiresInput.value = expiresDate.toISOString().slice(0, 16)
  } else {
    expiresToggle.checked = false
    expiresInputContainer.classList.add('hidden')
  }

  // QR Code - 從資料庫讀取配置並生成
  const fullShortUrl = `${window.location.origin}/s/${currentUrlData.short_code}`

  // 如果有保存的配置，使用該配置生成 QR Code
  if (currentUrlData.qr_code_options) {
    try {
      const savedConfig = currentUrlData.qr_code_options  // jsonb 直接返回物件，不需要 parse

      // Convert hex color and opacity to RGBA
      const customConfig = {
        width: 300,
        height: 300,
        type: "svg",
        dotsOptions: {
          color: savedConfig.dotsColor || '#000000',
          type: savedConfig.dotsType || 'rounded'
        },
        backgroundOptions: {
          color: hexToRgba(savedConfig.bgColor || '#ffffff', savedConfig.bgOpacity || 100)
        },
        cornersSquareOptions: {
          type: savedConfig.cornersSquareType || 'square',
          color: savedConfig.dotsColor || '#000000'
        },
        cornersDotOptions: {
          type: savedConfig.cornersDotType || 'square',
          color: savedConfig.dotsColor || '#000000'
        },
        qrOptions: {
          errorCorrectionLevel: 'H'
        }
      }

      if (savedConfig.showLogo) {
        customConfig.image = "/images/tzuchi-logo.svg"
        customConfig.imageOptions = {
          margin: 10,
          imageSize: 0.3
        }
      }

      generateClientQRCode(fullShortUrl, customConfig)
    } catch (error) {
      console.error('Failed to parse QR code config:', error)
      // 如果解析失敗，使用預設配置
      generateClientQRCode(fullShortUrl)
    }
  } else {
    // 沒有保存的配置，使用預設配置
    generateClientQRCode(fullShortUrl)
  }

  qrCodeContainer.classList.remove('hidden')
  noQrCode.classList.add('hidden')
}

// 載入統計資料
async function loadStats() {
  try {
    const stats = await api.getUrlStats(currentUrlId, 30)

    // API 返回格式: { total: { total_clicks, link_clicks, qr_scans, last_clicked_at }, daily: [...] }
    const total = stats.total || {}

    totalClicksEl.textContent = total.total_clicks?.toLocaleString() || '0'
    linkClicksEl.textContent = total.link_clicks?.toLocaleString() || '0'
    qrScansEl.textContent = total.qr_scans?.toLocaleString() || '0'

    if (total.last_clicked_at) {
      lastClickedEl.textContent = utils.formatDate(total.last_clicked_at)
    } else {
      lastClickedEl.textContent = '尚未訪問'
    }
  } catch (error) {
    console.error('載入統計失敗:', error)
  }
}

// 密碼可見性切換
togglePasswordBtn.addEventListener('click', () => {
  const type = passwordInput.type === 'password' ? 'text' : 'password'
  passwordInput.type = type

  const icon = togglePasswordBtn.querySelector('.material-symbols-outlined')
  icon.textContent = type === 'password' ? 'visibility' : 'visibility_off'
})

// 密碼保護 toggle
passwordToggle.addEventListener('change', () => {
  if (passwordToggle.checked) {
    passwordInputContainer.classList.remove('hidden')
  } else {
    passwordInputContainer.classList.add('hidden')
    passwordInput.value = ''
  }
})

// 過期日期 toggle
expiresToggle.addEventListener('change', () => {
  if (expiresToggle.checked) {
    expiresInputContainer.classList.remove('hidden')
    // 設定最小日期為現在
    const now = new Date()
    const minDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    expiresInput.min = minDate
  } else {
    expiresInputContainer.classList.add('hidden')
    expiresInput.value = ''
  }
})

// 儲存變更
saveBtn.addEventListener('click', async () => {
  try {
    // 驗證
    if (!originalUrlInput.value.trim()) {
      utils.showNotification('請輸入原始網址', 'error')
      originalUrlInput.focus()
      return
    }

    // URL 格式驗證
    try {
      new URL(originalUrlInput.value)
    } catch {
      utils.showNotification('請輸入有效的網址格式', 'error')
      originalUrlInput.focus()
      return
    }

    // 如果啟用密碼保護但沒有現有密碼也沒輸入新密碼
    const hasExistingPassword = currentUrlData.password_protected || (currentUrlData.password_hash && currentUrlData.password_hash !== null)
    if (passwordToggle.checked && !hasExistingPassword && !passwordInput.value) {
      utils.showNotification('請輸入密碼', 'error')
      passwordInput.focus()
      return
    }

    // 如果設定過期日期但沒選擇時間
    if (expiresToggle.checked && !expiresInput.value) {
      utils.showNotification('請選擇過期時間', 'error')
      expiresInput.focus()
      return
    }

    loadingOverlay.classList.remove('hidden')

    // 準備更新資料
    const updates = {
      original_url: originalUrlInput.value.trim(),
      is_active: isActiveToggle.checked,
      password_protected: passwordToggle.checked
    }

    // 密碼處理
    if (passwordToggle.checked && passwordInput.value) {
      updates.password = passwordInput.value
    } else if (!passwordToggle.checked) {
      // 停用密碼保護時清除密碼
      updates.password = null
    }

    // 過期日期處理
    if (expiresToggle.checked && expiresInput.value) {
      // 轉換為 ISO 8601 格式
      updates.expires_at = new Date(expiresInput.value).toISOString()
    } else {
      // 清除過期日期
      updates.expires_at = null
    }

    // 發送更新請求
    await api.updateUrl(currentUrlId, updates)

    utils.showNotification('連結已成功更新', 'success')

    // 延遲後返回列表
    setTimeout(() => {
      window.location.href = '/links'
    }, 1500)

  } catch (error) {
    console.error('儲存失敗:', error)
    utils.showNotification(error.message || '儲存失敗，請稍後再試', 'error')
    loadingOverlay.classList.add('hidden')
  }
})

// 取消按鈕
cancelBtn.addEventListener('click', () => {
  if (confirm('確定要取消編輯嗎？未儲存的變更將會遺失。')) {
    window.location.href = '/links'
  }
})

// 刪除按鈕
deleteBtn.addEventListener('click', async () => {
  const shortCode = currentUrlData?.short_code || '此連結'

  if (!confirm(`確定要刪除 ${shortCode} 嗎？\n\n此操作無法復原！`)) {
    return
  }

  try {
    loadingOverlay.classList.remove('hidden')

    await api.deleteUrl(currentUrlId)

    utils.showNotification('連結已刪除', 'success')

    setTimeout(() => {
      window.location.href = '/links'
    }, 1500)

  } catch (error) {
    console.error('刪除失敗:', error)
    utils.showNotification(error.message || '刪除失敗，請稍後再試', 'error')
    loadingOverlay.classList.add('hidden')
  }
})

// 下載 QR Code（客戶端生成下載）
downloadQrBtn.addEventListener('click', () => {
  if (currentQRCode && currentUrlData) {
    const filename = `qrcode_${currentUrlData.short_code}`
    currentQRCode.download({ name: filename, extension: "png" })
    utils.showNotification('QR Code 已下載！', 'success')
  } else {
    utils.showNotification('請先生成 QR Code', 'error')
  }
})

// 複製短網址
copyShortCodeBtn.addEventListener('click', async () => {
  if (!currentUrlData?.short_code) {
    utils.showNotification('短代碼尚未載入', 'error')
    return
  }

  const shortUrl = `${window.location.origin}/s/${currentUrlData.short_code}`
  const success = await utils.copyToClipboard(shortUrl)

  if (success) {
    utils.showNotification('已複製短網址到剪貼簿！', 'success')

    // 臨時改變圖標為 check
    const icon = copyShortCodeBtn.querySelector('.material-symbols-outlined')
    const originalText = icon.textContent
    icon.textContent = 'check'

    setTimeout(() => {
      icon.textContent = originalText
    }, 2000)
  } else {
    utils.showNotification('複製失敗', 'error')
  }
})

// 複製廣告頁連結
copyAdUrlBtn.addEventListener('click', async () => {
  if (!currentUrlData?.short_code) {
    utils.showNotification('短代碼尚未載入', 'error')
    return
  }

  const adUrl = `${window.location.origin}/ad/${currentUrlData.short_code}`
  const success = await utils.copyToClipboard(adUrl)

  if (success) {
    utils.showNotification('已複製廣告頁連結到剪貼簿！', 'success')

    // 臨時改變圖標為 check
    const icon = copyAdUrlBtn.querySelector('.material-symbols-outlined')
    const originalText = icon.textContent
    icon.textContent = 'check'

    setTimeout(() => {
      icon.textContent = originalText
    }, 2000)
  } else {
    utils.showNotification('複製失敗', 'error')
  }
})

// 分享短網址
shareShortUrlBtn.addEventListener('click', async () => {
  if (!currentUrlData?.short_code) {
    utils.showNotification('短代碼尚未載入', 'error')
    return
  }

  const shortUrl = `${window.location.origin}/s/${currentUrlData.short_code}`

  // 檢查瀏覽器是否支援 Web Share API
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'TCurl 短網址',
        text: '查看這個連結',
        url: shortUrl
      })
      utils.showNotification('分享成功！', 'success')
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error sharing:', error)
      }
    }
  } else {
    // 如果不支援，直接複製連結
    const success = await utils.copyToClipboard(shortUrl)
    if (success) {
      utils.showNotification('已複製到剪貼簿（此瀏覽器不支援分享功能）', 'success')
    } else {
      utils.showNotification('分享失敗', 'error')
    }
  }
})

// ======== QR Code 生成功能 ========

// 載入 QR Code 主題列表（僅用於進階客製化）
// loadThemes 功能已移除，改用客戶端客製化

// ======== 客戶端 QR Code 客製化功能 ========

// 客製化按鈕
customizeQrBtn.addEventListener('click', () => {
  if (!currentUrlData) {
    utils.showNotification('請先載入連結資料', 'error')
    return
  }
  openClientCustomizeModal()
})

// ======== 客戶端 QR Code 生成 ========

// QR Code 配置
const QR_CONFIG = {
  width: 300,
  height: 300,
  type: "svg",
  image: "/images/tzuchi-logo.svg",
  dotsOptions: {
    color: "#000000",
    type: "rounded"
  },
  backgroundOptions: {
    color: "#ffffff"
  },
  qrOptions: {
    errorCorrectionLevel: 'H'
  },
  imageOptions: {
    margin: 10,
    imageSize: 0.4
  }
}

// 客戶端生成 QR Code
function generateClientQRCode(url, customConfig = null) {
  try {
    // 清空容器
    qrCodeCanvas.innerHTML = ''

    // 使用自訂配置或預設配置
    const config = customConfig || QR_CONFIG

    // 儲存當前配置
    currentQRConfig = { ...config, data: url }

    // 創建 QR Code 實例
    currentQRCode = new QRCodeStyling(currentQRConfig)

    // 將 QR Code 添加到容器
    currentQRCode.append(qrCodeCanvas)

    console.log('✅ QR Code generated (client-side) with Tzu Chi logo')
  } catch (error) {
    console.error('Error generating QR code:', error)
  }
}

// 打開客戶端客製化模態視窗
function openClientCustomizeModal() {
  // 取得當前配置
  let currentConfig

  // 優先從 currentQRConfig 讀取（內存中的配置）
  if (currentQRConfig) {
    currentConfig = currentQRConfig
  }
  // 如果沒有 currentQRConfig，嘗試從 currentUrlData.qr_code_options 重建
  else if (currentUrlData?.qr_code_options) {
    const saved = currentUrlData.qr_code_options

    currentConfig = {
      width: 300,
      height: 300,
      type: "svg",
      data: `${window.location.origin}/s/${currentUrlData.short_code}`,
      dotsOptions: {
        color: saved.dotsColor || '#000000',
        type: saved.dotsType || 'rounded'
      },
      backgroundOptions: {
        color: hexToRgba(saved.bgColor || '#ffffff', saved.bgOpacity || 100)
      },
      cornersSquareOptions: {
        type: saved.cornersSquareType || 'square',
        color: saved.dotsColor || '#000000'
      },
      cornersDotOptions: {
        type: saved.cornersDotType || 'square',
        color: saved.dotsColor || '#000000'
      },
      qrOptions: {
        errorCorrectionLevel: 'H'
      }
    }

    if (saved.showLogo) {
      currentConfig.image = "/images/tzuchi-logo.svg"
      currentConfig.imageOptions = {
        margin: 10,
        imageSize: 0.3
      }
    }
  }
  // 最後才使用預設配置
  else {
    currentConfig = { ...QR_CONFIG, data: `${window.location.origin}/s/${currentUrlData.short_code}` }
  }

  // 從 RGBA 或 hex 提取顏色和透明度
  const extractColorAndOpacity = (color) => {
    try {
      if (!color) return { hex: '#ffffff', opacity: 100 }

      // 如果是 RGBA 格式
      if (color.startsWith('rgba') || color.startsWith('rgb')) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/)
        if (match) {
          const [, r, g, b, a] = match
          const hex = '#' + [r, g, b].map(x => {
            const h = parseInt(x).toString(16)
            return h.length === 1 ? '0' + h : h
          }).join('')
          const opacity = a ? Math.round(parseFloat(a) * 100) : 100
          return { hex, opacity }
        }
      }

      // 如果是 hex 格式，直接返回
      if (color.startsWith('#')) {
        return { hex: color, opacity: 100 }
      }

      // 預設值
      return { hex: '#ffffff', opacity: 100 }
    } catch (error) {
      console.error('Color extraction error:', error)
      return { hex: '#ffffff', opacity: 100 }
    }
  }

  const dotsColor = currentConfig.dotsOptions?.color || '#000000'
  const bgColorData = extractColorAndOpacity(currentConfig.backgroundOptions?.color)
  const cornersSquareType = currentConfig.cornersSquareOptions?.type || 'square'
  const cornersDotType = currentConfig.cornersDotOptions?.type || 'square'
  const dotsType = currentConfig.dotsOptions?.type || 'rounded'

  const modal = document.createElement('div')
  modal.id = 'customizeModal'
  modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4'

  modal.innerHTML = `
    <div class="relative bg-[#1e1e1e] rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
      <button class="absolute top-4 right-4 text-white/60 hover:text-white z-10" onclick="document.getElementById('customizeModal').remove()">
        <span class="material-symbols-outlined">close</span>
      </button>

      <h3 class="text-white text-2xl font-bold mb-6">客製化 QR Code</h3>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- 左側：即時預覽 -->
        <div class="flex flex-col gap-4">
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">即時預覽</p>
            <div class="bg-white p-4 rounded-lg flex items-center justify-center" style="min-height: 280px; overflow: hidden;">
              <div id="qrPreviewCanvas" style="width: 300px; height: 300px; transform: scale(0.83); transform-origin: center;"></div>
            </div>
          </div>
        </div>

        <!-- 右側：客製化選項 -->
        <div class="flex flex-col gap-4">
          <!-- 顏色設定 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">顏色設定</p>
            <div class="space-y-3">
              <div>
                <label class="text-white/80 text-xs mb-1 block">QR Code 顏色</label>
                <input type="color" id="qrDotsColor" value="${dotsColor}"
                       class="w-full h-10 rounded border border-white/20 bg-background-dark cursor-pointer">
              </div>
              <div>
                <label class="text-white/80 text-xs mb-1 block">背景顏色</label>
                <input type="color" id="qrBgColor" value="${bgColorData.hex}"
                       class="w-full h-10 rounded border border-white/20 bg-background-dark cursor-pointer">
              </div>
              <div>
                <label class="text-white/80 text-xs mb-1 block">背景透明度</label>
                <input type="range" id="qrBgOpacity" min="0" max="100" value="${bgColorData.opacity}"
                       class="w-full">
                <div class="flex justify-between text-white/40 text-xs mt-1">
                  <span>透明</span>
                  <span id="qrBgOpacityValue">${bgColorData.opacity}%</span>
                  <span>不透明</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 樣式設定 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">樣式設定</p>
            <div class="space-y-3">
              <div>
                <label class="text-white/80 text-xs mb-1 block">Dots 樣式（主體方塊）</label>
                <select id="qrDotsType" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-3 text-sm">
                  <option value="square" ${dotsType === 'square' ? 'selected' : ''}>方形 (Square)</option>
                  <option value="rounded" ${dotsType === 'rounded' ? 'selected' : ''}>圓角 (Rounded)</option>
                  <option value="extra-rounded" ${dotsType === 'extra-rounded' ? 'selected' : ''}>超圓角 (Extra Rounded)</option>
                  <option value="dots" ${dotsType === 'dots' ? 'selected' : ''}>圓點 (Dots)</option>
                  <option value="classy" ${dotsType === 'classy' ? 'selected' : ''}>優雅 (Classy)</option>
                  <option value="classy-rounded" ${dotsType === 'classy-rounded' ? 'selected' : ''}>優雅圓角 (Classy Rounded)</option>
                </select>
              </div>
              <div>
                <label class="text-white/80 text-xs mb-1 block">定位點外框樣式</label>
                <select id="qrCornersSquareType" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-3 text-sm">
                  <option value="square" ${cornersSquareType === 'square' ? 'selected' : ''}>方形 (Square)</option>
                  <option value="extra-rounded" ${cornersSquareType === 'extra-rounded' ? 'selected' : ''}>超圓角 (Extra Rounded)</option>
                  <option value="dot" ${cornersSquareType === 'dot' ? 'selected' : ''}>圓點 (Dot)</option>
                </select>
              </div>
              <div>
                <label class="text-white/80 text-xs mb-1 block">定位點內部樣式</label>
                <select id="qrCornersDotType" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-3 text-sm">
                  <option value="square" ${cornersDotType === 'square' ? 'selected' : ''}>方形 (Square)</option>
                  <option value="dot" ${cornersDotType === 'dot' ? 'selected' : ''}>圓點 (Dot)</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Logo 設定 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">Logo 設定</p>
            <div class="flex items-center gap-2">
              <input type="checkbox" id="qrShowLogo" ${currentConfig.image ? 'checked' : ''}
                     class="w-4 h-4 rounded border-white/20 bg-background-dark">
              <label class="text-white/80 text-sm">顯示慈濟 Logo</label>
            </div>
          </div>

          <!-- 按鈕 -->
          <div class="flex gap-2 mt-4">
            <button id="applyQrBtn" class="flex-1 bg-primary hover:bg-blue-600 text-white rounded-lg py-3 font-bold transition-colors">
              套用
            </button>
            <button onclick="document.getElementById('customizeModal').remove()"
                    class="flex-1 bg-white/10 hover:bg-white/20 text-white rounded-lg py-3 font-bold transition-colors">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  `

  document.body.appendChild(modal)

  // 重置預覽實例（因為是新的 DOM 元素）
  previewQRInstance = null

  // 初始化預覽
  setTimeout(() => updateQRPreview(), 100)

  // 綁定事件監聽器
  const previewInputs = ['qrDotsColor', 'qrBgColor', 'qrBgOpacity', 'qrDotsType', 'qrCornersSquareType', 'qrCornersDotType', 'qrShowLogo']
  previewInputs.forEach(id => {
    const element = document.getElementById(id)
    if (element) {
      element.addEventListener('change', () => {
        if (id === 'qrBgOpacity') {
          document.getElementById('qrBgOpacityValue').textContent = element.value + '%'
        }
        updateQRPreview()
      })
      element.addEventListener('input', () => {
        if (id === 'qrBgOpacity') {
          document.getElementById('qrBgOpacityValue').textContent = element.value + '%'
        }
        updateQRPreview()
      })
    }
  })

  // 套用按鈕
  document.getElementById('applyQrBtn').addEventListener('click', applyCustomQR)
}

// 全域預覽 QR Code 實例
let previewQRInstance = null

// 更新 QR Code 預覽
function updateQRPreview() {
  try {
    const previewCanvas = document.getElementById('qrPreviewCanvas')
    if (!previewCanvas) return

    const dotsColor = document.getElementById('qrDotsColor')?.value || '#000000'
    const bgColor = document.getElementById('qrBgColor')?.value || '#ffffff'
    const bgOpacity = parseInt(document.getElementById('qrBgOpacity')?.value || '100')
    const dotsType = document.getElementById('qrDotsType')?.value || 'rounded'
    const cornersSquareType = document.getElementById('qrCornersSquareType')?.value || 'square'
    const cornersDotType = document.getElementById('qrCornersDotType')?.value || 'square'
    const showLogo = document.getElementById('qrShowLogo')?.checked || false

    const config = {
      width: 300,
      height: 300,
      type: "canvas",  // 使用 canvas 而不是 svg，渲染更可靠
      data: `${window.location.origin}/s/${currentUrlData.short_code}`,
      dotsOptions: {
        color: dotsColor,
        type: dotsType
      },
      backgroundOptions: {
        color: hexToRgba(bgColor, bgOpacity)
      },
      cornersSquareOptions: {
        type: cornersSquareType,
        color: dotsColor
      },
      cornersDotOptions: {
        type: cornersDotType,
        color: dotsColor
      },
      qrOptions: {
        errorCorrectionLevel: 'H'
      }
    }

    if (showLogo) {
      config.image = "/images/tzuchi-logo.svg"
      config.imageOptions = {
        margin: 10,
        imageSize: 0.3
      }
    }

    // 每次都完全清空容器並重新創建（因為 update() 方法似乎不可靠）
    // 完全清空容器（使用多種方法確保清除）
    previewCanvas.innerHTML = ''
    previewCanvas.textContent = ''
    while (previewCanvas.firstChild) {
      previewCanvas.removeChild(previewCanvas.firstChild)
    }

    // 強制瀏覽器重繪
    void previewCanvas.offsetHeight

    // 創建新實例
    previewQRInstance = new QRCodeStyling(config)

    // 使用 setTimeout 確保 DOM 已經清空
    setTimeout(() => {
      previewQRInstance.append(previewCanvas)
    }, 0)
  } catch (error) {
    console.error('Preview error:', error)
    const previewCanvas = document.getElementById('qrPreviewCanvas')
    if (previewCanvas) {
      previewCanvas.innerHTML = '<div style="color: red; font-size: 12px;">預覽錯誤，請檢查設定</div>'
    }
  }
}

// 套用自訂 QR Code
async function applyCustomQR() {
  try {
    const dotsColor = document.getElementById('qrDotsColor').value
    const bgColor = document.getElementById('qrBgColor').value
    const bgOpacity = parseInt(document.getElementById('qrBgOpacity').value)
    const dotsType = document.getElementById('qrDotsType').value
    const cornersSquareType = document.getElementById('qrCornersSquareType').value
    const cornersDotType = document.getElementById('qrCornersDotType').value
    const showLogo = document.getElementById('qrShowLogo').checked

    const qrConfig = {
      dotsColor,
      bgColor,
      bgOpacity,
      dotsType,
      cornersSquareType,
      cornersDotType,
      showLogo
    }

    const customConfig = {
      width: 300,
      height: 300,
      type: "svg",
      data: `${window.location.origin}/s/${currentUrlData.short_code}`,
      dotsOptions: {
        color: dotsColor,
        type: dotsType
      },
      backgroundOptions: {
        color: hexToRgba(bgColor, bgOpacity)
      },
      cornersSquareOptions: {
        type: cornersSquareType,
        color: dotsColor
      },
      cornersDotOptions: {
        type: cornersDotType,
        color: dotsColor
      },
      qrOptions: {
        errorCorrectionLevel: 'H'
      }
    }

    if (showLogo) {
      customConfig.image = "/images/tzuchi-logo.svg"
      customConfig.imageOptions = {
        margin: 10,
        imageSize: 0.3
      }
    }

    // 顯示載入狀態
    utils.showNotification('正在保存 QR Code...', 'info')

    // 生成 PNG data URL
    const qrCodeInstance = new QRCodeStyling(customConfig)
    const pngBlob = await qrCodeInstance.getRawData('png')

    // 轉換為 base64 data URL
    const reader = new FileReader()
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(pngBlob)
    })

    // 使用 api.js 的 updateQRCode 方法（透過 Supabase JS）
    const result = await api.updateQRCode(currentUrlId, qrConfig, dataUrl)

    // 更新本地 QR Code 顯示
    const fullShortUrl = `${window.location.origin}/s/${currentUrlData.short_code}`
    generateClientQRCode(fullShortUrl, customConfig)

    // 更新 currentUrlData
    currentUrlData.qr_code_options = qrConfig  // 直接儲存物件
    currentUrlData.qr_code_path = result.qr_code_path

    // 關閉模態視窗
    document.getElementById('customizeModal').remove()

    utils.showNotification('QR Code 已保存！', 'success')
  } catch (error) {
    console.error('Error applying custom QR Code:', error)
    utils.showNotification('保存失敗，請稍後再試', 'error')
  }
}

// ======== 管道追蹤功能 ========

let currentChannels = []

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function loadChannels() {
  const listEl = document.getElementById('channelsList')
  const loadingEl = document.getElementById('channelsLoading')
  const emptyEl = document.getElementById('noChannels')
  if (!currentUrlId || !listEl) return
  try {
    currentChannels = await api.getChannels(currentUrlId)
    renderChannels()
  } catch (error) {
    console.error('載入管道失敗:', error)
    if (loadingEl) loadingEl.classList.add('hidden')
    if (emptyEl) emptyEl.classList.remove('hidden')
  }
}

function renderChannels() {
  const listEl = document.getElementById('channelsList')
  const loadingEl = document.getElementById('channelsLoading')
  const emptyEl = document.getElementById('noChannels')
  const countEl = document.getElementById('channelCount')
  const addBtn = document.getElementById('addChannelBtn')

  if (loadingEl) loadingEl.classList.add('hidden')

  if (currentChannels.length === 0) {
    listEl.classList.add('hidden')
    emptyEl.classList.remove('hidden')
    countEl.classList.add('hidden')
    if (addBtn) addBtn.disabled = false
    return
  }

  emptyEl.classList.add('hidden')
  listEl.classList.remove('hidden')
  countEl.classList.remove('hidden')
  countEl.textContent = `已建立 ${currentChannels.length} / 5 個管道`
  if (addBtn) addBtn.disabled = currentChannels.length >= 5

  listEl.innerHTML = currentChannels.map(ch => {
    const utmParts = []
    if (ch.utm_source) utmParts.push(`source=${ch.utm_source}`)
    if (ch.utm_medium) utmParts.push(`medium=${ch.utm_medium}`)
    if (ch.utm_campaign) utmParts.push(`campaign=${ch.utm_campaign}`)
    if (ch.utm_content) utmParts.push(`content=${ch.utm_content}`)
    if (ch.utm_term) utmParts.push(`term=${ch.utm_term}`)
    const utmText = utmParts.length > 0 ? utmParts.join(' · ') : '未設定 UTM 參數'

    return `
      <div class="flex items-start gap-3 p-4 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-white font-medium">${escapeHtml(ch.name)}</span>
            <span class="text-white/40 text-xs bg-white/10 px-2 py-0.5 rounded font-mono">g=${ch.group_key}</span>
            ${ch.click_count > 0 ? `<span class="text-primary text-xs font-medium">${ch.click_count} 次點擊</span>` : ''}
          </div>
          <p class="text-white/40 text-xs mt-1.5 truncate">${escapeHtml(utmText)}</p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button data-action="copy" data-id="${ch.id}" class="p-2 text-white/60 hover:text-white transition-colors" title="複製管道連結">
            <span class="material-symbols-outlined text-lg">content_copy</span>
          </button>
          <button data-action="qr" data-id="${ch.id}" class="p-2 text-white/60 hover:text-white transition-colors" title="管道 QR Code">
            <span class="material-symbols-outlined text-lg">qr_code_2</span>
          </button>
          <button data-action="edit" data-id="${ch.id}" class="p-2 text-white/60 hover:text-white transition-colors" title="編輯管道">
            <span class="material-symbols-outlined text-lg">edit</span>
          </button>
          <button data-action="delete" data-id="${ch.id}" class="p-2 text-red-400/60 hover:text-red-400 transition-colors" title="刪除管道">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      </div>
    `
  }).join('')

  renderChannelStats()
}

function renderChannelStats() {
  const section = document.getElementById('channelStatsSection')
  const content = document.getElementById('channelStatsContent')
  if (!section || !content) return

  if (currentChannels.length === 0) {
    section.classList.add('hidden')
    return
  }

  section.classList.remove('hidden')

  const totalAll = parseInt(totalClicksEl.textContent.replace(/,/g, '')) || 0
  const totalChannel = currentChannels.reduce((sum, ch) => sum + (ch.click_count || 0), 0)
  const directClicks = Math.max(0, totalAll - totalChannel)

  let html = ''

  if (totalAll > 0) {
    html += `
      <div class="flex items-center gap-2">
        <span class="text-white/60 text-xs w-20 truncate">直接訪問</span>
        <div class="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
          <div class="h-full bg-white/30 rounded-full transition-all" style="width: ${Math.round(directClicks / totalAll * 100)}%"></div>
        </div>
        <span class="text-white/60 text-xs w-12 text-right">${directClicks}</span>
      </div>
    `
  }

  for (const ch of currentChannels) {
    const pct = totalAll > 0 ? Math.round((ch.click_count || 0) / totalAll * 100) : 0
    html += `
      <div class="flex items-center gap-2">
        <span class="text-white text-xs w-20 truncate" title="${escapeHtml(ch.name)}">${escapeHtml(ch.name)}</span>
        <div class="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
          <div class="h-full bg-primary rounded-full transition-all" style="width: ${pct}%"></div>
        </div>
        <span class="text-white/60 text-xs w-12 text-right">${ch.click_count || 0}</span>
      </div>
    `
  }

  content.innerHTML = html
}

// Channel list event delegation
document.getElementById('channelsList')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]')
  if (!btn) return
  const action = btn.dataset.action
  const id = btn.dataset.id
  const ch = currentChannels.find(c => c.id === id)
  if (!ch) return

  if (action === 'copy') {
    const link = `${window.location.origin}/s/${currentUrlData.short_code}?g=${ch.group_key}`
    const ok = await utils.copyToClipboard(link)
    if (ok) {
      utils.showNotification('已複製管道連結', 'success')
      const icon = btn.querySelector('.material-symbols-outlined')
      if (icon) { icon.textContent = 'check'; setTimeout(() => icon.textContent = 'content_copy', 2000) }
    }
  } else if (action === 'qr') {
    showChannelQR(ch)
  } else if (action === 'edit') {
    openChannelModal(ch.id)
  } else if (action === 'delete') {
    if (!confirm(`確定要刪除管道「${ch.name}」嗎？`)) return
    try {
      await api.deleteChannel(currentUrlId, ch.id)
      utils.showNotification('管道已刪除', 'success')
      await loadChannels()
    } catch (err) {
      utils.showNotification(err.message, 'error')
    }
  }
})

// Add channel button
document.getElementById('addChannelBtn')?.addEventListener('click', () => openChannelModal())

function showChannelQR(ch) {
  const qrUrl = `${window.location.origin}/s/${currentUrlData.short_code}?g=${ch.group_key}&qr=1`

  let qrConfig = { ...QR_CONFIG, data: qrUrl }
  if (currentUrlData?.qr_code_options) {
    const saved = currentUrlData.qr_code_options
    qrConfig = {
      width: 300, height: 300, type: "svg", data: qrUrl,
      dotsOptions: { color: saved.dotsColor || '#000000', type: saved.dotsType || 'rounded' },
      backgroundOptions: { color: hexToRgba(saved.bgColor || '#ffffff', saved.bgOpacity || 100) },
      cornersSquareOptions: { type: saved.cornersSquareType || 'square', color: saved.dotsColor || '#000000' },
      cornersDotOptions: { type: saved.cornersDotType || 'square', color: saved.dotsColor || '#000000' },
      qrOptions: { errorCorrectionLevel: 'H' }
    }
    if (saved.showLogo) {
      qrConfig.image = "/images/tzuchi-logo.svg"
      qrConfig.imageOptions = { margin: 10, imageSize: 0.3 }
    }
  }

  const modal = document.createElement('div')
  modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4'
  modal.innerHTML = `
    <div class="relative bg-[#1e1e1e] rounded-xl p-6 max-w-md w-full">
      <button class="absolute top-4 right-4 text-white/60 hover:text-white" onclick="this.closest('.fixed').remove()">
        <span class="material-symbols-outlined">close</span>
      </button>
      <h3 class="text-white text-xl font-bold mb-1">管道 QR Code</h3>
      <p class="text-white/60 text-sm mb-4">${escapeHtml(ch.name)}</p>
      <div class="bg-white p-4 rounded-lg mb-4 flex justify-center">
        <div id="channelQRCanvas"></div>
      </div>
      <p class="text-white/40 text-xs text-center mb-4 font-mono break-all">${escapeHtml(qrUrl)}</p>
      <div class="flex gap-2">
        <button id="dlChannelQR" class="flex-1 bg-primary hover:bg-blue-600 text-white rounded-lg py-3 font-bold flex items-center justify-center gap-2 transition-colors">
          <span class="material-symbols-outlined text-lg">download</span>
          <span>下載</span>
        </button>
        <button class="flex-1 bg-white/10 hover:bg-white/20 text-white rounded-lg py-3 font-bold transition-colors" onclick="this.closest('.fixed').remove()">
          關閉
        </button>
      </div>
    </div>
  `
  document.body.appendChild(modal)

  const qrInstance = new QRCodeStyling(qrConfig)
  qrInstance.append(document.getElementById('channelQRCanvas'))

  document.getElementById('dlChannelQR').addEventListener('click', () => {
    qrInstance.download({ name: `qrcode_${currentUrlData.short_code}_${ch.group_key}`, extension: "png" })
    utils.showNotification('QR Code 已下載', 'success')
  })

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
}

function openChannelModal(channelId) {
  const channel = channelId ? currentChannels.find(c => c.id === channelId) : null
  const isEdit = !!channel

  const modal = document.createElement('div')
  modal.id = 'channelModal'
  modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4'
  modal.innerHTML = `
    <div class="relative bg-[#1e1e1e] rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
      <button class="absolute top-4 right-4 text-white/60 hover:text-white" onclick="document.getElementById('channelModal').remove()">
        <span class="material-symbols-outlined">close</span>
      </button>
      <h3 class="text-white text-xl font-bold mb-6">${isEdit ? '編輯管道' : '新增管道'}</h3>
      <div class="space-y-4">
        <label class="flex flex-col">
          <p class="text-white text-sm font-medium pb-2">管道名稱 <span class="text-red-400">*</span></p>
          <input id="chName" type="text" value="${isEdit ? escapeHtml(channel.name) : ''}"
                 class="form-input w-full rounded-lg text-white bg-background-dark border border-white/20 h-12 px-4 focus:outline-0 focus:ring-2 focus:ring-primary/50"
                 placeholder="例：Facebook 廣告、LINE 推播、Email EDM" />
        </label>
        <div class="border-t border-white/10 pt-4">
          <p class="text-white text-sm font-medium mb-1">UTM 參數</p>
          <p class="text-white/40 text-xs mb-3">選填，自動附加到目標網址供 GA4 分析</p>
          <div class="space-y-3">
            <label class="flex flex-col">
              <p class="text-white/80 text-xs pb-1">utm_source</p>
              <input id="chUtmSource" type="text" value="${isEdit ? escapeHtml(channel.utm_source || '') : ''}"
                     class="form-input w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-4 text-sm focus:outline-0 focus:ring-2 focus:ring-primary/50"
                     placeholder="例：facebook, line, newsletter" />
            </label>
            <label class="flex flex-col">
              <p class="text-white/80 text-xs pb-1">utm_medium</p>
              <input id="chUtmMedium" type="text" value="${isEdit ? escapeHtml(channel.utm_medium || '') : ''}"
                     class="form-input w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-4 text-sm focus:outline-0 focus:ring-2 focus:ring-primary/50"
                     placeholder="例：social, email, cpc" />
            </label>
            <label class="flex flex-col">
              <p class="text-white/80 text-xs pb-1">utm_campaign</p>
              <input id="chUtmCampaign" type="text" value="${isEdit ? escapeHtml(channel.utm_campaign || '') : ''}"
                     class="form-input w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-4 text-sm focus:outline-0 focus:ring-2 focus:ring-primary/50"
                     placeholder="例：2026_spring_campaign" />
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex flex-col">
                <p class="text-white/80 text-xs pb-1">utm_content</p>
                <input id="chUtmContent" type="text" value="${isEdit ? escapeHtml(channel.utm_content || '') : ''}"
                       class="form-input w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-4 text-sm focus:outline-0 focus:ring-2 focus:ring-primary/50"
                       placeholder="例：banner_top" />
              </label>
              <label class="flex flex-col">
                <p class="text-white/80 text-xs pb-1">utm_term</p>
                <input id="chUtmTerm" type="text" value="${isEdit ? escapeHtml(channel.utm_term || '') : ''}"
                       class="form-input w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-4 text-sm focus:outline-0 focus:ring-2 focus:ring-primary/50"
                       placeholder="例：短網址" />
              </label>
            </div>
          </div>
        </div>
      </div>
      <div class="flex gap-2 mt-6">
        <button id="saveChannelBtn" class="flex-1 bg-primary hover:bg-blue-600 text-white rounded-lg py-3 font-bold transition-colors">
          ${isEdit ? '儲存變更' : '建立管道'}
        </button>
        <button class="flex-1 bg-white/10 hover:bg-white/20 text-white rounded-lg py-3 font-bold transition-colors"
                onclick="document.getElementById('channelModal').remove()">取消</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  document.getElementById('chName').focus()

  document.getElementById('saveChannelBtn').addEventListener('click', async () => {
    const name = document.getElementById('chName').value.trim()
    if (!name) {
      utils.showNotification('請輸入管道名稱', 'error')
      document.getElementById('chName').focus()
      return
    }
    const data = {
      name,
      utm_source: document.getElementById('chUtmSource').value.trim() || null,
      utm_medium: document.getElementById('chUtmMedium').value.trim() || null,
      utm_campaign: document.getElementById('chUtmCampaign').value.trim() || null,
      utm_content: document.getElementById('chUtmContent').value.trim() || null,
      utm_term: document.getElementById('chUtmTerm').value.trim() || null
    }
    const btn = document.getElementById('saveChannelBtn')
    btn.disabled = true
    btn.textContent = '處理中...'
    try {
      if (isEdit) {
        await api.updateChannel(currentUrlId, channelId, data)
        utils.showNotification('管道已更新', 'success')
      } else {
        await api.createChannel(currentUrlId, data)
        utils.showNotification('管道已建立', 'success')
      }
      document.getElementById('channelModal').remove()
      await loadChannels()
    } catch (err) {
      utils.showNotification(err.message, 'error')
      btn.disabled = false
      btn.textContent = isEdit ? '儲存變更' : '建立管道'
    }
  })

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
}

// 初始載入函數 - 由頁面在 auth 初始化後調用
function initEdit() {
  loadUrlData()
}

// 導出給頁面使用
window.initEdit = initEdit
