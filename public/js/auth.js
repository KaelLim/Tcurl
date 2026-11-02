// Supabase Auth 客戶端
// 使用與後端相同的 Supabase 實例（Supabase Cloud），登入方式為 Google OAuth

const SUPABASE_URL = 'https://fsneeigsjdryxutmdrmg.supabase.co'

// Publishable key（公開值，權限由 RLS 控管）
const SUPABASE_ANON_KEY = 'sb_publishable_XYMtpVzQz4ge2R1gD1NcaQ_VRXLTvmX'

// 動態載入 Supabase SDK
let supabaseClient = null

async function initSupabase() {
  if (supabaseClient) return supabaseClient

  // 載入 Supabase SDK (如果尚未載入)
  if (!window.supabase) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
    },
  })
  return supabaseClient
}

// OAuth 失敗時（例如被 Supabase「僅限慈濟帳號」hook 拒絕），Supabase 會帶 error_description 導回；
// 先暫存，交由登入頁顯示（各頁未登入時會被導向登入頁，網址參數會遺失）
const AUTH_ERROR_KEY = 'tcurl_auth_error'

function captureOAuthError() {
  try {
    const params = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const message = params.get('error_description') || hash.get('error_description')
    if (message) {
      sessionStorage.setItem(AUTH_ERROR_KEY, message.slice(0, 200))
    }
  } catch (e) {
    // sessionStorage 不可用時略過
  }
}

// 取出並清除暫存的登入錯誤（只用 textContent 顯示）
function takeAuthError() {
  try {
    const message = sessionStorage.getItem(AUTH_ERROR_KEY)
    sessionStorage.removeItem(AUTH_ERROR_KEY)
    return message
  } catch (e) {
    return null
  }
}

// Auth 模組
const auth = {
  // 初始化
  async init() {
    captureOAuthError()
    await initSupabase()
    return this
  },

  takeAuthError,

  // 取得 Supabase Client
  getClient() {
    return supabaseClient
  },

  // Google OAuth 登入（經 Supabase Auth，PKCE）
  async signInWithGoogle(redirectTo = '/') {
    const client = await initSupabase()
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${redirectTo}`,
        // 只是提示 Google 帳號選單優先顯示慈濟帳號；真正的限制在 Supabase 的
        // Custom Access Token hook（hook_restrict_login_domain），非 @tzuchi.org.tw 一律拿不到 token
        queryParams: { hd: 'tzuchi.org.tw' }
      }
    })

    if (error) {
      throw new Error(error.message)
    }

    return data
  },

  // 登出：只登出 Supabase，然後導回登入頁
  async signOut(redirectTo = '/login.html') {
    const client = await initSupabase()
    const { error } = await client.auth.signOut()

    if (error) {
      console.error('Supabase signOut error:', error)
    }

    window.location.href = redirectTo
  },

  // 顯示名稱：中文姓名 → full_name → name → display_name → email（@ 前段）
  // 與後端 src/utils/display-name.ts 相同順序
  getDisplayName(user) {
    const meta = user?.user_metadata || {}
    if (meta.chinese_lastname && meta.chinese_firstname) {
      return `${meta.chinese_lastname}${meta.chinese_firstname}`
    }
    return meta.full_name || meta.name || meta.display_name || user?.email?.split('@')[0] || '使用者'
  },

  // 取得當前 Session
  async getSession() {
    const client = await initSupabase()
    const { data: { session }, error } = await client.auth.getSession()

    if (error) {
      console.error('Get session error:', error)
      return null
    }

    return session
  },

  // 取得當前使用者
  async getUser() {
    const session = await this.getSession()
    return session?.user || null
  },

  // 取得 Access Token (用於 API 請求)
  async getAccessToken() {
    const session = await this.getSession()
    return session?.access_token || null
  },

  // 檢查是否已登入
  async isLoggedIn() {
    const session = await this.getSession()
    return !!session
  },

  // 解析 JWT Token（用於檢視 token 內容）
  decodeJwt(token) {
    try {
      const base64Url = token.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )
      return JSON.parse(jsonPayload)
    } catch (e) {
      console.error('Failed to decode JWT:', e)
      return null
    }
  },

  // 監聽認證狀態變化
  onAuthStateChange(callback) {
    if (!supabaseClient) {
      console.warn('Supabase client not initialized')
      return () => {}
    }

    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(
      (event, session) => {
        callback(event, session)
      }
    )

    return () => subscription.unsubscribe()
  },

}

// 頁面保護：需要登入才能訪問
async function requireAuth(redirectUrl = '/login.html') {
  await auth.init()
  const isLoggedIn = await auth.isLoggedIn()

  if (!isLoggedIn) {
    // 儲存原本要訪問的頁面
    const currentUrl = window.location.pathname + window.location.search
    sessionStorage.setItem('redirectAfterLogin', currentUrl)

    // 重定向到登入頁面
    window.location.href = redirectUrl
    return false
  }

  return true
}

// 頁面保護：已登入則重定向
async function redirectIfLoggedIn(redirectUrl = '/') {
  await auth.init()
  const isLoggedIn = await auth.isLoggedIn()

  if (isLoggedIn) {
    window.location.href = redirectUrl
    return true
  }

  return false
}

// 取得登入後的重定向 URL
function getRedirectUrl() {
  const savedUrl = sessionStorage.getItem('redirectAfterLogin')
  sessionStorage.removeItem('redirectAfterLogin')
  return savedUrl || '/'
}

// 導出
window.auth = auth
window.requireAuth = requireAuth
window.redirectIfLoggedIn = redirectIfLoggedIn
window.getRedirectUrl = getRedirectUrl
