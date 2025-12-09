// DOM 元素
const originalUrlInput = document.getElementById('originalUrl')
const shortenBtn = document.getElementById('shortenBtn')
const resultCard = document.getElementById('resultCard')
const shortUrlInput = document.getElementById('shortUrl')
const copyBtn = document.getElementById('copyBtn')
const copyAdBtn = document.getElementById('copyAdBtn')
const shareBtn = document.getElementById('shareBtn')
const viewLinksBtn = document.getElementById('viewLinksBtn')
const advancedBtn = document.getElementById('advancedBtn')
const loadingIndicator = document.getElementById('loadingIndicator')

// QR Code 相關元素
const qrCodeDisplay = document.getElementById('qrCodeDisplay')
const qrCodeContainer = document.getElementById('qrCodeContainer')
const downloadQrBtn = document.getElementById('downloadQrBtn')

// 當前的短網址數據和 QR Code 實例
let currentUrlData = null
let currentQRCode = null

// 客戶端生成 QR Code 的配置
const QR_CONFIG = {
  width: 400,
  height: 400,
  type: "svg",
  image: "/images/tzuchi-logo.svg", // 使用本地 SVG，避免 CORS 問題
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

// 縮短網址
async function shortenUrl() {
  const originalUrl = originalUrlInput.value.trim()

  if (!originalUrl) {
    utils.showNotification('請輸入網址', 'error')
    return
  }

  // 簡單的 URL 驗證
  try {
    new URL(originalUrl)
  } catch (e) {
    utils.showNotification('請輸入有效的網址 (例如: https://example.com)', 'error')
    return
  }

  // 顯示載入中
  loadingIndicator.classList.remove('hidden')
  resultCard.classList.add('hidden')
  qrCodeDisplay.classList.add('hidden')
  shortenBtn.disabled = true

  try {
    // 呼叫 API 建立短網址
    const data = await api.createUrl(originalUrl)
    currentUrlData = data

    // 使用後端返回的完整短網址
    shortUrlInput.value = data.short_url

    // 顯示結果卡片
    resultCard.classList.remove('hidden')
    loadingIndicator.classList.add('hidden')

    utils.showNotification('短網址建立成功！', 'success')

    // 自動生成 QR Code（客戶端）
    generateClientQRCode(data.short_url)
  } catch (error) {
    console.error('Error creating short URL:', error)

    // 處理未登入錯誤
    if (error.message === '請先登入') {
      utils.showNotification('請先登入才能建立短網址', 'error')
      // 延遲跳轉，讓使用者看到訊息
      setTimeout(() => {
        sessionStorage.setItem('redirectAfterLogin', '/')
        window.location.href = '/login.html'
      }, 1500)
    } else {
      utils.showNotification(`建立失敗: ${error.message}`, 'error')
    }

    loadingIndicator.classList.add('hidden')
  } finally {
    shortenBtn.disabled = false
  }
}

// 客戶端生成 QR Code
function generateClientQRCode(url) {
  try {
    // 清空容器
    qrCodeContainer.innerHTML = ''

    // 創建 QR Code 實例
    currentQRCode = new QRCodeStyling({
      ...QR_CONFIG,
      data: url
    })

    // 將 QR Code 添加到容器
    currentQRCode.append(qrCodeContainer)

    // 顯示 QR Code 區域
    qrCodeDisplay.classList.remove('hidden')

    console.log('✅ QR Code generated with Tzu Chi logo')
  } catch (error) {
    console.error('Error generating QR code:', error)
    utils.showNotification('QR Code 生成失敗', 'error')
  }
}

// 前往進階功能頁面
function goToAdvanced() {
  if (!currentUrlData) {
    utils.showNotification('請先建立短網址', 'error')
    return
  }
  window.location.href = `/edit/${currentUrlData.id}`
}

// 進階客製化功能已移至 edit.html 頁面

// 複製短網址
async function copyShortUrl() {
  const success = await utils.copyToClipboard(shortUrlInput.value)
  if (success) {
    utils.showNotification('已複製到剪貼簿！', 'success')
    copyBtn.innerHTML = `
      <span class="material-symbols-outlined text-lg">check</span>
      <span class="truncate">已複製</span>
    `
    setTimeout(() => {
      copyBtn.innerHTML = `
        <span class="material-symbols-outlined text-lg">content_copy</span>
        <span class="truncate">複製</span>
      `
    }, 2000)
  } else {
    utils.showNotification('複製失敗', 'error')
  }
}

// 複製廣告頁連結
async function copyAdUrl() {
  if (!currentUrlData?.short_code) {
    utils.showNotification('短代碼尚未載入', 'error')
    return
  }
  const adUrl = `${window.location.origin}/ad/${currentUrlData.short_code}`
  const success = await utils.copyToClipboard(adUrl)
  if (success) {
    utils.showNotification('已複製廣告頁連結！', 'success')
    const icon = copyAdBtn.querySelector('.material-symbols-outlined')
    icon.textContent = 'check'
    setTimeout(() => {
      icon.textContent = 'ads_click'
    }, 2000)
  } else {
    utils.showNotification('複製失敗', 'error')
  }
}

// 分享短網址
async function shareShortUrl() {
  const url = shortUrlInput.value

  // 檢查瀏覽器是否支援 Web Share API
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'TCurl 短網址',
        text: '查看這個連結',
        url: url
      })
      utils.showNotification('分享成功！', 'success')
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error sharing:', error)
      }
    }
  } else {
    // 如果不支援，直接複製連結
    await copyShortUrl()
  }
}

// 下載 QR Code
function downloadQRCode() {
  if (currentQRCode && currentUrlData) {
    const filename = `qrcode_${currentUrlData.short_code}`
    currentQRCode.download({ name: filename, extension: "png" })
    utils.showNotification('QR Code 已下載！', 'success')
  } else {
    utils.showNotification('請先生成 QR Code', 'error')
  }
}

// 查看所有連結
function viewAllLinks() {
  window.location.href = '/links'
}

// 事件監聽器
shortenBtn.addEventListener('click', shortenUrl)
copyBtn.addEventListener('click', copyShortUrl)
copyAdBtn.addEventListener('click', copyAdUrl)
shareBtn.addEventListener('click', shareShortUrl)
viewLinksBtn.addEventListener('click', viewAllLinks)
advancedBtn.addEventListener('click', goToAdvanced)
downloadQrBtn.addEventListener('click', downloadQRCode)

// Enter 鍵提交
originalUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    shortenUrl()
  }
})
