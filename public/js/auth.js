// Supabase Auth 客戶端
// 使用與後端相同的 Supabase 實例

const SUPABASE_URL = window.location.origin.includes('localhost')
  ? 'http://localhost:8000'
  : 'https://sbeurlpj.tzuchi-org.tw'

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzUwMzQ4ODAwLCJleHAiOjE5MDgxMTUyMDB9.gAgVJVSC45QFHO7gqEirpCquw-3w1k6pqWpoOQRA-Qg'

// Keycloak 設定
const KEYCLOAK_URL = 'https://auth.tzuchi.net/realms/tzuchi'
const KEYCLOAK_CLIENT_ID = 'tcurl'

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

  // Keycloak OIDC 登入（慈濟員工）
  async signInWithKeycloak(redirectTo = '/') {
    const client = await initSupabase()
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'keycloak',
      options: {
        redirectTo: `${window.location.origin}${redirectTo}`,
        scopes: 'openid profile email'  // Keycloak 22+ 必須明確傳入 openid
      }
    })

    if (error) {
      throw new Error(error.message)
    }

    return data
  },

  // 登出（同時登出 Supabase 和 Keycloak）
  async signOut(redirectTo = '/login.html') {
    const client = await initSupabase()
    const { error } = await client.auth.signOut()

    if (error) {
      console.error('Supabase signOut error:', error)
    }

    // 清除本地儲存
    localStorage.removeItem('supabase.auth.token')

    // 重導向到 Keycloak 登出頁面，登出後自動返回應用程式
    const keycloakLogoutUrl = `${KEYCLOAK_URL}/protocol/openid-connect/logout?` +
      `client_id=${KEYCLOAK_CLIENT_ID}&` +
      `post_logout_redirect_uri=${encodeURIComponent(window.location.origin + redirectTo)}`
    window.location.href = keycloakLogoutUrl
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

  // 取得完整的 Session 資訊（包含 provider token）
  async getFullSession() {
    const client = await initSupabase()
    const { data: { session }, error } = await client.auth.getSession()

    if (error || !session) {
      return null
    }

    // 解析 Supabase access token
    const supabaseTokenData = this.decodeJwt(session.access_token)

    // 解析 provider token（如果有的話，這是原始的 Keycloak token）
    const providerTokenData = session.provider_token
      ? this.decodeJwt(session.provider_token)
      : null

    return {
      session,
      supabaseTokenData,
      providerTokenData,
      // Keycloak 角色權限通常在這裡
      resourceAccess: providerTokenData?.resource_access || null,
      realmAccess: providerTokenData?.realm_access || null
    }
  },

  // 檢查使用者是否有特定角色
  async hasRole(role, clientId = 'tcurl') {
    const fullSession = await this.getFullSession()
    if (!fullSession?.resourceAccess?.[clientId]?.roles) {
      return false
    }
    return fullSession.resourceAccess[clientId].roles.includes(role)
  },

  // 取得使用者的所有角色
  async getRoles(clientId = 'tcurl') {
    const fullSession = await this.getFullSession()
    return fullSession?.resourceAccess?.[clientId]?.roles || []
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
