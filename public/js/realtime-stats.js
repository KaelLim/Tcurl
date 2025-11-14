// Realtime 統計更新模組
// 監聽 url_clicks 表的變化，即時更新統計數據

class RealtimeStats {
  constructor(supabaseUrl, supabaseKey) {
    // 初始化 Supabase 客戶端（用於 Realtime）
    this.supabaseUrl = supabaseUrl
    this.supabaseKey = supabaseKey
    this.supabase = null
    this.channel = null
    this.callbacks = {
      onInsert: [],
      onUpdate: [],
      onDelete: []
    }
  }

  // 初始化 Supabase 客戶端
  async init() {
    // 動態載入 Supabase JS SDK（如果尚未載入）
    if (typeof window.supabase === 'undefined') {
      await this.loadSupabaseSDK()
    }

    this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseKey)
    console.log('✅ Realtime Stats initialized')
  }

  // 動態載入 Supabase SDK
  async loadSupabaseSDK() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  // 訂閱 url_clicks 表的變化
  subscribeToClicks() {
    if (!this.supabase) {
      console.error('❌ Supabase client not initialized. Call init() first.')
      return
    }

    console.log('🔔 Subscribing to url_clicks changes...')

    this.channel = this.supabase
      .channel('url_clicks_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'url_clicks'
        },
        (payload) => {
          console.log('📊 New click detected:', payload)
          this._triggerCallbacks('onInsert', payload)
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to url_clicks changes')
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Channel error:', status)
        }
      })
  }

  // 取消訂閱
  unsubscribe() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel)
      console.log('🔕 Unsubscribed from url_clicks changes')
    }
  }

  // 註冊回調函數
  on(event, callback) {
    if (this.callbacks[event]) {
      this.callbacks[event].push(callback)
    } else {
      console.warn(`⚠️ Unknown event: ${event}`)
    }
  }

  // 觸發回調函數
  _triggerCallbacks(event, payload) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(callback => {
        try {
          callback(payload)
        } catch (error) {
          console.error(`❌ Error in ${event} callback:`, error)
        }
      })
    }
  }
}

// 輔助函數：從點擊事件更新 UI
function updateStatsFromClick(clickData) {
  // clickData.new 包含新插入的點擊記錄
  const { url_id, is_qr_scan } = clickData.new

  console.log(`🔄 Updating stats for URL: ${url_id}, QR: ${is_qr_scan}`)

  // 找到對應的統計元素並更新
  const statsElement = document.querySelector(`[data-url-id="${url_id}"]`)
  if (statsElement) {
    const currentClicks = parseInt(statsElement.textContent || '0')
    statsElement.textContent = currentClicks + 1

    // 添加閃爍動畫提示更新
    statsElement.classList.add('stats-updated')
    setTimeout(() => statsElement.classList.remove('stats-updated'), 1000)
  }

  // 更新總體統計
  const totalClicksElement = document.getElementById('totalClicks')
  if (totalClicksElement) {
    const currentTotal = parseInt(totalClicksElement.textContent.replace(/,/g, '') || '0')
    totalClicksElement.textContent = (currentTotal + 1).toLocaleString()
  }

  // 如果是在統計頁面，重新載入圖表
  if (typeof refreshCharts === 'function') {
    refreshCharts()
  }
}

// 導出給全局使用
window.RealtimeStats = RealtimeStats
window.updateStatsFromClick = updateStatsFromClick
