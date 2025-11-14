// DOM 元素
const originalUrlInput = document.getElementById('originalUrl')
const shortenBtn = document.getElementById('shortenBtn')
const resultCard = document.getElementById('resultCard')
const shortUrlInput = document.getElementById('shortUrl')
const copyBtn = document.getElementById('copyBtn')
const shareBtn = document.getElementById('shareBtn')
const viewLinksBtn = document.getElementById('viewLinksBtn')
const advancedBtn = document.getElementById('advancedBtn')
const loadingIndicator = document.getElementById('loadingIndicator')

// QR Code 相關元素
const qrCodeDisplay = document.getElementById('qrCodeDisplay')
const qrCodeImage = document.getElementById('qrCodeImage')
const downloadQrBtn = document.getElementById('downloadQrBtn')

// 當前的短網址數據
let currentUrlData = null
let availableThemes = []

// 載入 QR Code 主題列表（用於獲取基本主題 ID）
async function loadThemes() {
  try {
    const response = await fetch('/api/qrcode/themes')
    const data = await response.json()
    availableThemes = data.themes
  } catch (error) {
    console.error('Error loading themes:', error)
    availableThemes = []
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

    // 自動生成基本黑色 QR Code
    await generateBasicQRCode()
  } catch (error) {
    console.error('Error creating short URL:', error)
    utils.showNotification(`建立失敗: ${error.message}`, 'error')
    loadingIndicator.classList.add('hidden')
  } finally {
    shortenBtn.disabled = false
  }
}

// 自動生成基本黑色 QR Code
async function generateBasicQRCode() {
  if (!currentUrlData) return

  try {
    // 使用第一個主題（基本黑色）
    const themeId = availableThemes[0]?.id || 'basic'

    const response = await fetch(`/api/urls/${currentUrlData.id}/qrcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeId })
    })

    if (!response.ok) {
      throw new Error('Failed to generate QR code')
    }

    const data = await response.json()

    // 顯示 QR Code（加上時間戳避免瀏覽器快取）
    qrCodeImage.src = window.location.origin + data.qr_code_path + '?t=' + Date.now()
    qrCodeDisplay.classList.remove('hidden')
  } catch (error) {
    console.error('Error generating QR code:', error)
    // 靜默失敗，不顯示錯誤通知
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
  if (currentUrlData && qrCodeImage.src) {
    const filename = `qrcode_${currentUrlData.short_code}.png`
    utils.downloadQRCode(qrCodeImage.src, filename)
    utils.showNotification('QR Code 已下載！', 'success')
  }
}

// 查看所有連結
function viewAllLinks() {
  window.location.href = '/links'
}

// 事件監聽器
shortenBtn.addEventListener('click', shortenUrl)
copyBtn.addEventListener('click', copyShortUrl)
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

// 初始載入主題列表
loadThemes()
