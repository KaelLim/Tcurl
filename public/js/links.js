// DOM 元素
const urlTableBody = document.getElementById('urlTableBody')
const loadingRow = document.getElementById('loadingRow')
const emptyRow = document.getElementById('emptyRow')
const searchInput = document.getElementById('searchInput')
const sortSelect = document.getElementById('sortSelect')
const createNewBtn = document.getElementById('createNewBtn')
const totalLinksEl = document.getElementById('totalLinks')
const totalClicksEl = document.getElementById('totalClicks')
const activeLinksEl = document.getElementById('activeLinks')
const prevPageBtn = document.getElementById('prevPage')
const nextPageBtn = document.getElementById('nextPage')
const pageNumbers = document.getElementById('pageNumbers')
const pageStart = document.getElementById('pageStart')
const pageEnd = document.getElementById('pageEnd')
const totalCount = document.getElementById('totalCount')

// 全域數據
let allUrls = []
let pagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrev: false
}

// 載入 URL（支援分頁）- 使用 Supabase JS
async function loadUrls(page = 1) {
  try {
    loadingRow.classList.remove('hidden')
    emptyRow.classList.add('hidden')

    // 並行載入分頁資料和統計數據
    const [result, stats] = await Promise.all([
      api.getUrls(page, pagination.limit),
      api.getStatsSummary()
    ])

    allUrls = result.data || []
    pagination = result.pagination || pagination

    renderUrls()
    renderPagination()
    updateStats(stats)

    loadingRow.classList.add('hidden')

    if (allUrls.length === 0) {
      emptyRow.classList.remove('hidden')
    }
  } catch (error) {
    console.error('Error loading URLs:', error)
    utils.showNotification('載入失敗: ' + error.message, 'error')
    loadingRow.classList.add('hidden')
  }
}

// 排序 URLs
function sortUrls() {
  const sortBy = sortSelect.value

  switch (sortBy) {
    case 'created_desc':
      filteredUrls.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      break
    case 'created_asc':
      filteredUrls.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      break
    case 'clicks_desc':
      filteredUrls.sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
      break
    case 'clicks_asc':
      filteredUrls.sort((a, b) => (a.clicks || 0) - (b.clicks || 0))
      break
  }
}

// 搜尋過濾（暫時禁用，使用後端分頁）
function filterUrls() {
  // TODO: 實作後端搜尋
  console.log('Search functionality will be implemented with backend support')
}

// 渲染 URLs 表格
function renderUrls() {
  // 清除現有的資料列（保留 loading 和 empty rows）
  const dataRows = urlTableBody.querySelectorAll('tr:not(#loadingRow):not(#emptyRow)')
  dataRows.forEach(row => row.remove())

  if (allUrls.length === 0 && searchInput.value.trim()) {
    const noResultRow = document.createElement('tr')
    noResultRow.innerHTML = `
      <td colspan="5" class="p-8 text-center text-[#9da1b9]">
        找不到符合的結果
      </td>
    `
    urlTableBody.appendChild(noResultRow)
    return
  }

  // 渲染每個 URL
  allUrls.forEach(url => {
    const row = createUrlRow(url)
    urlTableBody.appendChild(row)
  })
}

// 建立單個 URL 的表格列
function createUrlRow(url) {
  const row = document.createElement('tr')
  row.className = 'hover:bg-[#1c1d27]/50 group cursor-pointer transition-colors'

  // 點擊整列進入編輯頁面
  row.onclick = () => {
    window.location.href = `/edit/${url.id}`
  }

  const shortUrl = `${window.location.origin}/s/${url.short_code}`
  const adUrl = `${window.location.origin}/ad/${url.short_code}`
  const maxUrlLength = 60
  const displayUrl = url.original_url.length > maxUrlLength
    ? url.original_url.substring(0, maxUrlLength) + '...'
    : url.original_url

  row.innerHTML = `
    <td class="p-4">
      <div class="flex items-center gap-2">
        <span class="text-primary text-sm font-medium hover:underline" onclick="event.stopPropagation(); window.open('${shortUrl}', '_blank')">
          ${url.short_code}
        </span>
        <button class="text-white/40 hover:text-white" onclick="event.stopPropagation(); copyShortUrl('${shortUrl}')" title="複製短網址 /s/">
          <span class="material-symbols-outlined text-sm">content_copy</span>
        </button>
        <button class="text-orange-400/60 hover:text-orange-400" onclick="event.stopPropagation(); copyShortUrl('${adUrl}')" title="複製廣告頁連結 /ad/">
          <span class="material-symbols-outlined text-sm">ads_click</span>
        </button>
      </div>
    </td>
    <td class="p-4">
      <span class="text-[#9da1b9] text-sm" title="${url.original_url}">
        ${displayUrl}
      </span>
    </td>
    <td class="p-4">
      <div class="flex items-center gap-2">
        <span class="text-white text-sm font-medium">${url.clicks || 0}</span>
      </div>
    </td>
    <td class="p-4 text-[#9da1b9] text-sm">
      ${utils.formatDate(url.created_at)}
    </td>
    <td class="p-4">
      <button class="text-white/60 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
              onclick="event.stopPropagation(); showQRCodeModal('${url.id}')"
              title="顯示 QR Code">
        <span class="material-symbols-outlined">qr_code_2</span>
      </button>
    </td>
  `

  return row
}

// 更新統計數據
function updateStats(stats) {
  if (!stats) return

  totalLinksEl.textContent = stats.totalLinks || 0
  totalClicksEl.textContent = (stats.totalClicks || 0).toLocaleString()
  activeLinksEl.textContent = stats.activeLinks || 0
}

// 複製短網址
async function copyShortUrl(shortUrl) {
  const success = await utils.copyToClipboard(shortUrl)
  if (success) {
    utils.showNotification('已複製到剪貼簿！', 'success')
  } else {
    utils.showNotification('複製失敗', 'error')
  }
}

// 編輯 URL（導向到編輯頁面）
function editUrl(id) {
  window.location.href = `/edit/${id}`
}

// 刪除 URL
async function deleteUrl(id, shortCode) {
  if (!confirm(`確定要刪除短網址 "${shortCode}" 嗎？此操作無法復原。`)) {
    return
  }

  try {
    await api.deleteUrl(id)
    utils.showNotification('刪除成功！', 'success')
    await loadUrls()
  } catch (error) {
    console.error('Error deleting URL:', error)
    utils.showNotification(`刪除失敗: ${error.message}`, 'error')
  }
}

// 渲染分頁控制
function renderPagination() {
  const { page, totalPages, hasNext, hasPrev, total, limit } = pagination

  // 更新統計資訊
  const start = total === 0 ? 0 : (page - 1) * limit + 1
  const end = Math.min(page * limit, total)
  pageStart.textContent = start
  pageEnd.textContent = end
  totalCount.textContent = total

  // 更新上一頁/下一頁按鈕
  prevPageBtn.disabled = !hasPrev
  nextPageBtn.disabled = !hasNext

  // 生成頁碼按鈕
  pageNumbers.innerHTML = ''

  // 計算要顯示的頁碼範圍
  let startPage = Math.max(1, page - 2)
  let endPage = Math.min(totalPages, page + 2)

  // 確保至少顯示 5 個頁碼（如果有的話）
  if (endPage - startPage < 4) {
    if (startPage === 1) {
      endPage = Math.min(5, totalPages)
    } else if (endPage === totalPages) {
      startPage = Math.max(1, totalPages - 4)
    }
  }

  // 第一頁
  if (startPage > 1) {
    pageNumbers.appendChild(createPageButton(1, page === 1))
    if (startPage > 2) {
      pageNumbers.appendChild(createEllipsis())
    }
  }

  // 頁碼按鈕
  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.appendChild(createPageButton(i, i === page))
  }

  // 最後一頁
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pageNumbers.appendChild(createEllipsis())
    }
    pageNumbers.appendChild(createPageButton(totalPages, page === totalPages))
  }
}

// 創建頁碼按鈕
function createPageButton(pageNum, isActive) {
  const button = document.createElement('button')
  button.textContent = pageNum
  button.className = `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-white'
      : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
  }`
  if (!isActive) {
    button.addEventListener('click', () => loadUrls(pageNum))
  }
  return button
}

// 創建省略號
function createEllipsis() {
  const span = document.createElement('span')
  span.textContent = '...'
  span.className = 'px-2 text-white/40'
  return span
}

// 事件監聽器
searchInput.addEventListener('input', filterUrls)
sortSelect.addEventListener('change', () => {
  sortUrls()
  renderUrls()
})
createNewBtn.addEventListener('click', () => {
  window.location.href = '/'
})
prevPageBtn.addEventListener('click', () => {
  if (pagination.hasPrev) {
    loadUrls(pagination.page - 1)
  }
})
nextPageBtn.addEventListener('click', () => {
  if (pagination.hasNext) {
    loadUrls(pagination.page + 1)
  }
})

// ======== QR Code 功能 ========

// QR Code 預設配置
const QR_DEFAULT_CONFIG = {
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
    imageSize: 0.3
  }
}

// 將 hex 顏色和透明度轉換為 rgba
function hexToRgba(hex, opacity) {
  if (!hex || !hex.startsWith('#')) return 'rgba(255, 255, 255, 1)'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`
}

// 根據 qr_code_options 建立 QRCodeStyling 配置
function buildQRConfig(shortUrl, qrCodeOptions) {
  if (!qrCodeOptions) {
    // 使用預設配置
    return { ...QR_DEFAULT_CONFIG, data: shortUrl }
  }

  const config = {
    width: 300,
    height: 300,
    type: "svg",
    data: shortUrl,
    dotsOptions: {
      color: qrCodeOptions.dotsColor || '#000000',
      type: qrCodeOptions.dotsType || 'rounded'
    },
    backgroundOptions: {
      color: hexToRgba(qrCodeOptions.bgColor || '#ffffff', qrCodeOptions.bgOpacity ?? 100)
    },
    cornersSquareOptions: {
      type: qrCodeOptions.cornersSquareType || 'square',
      color: qrCodeOptions.dotsColor || '#000000'
    },
    cornersDotOptions: {
      type: qrCodeOptions.cornersDotType || 'square',
      color: qrCodeOptions.dotsColor || '#000000'
    },
    qrOptions: {
      errorCorrectionLevel: 'H'
    }
  }

  if (qrCodeOptions.showLogo) {
    config.image = "/images/tzuchi-logo.svg"
    config.imageOptions = {
      margin: 10,
      imageSize: 0.3
    }
  }

  return config
}

// 顯示 QR Code Modal
function showQRCodeModal(urlId) {
  // 從 allUrls 中找到對應的 URL 資料
  const urlData = allUrls.find(u => u.id === urlId)
  if (!urlData) {
    utils.showNotification('找不到連結資料', 'error')
    return
  }

  const shortUrl = `${window.location.origin}/s/${urlData.short_code}`
  const qrConfig = buildQRConfig(shortUrl, urlData.qr_code_options)

  // 建立 Modal
  const modal = document.createElement('div')
  modal.id = 'qrCodeModal'
  modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4'
  modal.onclick = (e) => {
    if (e.target === modal) closeQRCodeModal()
  }

  modal.innerHTML = `
    <div class="relative bg-[#1e1e1e] rounded-xl p-6 max-w-md w-full">
      <button class="absolute top-4 right-4 text-white/60 hover:text-white" onclick="closeQRCodeModal()">
        <span class="material-symbols-outlined">close</span>
      </button>

      <h3 class="text-white text-xl font-bold mb-2">QR Code</h3>
      <p class="text-white/60 text-sm mb-4">${urlData.short_code}</p>

      <div class="bg-white p-4 rounded-lg flex items-center justify-center mb-4">
        <div id="qrCodeCanvas" style="width: 300px; height: 300px;"></div>
      </div>

      <div class="flex gap-2">
        <button id="downloadQrBtn" class="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-blue-600 text-white rounded-lg py-3 font-medium transition-colors">
          <span class="material-symbols-outlined">download</span>
          下載 PNG
        </button>
        <button onclick="window.location.href='/edit/${urlData.id}'" class="flex-1 flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white rounded-lg py-3 font-medium transition-colors">
          <span class="material-symbols-outlined">edit</span>
          客製化
        </button>
      </div>
    </div>
  `

  document.body.appendChild(modal)

  // 生成 QR Code
  const qrCodeCanvas = document.getElementById('qrCodeCanvas')
  const qrCode = new QRCodeStyling(qrConfig)
  qrCode.append(qrCodeCanvas)

  // 下載按鈕
  document.getElementById('downloadQrBtn').onclick = () => {
    qrCode.download({ name: `qrcode_${urlData.short_code}`, extension: 'png' })
    utils.showNotification('QR Code 已下載！', 'success')
  }
}

// 關閉 QR Code Modal
function closeQRCodeModal() {
  const modal = document.getElementById('qrCodeModal')
  if (modal) modal.remove()
}

// 初始載入函數 - 由頁面在 auth 初始化後調用
function initLinks() {
  loadUrls()
}

// 導出給頁面使用
window.initLinks = initLinks
window.showQRCodeModal = showQRCodeModal
window.closeQRCodeModal = closeQRCodeModal
