// Supabase Auth 客戶端
// 使用與後端相同的 Supabase 實例

const SUPABASE_URL = window.location.origin.includes('localhost')
  ? 'http://localhost:8000'
  : 'https://sbeurlpj.tzuchi-org.tw'

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzUwMzQ4ODAwLCJleHAiOjE5MDgxMTUyMDB9.gAgVJVSC45QFHO7gqEirpCquw-3w1k6pqWpoOQRA-Qg'

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

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  return supabaseClient
}

// Auth 模組
const auth = {
  // 初始化
  async init() {
    await initSupabase()
    return this
  },

  // 取得 Supabase Client
  getClient() {
    return supabaseClient
  },

  // 登入
  async signIn(email, password) {
    const client = await initSupabase()
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      throw new Error(error.message)
    }

    return data
  },

  // 註冊（使用後端 API，自動確認不需要郵件驗證）
  async signUp(email, password, displayName = null) {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        display_name: displayName || email.split('@')[0]
      })
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '註冊失敗')
    }

    return data
  },

  // Google OAuth 登入
  async signInWithGoogle(redirectTo = '/') {
    const client = await initSupabase()
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${redirectTo}`
      }
    })

    if (error) {
      throw new Error(error.message)
    }

    return data
  },

  // 登出
  async signOut() {
    const client = await initSupabase()
    const { error } = await client.auth.signOut()

    if (error) {
      throw new Error(error.message)
    }

    // 清除本地儲存
    localStorage.removeItem('supabase.auth.token')
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

  // 重設密碼（發送重設郵件）
  async resetPassword(email) {
    const client = await initSupabase()
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password.html`
    })

    if (error) {
      throw new Error(error.message)
    }
  },

  // 更新密碼
  async updatePassword(newPassword) {
    const client = await initSupabase()
    const { error } = await client.auth.updateUser({
      password: newPassword
    })

    if (error) {
      throw new Error(error.message)
    }
  }
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
