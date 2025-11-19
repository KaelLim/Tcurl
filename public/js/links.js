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

// 載入 URL（支援分頁）
async function loadUrls(page = 1) {
  try {
    loadingRow.classList.remove('hidden')
    emptyRow.classList.add('hidden')

    // 並行載入分頁資料和統計數據（強制不使用快取）
    const timestamp = Date.now()
    const [urlsResponse, statsResponse] = await Promise.all([
      fetch(`/api/urls?page=${page}&limit=${pagination.limit}&_=${timestamp}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }),
      fetch(`/api/urls/stats/summary?_=${timestamp}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
    ])

    const result = await urlsResponse.json()
    const stats = await statsResponse.json()

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
    utils.showNotification('載入失敗', 'error')
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
      <td colspan="4" class="p-8 text-center text-[#9da1b9]">
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
        <button class="text-white/40 hover:text-white" onclick="event.stopPropagation(); copyShortUrl('${shortUrl}')" title="複製短網址">
          <span class="material-symbols-outlined text-sm">content_copy</span>
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

// 查看或生成 QR Code
async function viewQRCode(shortCode, urlData) {
  try {
    // 檢查是否已有 QR Code
    if (urlData.qr_code_generated && urlData.qr_code_path) {
      // 已有 QR Code，直接顯示
      showQRCodeModal(shortCode, urlData.qr_code_path, urlData.id)
    } else {
      // 沒有 QR Code，顯示生成選項
      showQRGenerateModal(shortCode, urlData.id)
    }
  } catch (error) {
    console.error('Error loading QR code:', error)
    utils.showNotification('載入 QR Code 失敗', 'error')
  }
}

// 顯示 QR Code 模態視窗
function showQRCodeModal(shortCode, qrCodePath, urlId) {
  const modal = document.createElement('div')
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'
  // 加上時間戳避免瀏覽器快取
  const qrCodeUrl = `${window.location.origin}${qrCodePath}?t=${Date.now()}`
  modal.innerHTML = `
    <div class="relative bg-[#1e1e1e] rounded-xl p-6 max-w-md w-full mx-4">
      <button class="absolute top-4 right-4 text-white/60 hover:text-white" onclick="this.closest('.fixed').remove()">
        <span class="material-symbols-outlined">close</span>
      </button>
      <h3 class="text-white text-xl font-bold mb-4">QR Code</h3>
      <div class="bg-white p-4 rounded-lg mb-4 flex justify-center">
        <img src="${qrCodeUrl}" alt="QR Code" class="w-64 h-64">
      </div>
      <div class="flex gap-2">
        <button onclick="utils.downloadQRCode('${qrCodeUrl}', 'qrcode_${shortCode}.png'); utils.showNotification('QR Code 已下載', 'success')" class="flex-1 bg-primary hover:bg-primary/90 text-white rounded-lg py-3 font-bold">
          下載
        </button>
        <button onclick="this.closest('.fixed').remove(); regenerateQRCodeFor('${shortCode}', '${urlId}')" class="flex-1 bg-white/10 hover:bg-white/20 text-white rounded-lg py-3 font-bold">
          重新生成
        </button>
      </div>
    </div>
  `
  document.body.appendChild(modal)

  // 點擊背景關閉
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove()
    }
  })
}

// 顯示 QR Code 生成選項模態視窗
async function showQRGenerateModal(shortCode, urlId) {
  // 載入主題
  const response = await fetch('/api/qrcode/themes')
  const data = await response.json()
  const themes = data.themes

  const modal = document.createElement('div')
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'
  modal.innerHTML = `
    <div class="relative bg-[#1e1e1e] rounded-xl p-6 max-w-md w-full mx-4">
      <button class="absolute top-4 right-4 text-white/60 hover:text-white" onclick="this.closest('.fixed').remove()">
        <span class="material-symbols-outlined">close</span>
      </button>
      <h3 class="text-white text-xl font-bold mb-4">生成 QR Code</h3>
      <p class="text-white/60 text-sm mb-4">這個短網址還沒有 QR Code，請選擇主題生成：</p>
      <select id="modalThemeSelect" class="w-full rounded-lg text-white bg-background-dark border border-white/20 h-12 px-3 text-sm mb-4">
        ${themes.map(theme => `<option value="${theme.id}">${theme.name} - ${theme.description}</option>`).join('')}
      </select>
      <button id="modalGenerateBtn" class="w-full bg-primary hover:bg-primary/90 text-white rounded-lg py-3 font-bold">
        生成 QR Code
      </button>
    </div>
  `
  document.body.appendChild(modal)

  // 點擊背景關閉
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove()
    }
  })

  // 生成按鈕事件
  document.getElementById('modalGenerateBtn').addEventListener('click', async () => {
    const themeId = document.getElementById('modalThemeSelect').value
    const btn = document.getElementById('modalGenerateBtn')
    btn.disabled = true
    btn.textContent = '生成中...'

    try {
      const response = await fetch(`/api/urls/${urlId}/qrcode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeId })
      })

      if (!response.ok) {
        throw new Error('Failed to generate QR code')
      }

      const result = await response.json()
      modal.remove()
      utils.showNotification('QR Code 生成成功！', 'success')

      // 重新載入列表以更新狀態
      await loadUrls()

      // 顯示生成的 QR Code
      showQRCodeModal(shortCode, result.qr_code_path, urlId)
    } catch (error) {
      console.error('Error generating QR code:', error)
      utils.showNotification('生成失敗', 'error')
      btn.disabled = false
      btn.textContent = '生成 QR Code'
    }
  })
}

// 重新生成 QR Code
function regenerateQRCodeFor(shortCode, urlId) {
  showQRGenerateModal(shortCode, urlId)
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

// 初始載入
loadUrls()
