/**
 * Admin Dashboard Frontend Logic
 */

const adminState = {
  currentTab: 'overview',
  urls: { page: 1, limit: 20, search: '', total: 0 },
  loaded: { overview: false, urls: false, users: false, feedbacks: false, 'api-keys': false },
  // API 金鑰列表（GET /api/admin/api-keys，不含完整金鑰）與編輯中的金鑰 id。
  // 完整金鑰只交給 showNewApiKeyOnce 的對話框，不放進這裡。
  apiKeys: [],
  apiKeyEditingId: null,
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
  // innerHTML 只會跳脫 & < >；結果會放進 href="" / title="" 等屬性，引號也要跳脫
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
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

// 寫入請求。失敗時丟出的 Error 帶 status；400／404 的 error 欄位（給管理者看的中文訊息）放在 userMessage
async function adminSend(method, path, body) {
  const token = await auth.getAccessToken()
  const res = await fetch(path, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = new Error(`API error: ${res.status}`)
    err.status = res.status
    if (res.status === 400 || res.status === 404) {
      const data = await res.json().catch(() => null)
      if (typeof data?.error === 'string') err.userMessage = data.error
    }
    throw err
  }
  return res.json()
}

async function adminPut(path, body) {
  return adminSend('PUT', path, body)
}

async function adminPost(path, body) {
  return adminSend('POST', path, body)
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
    case 'api-keys': loadApiKeys(); break
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
            ${utils.isHttpUrl(url.original_url)
              ? `<a href="${escapeHtml(url.original_url)}" target="_blank" rel="noopener" class="text-white/80 text-sm hover:text-white" title="${escapeHtml(url.original_url)}">${displayUrl}</a>`
              : `<span class="text-white/80 text-sm" title="${escapeHtml(url.original_url)}">${displayUrl}</span>`}
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
// API Keys（服務 API 金鑰，spec §6.6）
// ============================================================

const API_KEY_STATUS_LABELS = {
  active: { text: '有效', cls: 'bg-green-500/20 text-green-400' },
  revoked: { text: '已撤銷', cls: 'bg-red-500/20 text-red-400' },
  expired: { text: '已過期', cls: 'bg-white/10 text-white/40' },
}

const API_KEY_OWNER_STATUS_LABELS = {
  active: { text: '正常', cls: 'bg-green-500/20 text-green-400' },
  banned: { text: '已停權', cls: 'bg-yellow-500/20 text-yellow-400' },
  deleted: { text: '已刪除', cls: 'bg-red-500/20 text-red-400' },
}

const API_KEY_SCOPE_LABELS = { read: '讀取', write: '寫入' }

const API_KEYS_COLSPAN = 10

function apiKeysMessageRow(text, cls = 'text-white/40') {
  return `<tr><td colspan="${API_KEYS_COLSPAN}" class="text-center p-8 ${cls}">${text}</td></tr>`
}

function apiKeyBadge(labels, value) {
  const label = labels[value] || { text: value ?? '-', cls: 'bg-white/10 text-white/60' }
  return `<span class="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${label.cls}">${escapeHtml(label.text)}</span>`
}

function findApiKey(id) {
  return adminState.apiKeys.find(apiKey => apiKey.id === id)
}

// 到期選項（<select> 的值）→ API 的 expires_in_days；'never' = 不過期
function parseExpiryOption(value) {
  return value === 'never' ? null : Number(value)
}

async function loadApiKeys() {
  const tbody = document.getElementById('apiKeysTableBody')
  tbody.innerHTML = apiKeysMessageRow('載入中...')

  try {
    adminState.apiKeys = await adminFetch(`/api/admin/api-keys?_=${Date.now()}`)
    renderApiKeys()
    adminState.loaded['api-keys'] = true
  } catch (e) {
    console.error('Failed to load API keys:', e)
    tbody.innerHTML = apiKeysMessageRow('載入失敗', 'text-red-400')
  }
}

function apiKeyRowHtml(apiKey) {
  const id = escapeHtml(apiKey.id)
  const owner = apiKey.owner_email
    ? `<div class="text-white/80 text-sm">${escapeHtml(apiKey.owner_email)}</div>`
    : '<div class="text-white/30 text-sm">-</div>'
  const lastSignIn = apiKey.owner_last_sign_in_at
    ? `<span class="text-white/40 text-xs whitespace-nowrap">最後登入 ${formatDateTime(apiKey.owner_last_sign_in_at)}</span>`
    : ''
  // 負責同仁被刪除或停權時金鑰無法使用（spec §6.2.1），提醒管理者轉移
  const transferHint = apiKey.owner_status === 'active'
    ? ''
    : '<div class="text-yellow-400 text-xs mt-1">請轉移給其他同仁</div>'
  const scopes = (Array.isArray(apiKey.scopes) ? apiKey.scopes : [])
    .map(scope => `<span class="px-2 py-0.5 rounded bg-white/10 text-white/80 text-xs whitespace-nowrap">${escapeHtml(API_KEY_SCOPE_LABELS[scope] || scope)}</span>`)
    .join('')
  const buttonCls = 'px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors'
  const revokeButton = apiKey.status === 'revoked'
    ? ''
    : `<button type="button" data-action="revoke" data-id="${id}" class="${buttonCls} text-red-400 bg-red-500/10 hover:bg-red-500/20">撤銷</button>`

  return `
    <tr class="border-b border-white/5 hover:bg-white/5 align-top">
      <td class="p-3">
        <div class="text-white text-sm font-medium">${escapeHtml(apiKey.name)}</div>
        <div class="text-white/40 text-xs font-mono">${escapeHtml(apiKey.key_prefix)}…</div>
      </td>
      <td class="p-3">
        ${owner}
        <div class="flex items-center gap-2 mt-1">${apiKeyBadge(API_KEY_OWNER_STATUS_LABELS, apiKey.owner_status)}${lastSignIn}</div>
        ${transferHint}
      </td>
      <td class="p-3"><div class="flex gap-1">${scopes}</div></td>
      <td class="p-3 text-white/60 text-sm">${apiKey.created_by_email ? escapeHtml(apiKey.created_by_email) : '-'}</td>
      <td class="p-3 text-white/40 text-sm whitespace-nowrap">${formatDate(apiKey.created_at)}</td>
      <td class="p-3 text-white/60 text-sm whitespace-nowrap">${apiKey.expires_at ? formatDate(apiKey.expires_at) : '不過期'}</td>
      <td class="p-3 text-white/40 text-sm whitespace-nowrap">${apiKey.last_used_at ? formatDateTime(apiKey.last_used_at) : '從未使用'}</td>
      <td class="p-3">${apiKeyBadge(API_KEY_STATUS_LABELS, apiKey.status)}</td>
      <td class="p-3 text-white font-medium text-sm">${(Number(apiKey.url_count) || 0).toLocaleString()}</td>
      <td class="p-3">
        <div class="flex gap-2">
          <button type="button" data-action="edit" data-id="${id}" class="${buttonCls} text-white bg-white/10 hover:bg-white/20">編輯</button>
          ${revokeButton}
        </div>
      </td>
    </tr>
  `
}

function renderApiKeys() {
  const apiKeys = adminState.apiKeys
  const tbody = document.getElementById('apiKeysTableBody')
  document.getElementById('apiKeyTotal').textContent = `共 ${apiKeys.length} 把`

  tbody.innerHTML = apiKeys.length === 0
    ? apiKeysMessageRow('尚未發放任何金鑰')
    : apiKeys.map(apiKeyRowHtml).join('')
}

async function submitCreateApiKey() {
  const name = document.getElementById('apiKeyName').value.trim()
  const ownerEmail = document.getElementById('apiKeyOwnerEmail').value.trim()
  const scopes = []
  if (document.getElementById('apiKeyScopeRead').checked) scopes.push('read')
  if (document.getElementById('apiKeyScopeWrite').checked) scopes.push('write')

  if (!name) return utils.showNotification('請輸入服務名稱', 'error')
  if (!ownerEmail) return utils.showNotification('請輸入負責同仁的 email', 'error')
  if (scopes.length === 0) return utils.showNotification('權限至少選一項', 'error')

  const button = document.getElementById('apiKeyCreateBtn')
  button.disabled = true
  try {
    // 回應裡的完整金鑰只交給對話框：不存進 adminState、不記錄
    const { key } = await adminPost('/api/admin/api-keys', {
      name,
      owner_email: ownerEmail,
      scopes,
      expires_in_days: parseExpiryOption(document.getElementById('apiKeyExpiry').value),
    })
    document.getElementById('apiKeyCreateForm').reset()
    showNewApiKeyOnce(key)
  } catch (e) {
    console.error('Failed to create API key:', e)
    utils.showNotification(e.userMessage || '發放失敗，請稍後再試', 'error')
    return
  } finally {
    button.disabled = false
  }

  await loadApiKeys()
}

function createEl(tag, className, text) {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

/**
 * 發放成功後顯示完整金鑰（唯一一次）。金鑰只以 textContent 放進這個對話框，
 * 不寫進 adminState、瀏覽器儲存或 console；關閉時整個對話框從 DOM 移除。
 * 不提供點背景或 Esc 關閉，避免誤關後金鑰再也看不到。
 */
function showNewApiKeyOnce(key) {
  const overlay = createEl('div', 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', '金鑰已發放')

  const panel = createEl('div', 'relative bg-[#1e1e1e] rounded-xl p-6 max-w-lg w-full flex flex-col gap-4')
  const title = createEl('h3', 'text-white text-xl font-bold', '金鑰已發放')
  const warning = createEl('p', 'text-yellow-400 text-sm font-medium', '關閉後就無法再看到，請立即交給對方')
  const keyBox = createEl('code', 'block w-full break-all select-all rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-sm text-white', key)

  const copyButton = createEl('button', 'flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white rounded-lg py-3 font-medium transition-colors')
  copyButton.type = 'button'
  copyButton.append(createEl('span', 'material-symbols-outlined', 'content_copy'), '複製金鑰')
  copyButton.addEventListener('click', async () => {
    const copied = await utils.copyToClipboard(key)
    if (copied) utils.showNotification('已複製金鑰', 'success')
    else utils.showNotification('複製失敗，請手動選取金鑰複製', 'error')
  })

  const closeButton = createEl('button', 'flex-1 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-lg py-3 font-medium transition-colors', '關閉')
  closeButton.type = 'button'
  closeButton.addEventListener('click', () => overlay.remove())

  const actions = createEl('div', 'flex gap-2')
  actions.append(copyButton, closeButton)
  panel.append(title, warning, keyBox, actions)
  overlay.append(panel)
  document.body.append(overlay)
  copyButton.focus()
}

async function revokeApiKey(id) {
  const apiKey = findApiKey(id)
  if (!apiKey) return
  if (!confirm(`確定要撤銷「${apiKey.name}」（${apiKey.key_prefix}…）嗎？\n\n撤銷後立即失效，使用這把金鑰的服務將無法再呼叫 API。此操作無法復原！`)) return

  try {
    await adminPost(`/api/admin/api-keys/${encodeURIComponent(id)}/revoke`, {})
    utils.showNotification('金鑰已撤銷', 'success')
  } catch (e) {
    console.error('Failed to revoke API key:', e)
    utils.showNotification(e.userMessage || '撤銷失敗，請稍後再試', 'error')
    return
  }

  await loadApiKeys()
}

// 開啟編輯對話框：改名稱、到期日，或轉移負責同仁
function editApiKey(id) {
  const apiKey = findApiKey(id)
  if (!apiKey) return

  adminState.apiKeyEditingId = id
  document.getElementById('apiKeyEditPrefix').textContent = `${apiKey.key_prefix}…`
  document.getElementById('apiKeyEditName').value = apiKey.name || ''
  document.getElementById('apiKeyEditOwnerEmail').value = apiKey.owner_email || ''
  document.getElementById('apiKeyEditExpiryKeep').textContent =
    `不變更（目前：${apiKey.expires_at ? formatDate(apiKey.expires_at) : '不過期'}）`
  document.getElementById('apiKeyEditExpiry').value = 'keep'
  document.getElementById('apiKeyEditModal').classList.remove('hidden')
  document.getElementById('apiKeyEditName').focus()
}

function closeApiKeyEditModal() {
  adminState.apiKeyEditingId = null
  document.getElementById('apiKeyEditModal').classList.add('hidden')
}

// 只送有變更的欄位；負責同仁換人（email 不分大小寫比較）先確認再轉移
async function submitEditApiKey() {
  const id = adminState.apiKeyEditingId
  const apiKey = findApiKey(id)
  if (!apiKey) return closeApiKeyEditModal()

  const name = document.getElementById('apiKeyEditName').value.trim()
  const ownerEmail = document.getElementById('apiKeyEditOwnerEmail').value.trim()
  const expiry = document.getElementById('apiKeyEditExpiry').value
  if (!name) return utils.showNotification('請輸入服務名稱', 'error')

  const body = {}
  if (name !== apiKey.name) body.name = name
  if (expiry !== 'keep') body.expires_in_days = parseExpiryOption(expiry)
  if (ownerEmail && ownerEmail.toLowerCase() !== (apiKey.owner_email || '').toLowerCase()) {
    if (!confirm(`確定要把「${apiKey.name}」轉給 ${ownerEmail} 嗎？\n\n這把金鑰建立的短網址會一起移到新負責同仁名下，原負責同仁將看不到它們。`)) return
    body.owner_email = ownerEmail
  }
  if (Object.keys(body).length === 0) return closeApiKeyEditModal()

  const button = document.getElementById('apiKeyEditSave')
  button.disabled = true
  try {
    await adminPut(`/api/admin/api-keys/${encodeURIComponent(id)}`, body)
  } catch (e) {
    console.error('Failed to update API key:', e)
    utils.showNotification(e.userMessage || '更新失敗，請稍後再試', 'error')
    return
  } finally {
    button.disabled = false
  }

  closeApiKeyEditModal()
  utils.showNotification(body.owner_email ? '金鑰已轉移' : '金鑰已更新', 'success')
  await loadApiKeys()
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

    // API keys：發放表單、列表的編輯／撤銷按鈕（事件委派）、編輯對話框
    document.getElementById('apiKeyCreateForm').addEventListener('submit', (e) => {
      e.preventDefault()
      submitCreateApiKey()
    })
    document.getElementById('apiKeysTableBody').addEventListener('click', (e) => {
      const button = e.target.closest('button[data-action]')
      if (!button) return
      if (button.dataset.action === 'edit') editApiKey(button.dataset.id)
      else if (button.dataset.action === 'revoke') revokeApiKey(button.dataset.id)
    })
    document.getElementById('apiKeyEditForm').addEventListener('submit', (e) => {
      e.preventDefault()
      submitEditApiKey()
    })
    document.getElementById('apiKeyEditCancel').addEventListener('click', closeApiKeyEditModal)

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
