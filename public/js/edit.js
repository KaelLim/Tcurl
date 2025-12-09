// 編輯頁面邏輯
let currentUrlId = null
let currentUrlData = null
let availableThemes = []
let selectedThemeId = null

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

    // 載入統計資料
    await loadStats()

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
      const hexToRgba = (hex, opacity) => {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
      }

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

// 下載 QR Code
downloadQrBtn.addEventListener('click', () => {
  if (currentUrlData?.qr_code_path) {
    const link = document.createElement('a')
    link.href = currentUrlData.qr_code_path
    link.download = `qrcode-${currentUrlData.short_code}.png`
    link.click()
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

// 打開客製化面板
function openCustomizeModal() {
  const modal = document.createElement('div')
  modal.id = 'customizeModal'
  modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4'

  const selectedTheme = availableThemes.find(t => t.id === selectedThemeId) || availableThemes[0]

  // 從新的 API 結構取得預設值
  const dotsColor = selectedTheme.options.dotsOptions?.color || '#000000'
  const bgColor = selectedTheme.options.backgroundOptions?.color || '#ffffff'
  const themeWidth = selectedTheme.options.width || 500
  const dotsType = selectedTheme.options.dotsOptions?.type || 'square'
  const cornersSquareType = selectedTheme.options.cornersSquareOptions?.type || 'square'
  const cornersDotType = selectedTheme.options.cornersDotOptions?.type || 'dot'
  const errorLevel = selectedTheme.options.qrOptions?.errorCorrectionLevel || 'H'

  modal.innerHTML = `
    <div class="relative bg-[#1e1e1e] rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
      <button class="absolute top-4 right-4 text-white/60 hover:text-white z-10" onclick="closeCustomizeModal()">
        <span class="material-symbols-outlined">close</span>
      </button>

      <h3 class="text-white text-2xl font-bold mb-6">QR Code 進階客製化</h3>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- 左側：即時預覽 -->
        <div class="flex flex-col gap-4">
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <p class="text-white text-sm font-medium">即時預覽</p>
              <button id="togglePreviewBgBtn" class="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors" title="切換預覽背景">
                <span class="material-symbols-outlined text-base">contrast</span>
                <span>切換背景</span>
              </button>
            </div>
            <div id="qrPreviewContainer" class="bg-white p-4 rounded-lg flex items-center justify-center min-h-[280px] transition-colors duration-300">
              <div id="qrPreviewLoading" class="flex flex-col items-center gap-2">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                <span class="text-sm text-gray-600">載入中...</span>
              </div>
              <img id="qrPreviewImage" class="hidden w-64 h-64 object-contain" alt="QR Preview">
            </div>
          </div>
          <div class="flex gap-2">
            <button id="applyCustomBtn" class="flex-1 bg-primary hover:bg-blue-600 text-white rounded-lg py-3 font-bold transition-colors">
              套用並生成
            </button>
            <button onclick="closeCustomizeModal()" class="flex-1 bg-white/10 hover:bg-white/20 text-white rounded-lg py-3 font-bold transition-colors">
              取消
            </button>
          </div>
        </div>

        <!-- 右側：客製化選項 -->
        <div class="flex flex-col gap-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          <!-- 基礎主題選擇 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">基礎主題</p>
            <select id="customThemeSelect" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-3 text-sm">
              ${availableThemes.map(theme =>
                `<option value="${theme.id}" ${theme.id === selectedThemeId ? 'selected' : ''}>${theme.name} - ${theme.description}</option>`
              ).join('')}
            </select>
          </div>

          <!-- 顏色設定 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">顏色設定</p>
            <div class="space-y-4">
              <!-- 前景色 -->
              <div>
                <label class="text-white/80 text-xs mb-1 block">前景色 (Dots)</label>
                <input type="color" id="dotsColorInput" value="${dotsColor}" class="w-full h-10 rounded border border-white/20 bg-background-dark cursor-pointer">
              </div>

              <!-- 背景色 -->
              <div>
                <label class="text-white/80 text-xs mb-1 block">背景色</label>
                <input type="color" id="bgColorInput" value="${bgColor}" class="w-full h-10 rounded border border-white/20 bg-background-dark cursor-pointer mb-2">

                <!-- 背景透明度 -->
                <div class="flex items-center gap-3">
                  <label class="text-white/80 text-xs whitespace-nowrap">透明度:</label>
                  <input type="range" id="bgOpacityInput" min="0" max="100" value="100" class="flex-1">
                  <span id="bgOpacityValue" class="text-white text-xs font-mono w-12 text-right">100%</span>
                </div>
                <p class="text-white/40 text-[10px] mt-1">提示：0% = 完全透明，100% = 完全不透明</p>
              </div>
            </div>
          </div>

          <!-- Dots 樣式 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">Dots 樣式（主體方塊）</p>
            <select id="dotsTypeInput" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-3 text-sm">
              <option value="square" ${dotsType === 'square' ? 'selected' : ''}>方形 (Square)</option>
              <option value="rounded" ${dotsType === 'rounded' ? 'selected' : ''}>圓角 (Rounded)</option>
              <option value="extra-rounded" ${dotsType === 'extra-rounded' ? 'selected' : ''}>超圓角 (Extra Rounded)</option>
              <option value="dots" ${dotsType === 'dots' ? 'selected' : ''}>圓點 (Dots)</option>
              <option value="classy" ${dotsType === 'classy' ? 'selected' : ''}>經典 (Classy)</option>
              <option value="classy-rounded" ${dotsType === 'classy-rounded' ? 'selected' : ''}>圓角經典 (Classy Rounded)</option>
            </select>
          </div>

          <!-- Corners Square 樣式 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">Corners Square（回字圖外框）</p>
            <select id="cornersSquareTypeInput" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-3 text-sm">
              <option value="square" ${cornersSquareType === 'square' ? 'selected' : ''}>方形</option>
              <option value="rounded" ${cornersSquareType === 'rounded' ? 'selected' : ''}>圓角</option>
              <option value="extra-rounded" ${cornersSquareType === 'extra-rounded' ? 'selected' : ''}>超圓角</option>
              <option value="dot" ${cornersSquareType === 'dot' ? 'selected' : ''}>圓點</option>
              <option value="classy" ${cornersSquareType === 'classy' ? 'selected' : ''}>經典</option>
              <option value="classy-rounded" ${cornersSquareType === 'classy-rounded' ? 'selected' : ''}>圓角經典</option>
            </select>
          </div>

          <!-- Corners Dot 樣式 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">Corners Dot（回字圖內部）</p>
            <select id="cornersDotTypeInput" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-3 text-sm">
              <option value="square" ${cornersDotType === 'square' ? 'selected' : ''}>方形</option>
              <option value="rounded" ${cornersDotType === 'rounded' ? 'selected' : ''}>圓角</option>
              <option value="extra-rounded" ${cornersDotType === 'extra-rounded' ? 'selected' : ''}>超圓角</option>
              <option value="dot" ${cornersDotType === 'dot' ? 'selected' : ''}>圓點</option>
              <option value="classy" ${cornersDotType === 'classy' ? 'selected' : ''}>經典</option>
              <option value="classy-rounded" ${cornersDotType === 'classy-rounded' ? 'selected' : ''}>圓角經典</option>
            </select>
          </div>

          <!-- 尺寸設定 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">尺寸設定</p>
            <div class="flex items-center gap-3">
              <label class="text-white/80 text-xs">大小:</label>
              <input type="range" id="sizeInput" min="300" max="1000" step="50" value="${themeWidth}" class="flex-1">
              <span id="sizeValue" class="text-white text-sm font-mono w-16 text-right">${themeWidth}px</span>
            </div>
          </div>

          <!-- 容錯率設定 -->
          <div class="bg-white/5 border border-white/10 rounded-lg p-4">
            <p class="text-white text-sm font-medium mb-3">容錯率</p>
            <select id="qualityInput" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-10 px-3 text-sm">
              <option value="L" ${errorLevel === 'L' ? 'selected' : ''}>低 (L) - 7%</option>
              <option value="M" ${errorLevel === 'M' ? 'selected' : ''}>中 (M) - 15%</option>
              <option value="Q" ${errorLevel === 'Q' ? 'selected' : ''}>高 (Q) - 25%</option>
              <option value="H" ${errorLevel === 'H' ? 'selected' : ''}>最高 (H) - 30%</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `

  document.body.appendChild(modal)

  // 綁定事件
  setupCustomizeModalEvents()

  // 初始預覽
  updateQRPreview()
}

// 關閉客製化面板
function closeCustomizeModal() {
  const modal = document.getElementById('customizeModal')
  if (modal) modal.remove()
}

// 設定客製化面板事件
function setupCustomizeModalEvents() {
  const themeSelect = document.getElementById('customThemeSelect')
  const dotsColorInput = document.getElementById('dotsColorInput')
  const bgColorInput = document.getElementById('bgColorInput')
  const bgOpacityInput = document.getElementById('bgOpacityInput')
  const dotsTypeInput = document.getElementById('dotsTypeInput')
  const cornersSquareTypeInput = document.getElementById('cornersSquareTypeInput')
  const cornersDotTypeInput = document.getElementById('cornersDotTypeInput')
  const sizeInput = document.getElementById('sizeInput')
  const qualityInput = document.getElementById('qualityInput')
  const applyBtn = document.getElementById('applyCustomBtn')
  const togglePreviewBgBtn = document.getElementById('togglePreviewBgBtn')
  const qrPreviewContainer = document.getElementById('qrPreviewContainer')

  // 切換預覽背景
  let isDarkBg = false
  togglePreviewBgBtn.addEventListener('click', () => {
    isDarkBg = !isDarkBg
    if (isDarkBg) {
      qrPreviewContainer.classList.remove('bg-white')
      qrPreviewContainer.classList.add('bg-[#1e1e1e]')
    } else {
      qrPreviewContainer.classList.remove('bg-[#1e1e1e]')
      qrPreviewContainer.classList.add('bg-white')
    }
  })

  // 主題變更
  themeSelect.addEventListener('change', (e) => {
    const theme = availableThemes.find(t => t.id === e.target.value)
    if (theme) {
      dotsColorInput.value = theme.options.dotsOptions?.color || '#000000'
      bgColorInput.value = theme.options.backgroundOptions?.color || '#ffffff'
      bgOpacityInput.value = 100
      document.getElementById('bgOpacityValue').textContent = '100%'
      dotsTypeInput.value = theme.options.dotsOptions?.type || 'square'
      cornersSquareTypeInput.value = theme.options.cornersSquareOptions?.type || 'square'
      cornersDotTypeInput.value = theme.options.cornersDotOptions?.type || 'dot'
      sizeInput.value = theme.options.width || 500
      qualityInput.value = theme.options.qrOptions?.errorCorrectionLevel || 'H'
      document.getElementById('sizeValue').textContent = (theme.options.width || 500) + 'px'
      updateQRPreview()
    }
  })

  // 即時預覽更新
  dotsColorInput.addEventListener('input', updateQRPreview)
  bgColorInput.addEventListener('input', updateQRPreview)
  bgOpacityInput.addEventListener('input', (e) => {
    document.getElementById('bgOpacityValue').textContent = e.target.value + '%'
    updateQRPreview()
  })
  dotsTypeInput.addEventListener('change', updateQRPreview)
  cornersSquareTypeInput.addEventListener('change', updateQRPreview)
  cornersDotTypeInput.addEventListener('change', updateQRPreview)
  sizeInput.addEventListener('input', (e) => {
    document.getElementById('sizeValue').textContent = e.target.value + 'px'
    updateQRPreview()
  })
  qualityInput.addEventListener('change', updateQRPreview)

  // 套用按鈕
  applyBtn.addEventListener('click', applyCustomQRCode)
}

// 將 hex 顏色和透明度轉換為 rgba
function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const a = opacity / 100
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

// 更新 QR Code 預覽
let previewTimeout = null
async function updateQRPreview() {
  // 防抖
  if (previewTimeout) clearTimeout(previewTimeout)

  previewTimeout = setTimeout(async () => {
    const loading = document.getElementById('qrPreviewLoading')
    const preview = document.getElementById('qrPreviewImage')

    if (!loading || !preview) return

    loading.classList.remove('hidden')
    preview.classList.add('hidden')

    try {
      const bgColorHex = document.getElementById('bgColorInput').value
      const bgOpacity = parseInt(document.getElementById('bgOpacityInput').value)
      const bgColor = hexToRgba(bgColorHex, bgOpacity)

      const customOptions = {
        width: parseInt(document.getElementById('sizeInput').value),
        height: parseInt(document.getElementById('sizeInput').value),
        dotsOptions: {
          color: document.getElementById('dotsColorInput').value,
          type: document.getElementById('dotsTypeInput').value
        },
        backgroundOptions: {
          color: bgColor
        },
        cornersSquareOptions: {
          color: document.getElementById('dotsColorInput').value,
          type: document.getElementById('cornersSquareTypeInput').value
        },
        cornersDotOptions: {
          color: document.getElementById('dotsColorInput').value,
          type: document.getElementById('cornersDotTypeInput').value
        },
        qrOptions: {
          errorCorrectionLevel: document.getElementById('qualityInput').value
        }
      }

      // 使用當前短網址
      const shortUrl = `${window.location.origin}/s/${currentUrlData.short_code}`

      const response = await fetch('/api/urls/qrcode/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: shortUrl, customOptions })
      })

      if (!response.ok) throw new Error('Preview failed')

      const data = await response.json()
      preview.src = data.qr_code
      preview.classList.remove('hidden')
      loading.classList.add('hidden')
    } catch (error) {
      console.error('Error updating preview:', error)
      loading.classList.add('hidden')
    }
  }, 500)
}

// 套用客製化設定
async function applyCustomQRCode() {
  const applyBtn = document.getElementById('applyCustomBtn')
  applyBtn.disabled = true
  applyBtn.textContent = '生成中...'

  try {
    const bgColorHex = document.getElementById('bgColorInput').value
    const bgOpacity = parseInt(document.getElementById('bgOpacityInput').value)
    const bgColor = hexToRgba(bgColorHex, bgOpacity)

    const customOptions = {
      width: parseInt(document.getElementById('sizeInput').value),
      height: parseInt(document.getElementById('sizeInput').value),
      dotsOptions: {
        color: document.getElementById('dotsColorInput').value,
        type: document.getElementById('dotsTypeInput').value
      },
      backgroundOptions: {
        color: bgColor
      },
      cornersSquareOptions: {
        color: document.getElementById('dotsColorInput').value,
        type: document.getElementById('cornersSquareTypeInput').value
      },
      cornersDotOptions: {
        color: document.getElementById('dotsColorInput').value,
        type: document.getElementById('cornersDotTypeInput').value
      },
      qrOptions: {
        errorCorrectionLevel: document.getElementById('qualityInput').value
      }
    }

    const themeId = document.getElementById('customThemeSelect').value

    const response = await fetch(`/api/urls/${currentUrlData.id}/qrcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId, customOptions })
    })

    if (!response.ok) throw new Error('Failed to generate QR code')

    const data = await response.json()

    // 更新 currentUrlData
    currentUrlData.qr_code_generated = true
    currentUrlData.qr_code_path = data.qr_code_path

    // 更新主畫面的 QR Code
    qrCodeImage.src = window.location.origin + data.qr_code_path + '?t=' + Date.now()
    noQrCode.classList.add('hidden')
    qrCodeContainer.classList.remove('hidden')

    closeCustomizeModal()
    utils.showNotification('QR Code 生成成功！', 'success')
  } catch (error) {
    console.error('Error applying custom QR code:', error)
    utils.showNotification('生成失敗', 'error')
  } finally {
    applyBtn.disabled = false
    applyBtn.textContent = '套用並生成'
  }
}

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
    const hexToRgba = (hex, opacity) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
    }

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

    // Convert hex color and opacity to RGBA
    const hexToRgba = (hex, opacity) => {
      if (!hex || !hex.startsWith('#')) return 'rgba(255, 255, 255, 1)'
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      const alpha = Math.max(0, Math.min(1, opacity / 100))
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }

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

    // Convert hex color and opacity to RGBA
    const hexToRgba = (hex, opacity) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
    }

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

// 修改下載按鈕功能為客戶端下載
downloadQrBtn.addEventListener('click', () => {
  if (currentQRCode && currentUrlData) {
    const filename = `qrcode_${currentUrlData.short_code}`
    currentQRCode.download({ name: filename, extension: "png" })
    utils.showNotification('QR Code 已下載！', 'success')
  } else {
    utils.showNotification('請先生成 QR Code', 'error')
  }
})

// 初始載入函數 - 由頁面在 auth 初始化後調用
function initEdit() {
  loadUrlData()
}

// 導出給頁面使用
window.initEdit = initEdit
