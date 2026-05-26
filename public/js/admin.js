/**
 * Admin Dashboard Frontend Logic
 */

const adminState = {
  currentTab: 'overview',
  urls: { page: 1, limit: 20, search: '', total: 0 },
  loaded: { overview: false, urls: false, users: false, feedbacks: false },
}

const STATUS_LABELS = {
  open: { text: '待處理', cls: 'bg-blue-500/20 text-blue-400' },
  in_progress: { text: '進行中', cls: 'bg-yellow-500/20 text-yellow-400' },
  resolved: { text: '已解決', cls: 'bg-green-500/20 text-green-400' },
  closed: { text: '已關閉', cls: 'bg-white/10 text-white/40' },
}

const CATEGORY_LABELS = {
  bug: '錯誤回報',
  suggestion: '功能建議',
  improvement: '改善建議',
  other: '其他',
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function adminFetch(path) {
  const token = await auth.getAccessToken()
  const res = await fetch(path, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

async function adminPut(path, body) {
  const token = await auth.getAccessToken()
  const res = await fetch(path, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// ============================================================
// Tab Switching
// ============================================================

function switchTab(tab) {
  adminState.currentTab = tab

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tab
    btn.classList.toggle('bg-white/10', isActive)
    btn.classList.toggle('text-white', isActive)
    btn.classList.toggle('text-white/60', !isActive)
    btn.classList.toggle('hover:text-white', !isActive)
    btn.classList.toggle('hover:bg-white/5', !isActive)
  })

  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('hidden', el.id !== `tab-${tab}`)
  })

  if (!adminState.loaded[tab]) loadTabData(tab)
}

function loadTabData(tab) {
  switch (tab) {
    case 'overview': loadStats(); break
    case 'urls': loadUrls(); break
    case 'users': loadUsers(); break
    case 'feedbacks': loadFeedbacks(); break
  }
}

// ============================================================
// Overview
// ============================================================

async function loadStats() {
  try {
    const stats = await adminFetch('/api/admin/stats')
    document.getElementById('statTotalUrls').textContent = stats.total_urls.toLocaleString()
    document.getElementById('statActiveUrls').textContent = stats.active_urls.toLocaleString()
    document.getElementById('statTotalClicks').textContent = stats.total_clicks.toLocaleString()
    document.getElementById('statTodayClicks').textContent = stats.today_clicks.toLocaleString()
    document.getElementById('statTotalUsers').textContent = stats.total_users.toLocaleString()
    adminState.loaded.overview = true
  } catch (e) {
    console.error('Failed to load stats:', e)
  }
}

// ============================================================
// URLs
// ============================================================

async function loadUrls() {
  const { page, limit, search } = adminState.urls
  const tbody = document.getElementById('urlsTableBody')
  tbody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-white/40">載入中...</td></tr>'

  try {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search) params.set('search', search)

    const result = await adminFetch(`/api/admin/urls?${params}`)
    adminState.urls.total = result.total
    document.getElementById('urlTotal').textContent = `共 ${result.total} 筆`

    if (!result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-white/40">無資料</td></tr>'
      renderUrlsPagination()
      return
    }

    tbody.innerHTML = result.data.map(url => {
      const displayUrl = url.original_url.length > 60
        ? escapeHtml(url.original_url.substring(0, 60)) + '...'
        : escapeHtml(url.original_url)
      const creator = url.creator
        ? escapeHtml(url.creator.display_name)
        : '<span class="text-white/30">-</span>'
      const statusCls = url.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
      const statusText = url.is_active ? '啟用' : '停用'

      return `
        <tr class="border-b border-white/5 hover:bg-white/5">
          <td class="p-3">
            <a href="/edit/${url.id}" class="text-blue-400 hover:text-blue-300 hover:underline font-medium text-sm">${escapeHtml(url.short_code)}</a>
          </td>
          <td class="p-3">
            <a href="${escapeHtml(url.original_url)}" target="_blank" rel="noopener" class="text-white/80 text-sm hover:text-white" title="${escapeHtml(url.original_url)}">${displayUrl}</a>
          </td>
          <td class="p-3 text-white/60 text-sm">${creator}</td>
          <td class="p-3 text-white font-medium text-sm">${(url.click_count || 0).toLocaleString()}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded-full text-xs font-medium ${statusCls}">${statusText}</span></td>
          <td class="p-3 text-white/40 text-sm">${formatDate(url.created_at)}</td>
        </tr>
      `
    }).join('')

    renderUrlsPagination()
    adminState.loaded.urls = true
  } catch (e) {
    console.error('Failed to load URLs:', e)
    tbody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-red-400">載入失敗</td></tr>'
  }
}

function renderUrlsPagination() {
  const { page, limit, total } = adminState.urls
  const totalPages = Math.ceil(total / limit) || 1
  const container = document.getElementById('urlsPagination')

  container.innerHTML = `
    <span class="text-white/40">第 ${page} / ${totalPages} 頁</span>
    <div class="flex gap-2">
      <button onclick="goUrlPage(${page - 1})" class="px-3 py-1.5 rounded-lg text-sm font-medium ${page <= 1 ? 'text-white/20 cursor-not-allowed' : 'text-white bg-white/10 hover:bg-white/20'}" ${page <= 1 ? 'disabled' : ''}>上一頁</button>
      <button onclick="goUrlPage(${page + 1})" class="px-3 py-1.5 rounded-lg text-sm font-medium ${page >= totalPages ? 'text-white/20 cursor-not-allowed' : 'text-white bg-white/10 hover:bg-white/20'}" ${page >= totalPages ? 'disabled' : ''}>下一頁</button>
    </div>
  `
}

function goUrlPage(p) {
  if (p < 1) return
  adminState.urls.page = p
  loadUrls()
}

// ============================================================
// Users
// ============================================================

async function loadUsers() {
  const tbody = document.getElementById('usersTableBody')
  tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-white/40">載入中...</td></tr>'

  try {
    const users = await adminFetch('/api/admin/users')

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-white/40">無使用者</td></tr>'
      return
    }

    tbody.innerHTML = users.map(user => `
      <tr class="border-b border-white/5 hover:bg-white/5">
        <td class="p-3 text-white text-sm font-medium">${escapeHtml(user.display_name)}</td>
        <td class="p-3 text-white/60 text-sm">${escapeHtml(user.email || '')}</td>
        <td class="p-3 text-white font-medium text-sm">${user.url_count}</td>
        <td class="p-3 text-white/40 text-sm">${formatDateTime(user.last_sign_in_at)}</td>
        <td class="p-3 text-white/40 text-sm">${formatDate(user.created_at)}</td>
      </tr>
    `).join('')

    adminState.loaded.users = true
  } catch (e) {
    console.error('Failed to load users:', e)
    tbody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-red-400">載入失敗</td></tr>'
  }
}

// ============================================================
// Feedbacks
// ============================================================

async function loadFeedbacks() {
  const tbody = document.getElementById('feedbacksTableBody')
  tbody.innerHTML = '<tr><td colspan="7" class="text-center p-8 text-white/40">載入中...</td></tr>'

  try {
    const feedbacks = await adminFetch('/api/admin/feedbacks')

    if (!feedbacks || feedbacks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center p-8 text-white/40">無回饋</td></tr>'
      return
    }

    tbody.innerHTML = feedbacks.map(fb => {
      const status = STATUS_LABELS[fb.status] || STATUS_LABELS.open
      const category = CATEGORY_LABELS[fb.category] || fb.category || '-'
      const author = fb.author ? escapeHtml(fb.author.display_name) : '-'

      return `
        <tr class="border-b border-white/5 hover:bg-white/5">
          <td class="p-3">
            <a href="/feedback/${fb.id}" class="text-blue-400 hover:text-blue-300 hover:underline text-sm font-medium">${escapeHtml(fb.title)}</a>
          </td>
          <td class="p-3 text-white/60 text-sm">${escapeHtml(category)}</td>
          <td class="p-3 text-white/60 text-sm">${author}</td>
          <td class="p-3">
            <select onchange="updateFeedbackStatus('${fb.id}', this.value)" class="bg-transparent border border-white/10 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary">
              ${Object.entries(STATUS_LABELS).map(([key, val]) =>
                `<option value="${key}" ${fb.status === key ? 'selected' : ''} class="bg-[#1e1e2e]">${val.text}</option>`
              ).join('')}
            </select>
          </td>
          <td class="p-3 text-white/60 text-sm">${fb.vote_count || 0}</td>
          <td class="p-3 text-white/60 text-sm">${fb.comment_count || 0}</td>
          <td class="p-3 text-white/40 text-sm">${formatDate(fb.created_at)}</td>
        </tr>
      `
    }).join('')

    adminState.loaded.feedbacks = true
  } catch (e) {
    console.error('Failed to load feedbacks:', e)
    tbody.innerHTML = '<tr><td colspan="7" class="text-center p-8 text-red-400">載入失敗</td></tr>'
  }
}

async function updateFeedbackStatus(id, status) {
  try {
    await adminPut(`/api/admin/feedbacks/${id}/status`, { status })
    utils.showNotification('狀態已更新', 'success')
  } catch (e) {
    console.error('Failed to update status:', e)
    utils.showNotification('更新失敗', 'error')
    loadFeedbacks()
  }
}

// ============================================================
// Init
// ============================================================

let searchTimer = null

async function initAdmin() {
  try {
    const { is_admin } = await adminFetch('/api/admin/check')

    if (!is_admin) {
      document.getElementById('accessDenied').classList.remove('hidden')
      return
    }

    document.getElementById('adminContent').classList.remove('hidden')

    // Tab click handlers
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    })

    // URL search with debounce
    document.getElementById('urlSearch').addEventListener('input', (e) => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => {
        adminState.urls.search = e.target.value.trim()
        adminState.urls.page = 1
        loadUrls()
      }, 400)
    })

    // Load overview
    loadStats()
  } catch (e) {
    console.error('Admin init failed:', e)
    document.getElementById('accessDenied').classList.remove('hidden')
  }
}

window.initAdmin = initAdmin
window.goUrlPage = goUrlPage
window.updateFeedbackStatus = updateFeedbackStatus
