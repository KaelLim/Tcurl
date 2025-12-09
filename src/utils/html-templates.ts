// HTML 模板工具函數

/**
 * HTML 特殊字符轉義 - 防止 XSS 攻擊
 * 用於將用戶輸入安全地嵌入 HTML 內容中
 */
function escapeHtml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * JavaScript 字串轉義 - 防止 XSS 攻擊
 * 用於將用戶輸入安全地嵌入 <script> 標籤中的字串變數
 */
function escapeJs(str: string): string {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e')
}

export function renderPasswordPage(shortCode: string, isQrScan: boolean = false): string {
  const qrParam = isQrScan ? '&qr=true' : ''

  return `<!DOCTYPE html>
<html class="dark" lang="zh-TW">
<head>
    <meta charset="utf-8"/>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>密碼保護 - TCurl</title>
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#1337ec",
                        "background-dark": "#101322",
                    },
                    fontFamily: {
                        "display": ["Space Grotesk", "sans-serif"]
                    }
                },
            },
        }
    </script>
</head>
<body class="bg-background-dark font-display min-h-screen flex items-center justify-center p-4">
    <div class="max-w-md w-full">
        <div class="bg-white/5 border border-white/10 rounded-xl p-8 shadow-2xl shadow-black/20">
            <div class="flex justify-center mb-6">
                <div class="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center">
                    <span class="material-symbols-outlined text-primary text-4xl">lock</span>
                </div>
            </div>

            <h1 class="text-white text-2xl font-bold text-center mb-2">此連結受密碼保護</h1>
            <p class="text-white/60 text-sm text-center mb-6">請輸入密碼以繼續訪問</p>

            <form id="passwordForm" class="space-y-4">
                <div>
                    <label class="text-white text-sm font-medium block mb-2">密碼</label>
                    <div class="relative">
                        <input
                            type="password"
                            id="passwordInput"
                            class="form-input w-full rounded-lg text-white bg-background-dark border border-white/20 h-12 px-4 pr-12 focus:outline-0 focus:ring-2 focus:ring-primary/50 transition-all"
                            placeholder="請輸入密碼"
                            required
                            autofocus
                        />
                        <button
                            type="button"
                            id="togglePassword"
                            class="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors"
                        >
                            <span class="material-symbols-outlined">visibility</span>
                        </button>
                    </div>
                </div>

                <div id="errorMessage" class="hidden text-red-400 text-sm text-center py-2">
                    密碼錯誤，請重試
                </div>

                <button
                    type="submit"
                    id="submitBtn"
                    class="w-full bg-primary hover:bg-blue-600 text-white rounded-lg h-12 px-5 font-bold transition-colors shadow-[0_0_20px_theme(colors.primary/0.4)] flex items-center justify-center gap-2"
                >
                    <span class="material-symbols-outlined">arrow_forward</span>
                    <span>繼續</span>
                </button>
            </form>

            <div class="mt-6 text-center">
                <a href="/" class="text-white/60 hover:text-white text-sm transition-colors">返回首頁</a>
            </div>
        </div>
    </div>

    <script>
        const shortCode = '${escapeJs(shortCode)}'
        const isQrScan = ${isQrScan}
        const passwordInput = document.getElementById('passwordInput')
        const togglePasswordBtn = document.getElementById('togglePassword')
        const passwordForm = document.getElementById('passwordForm')
        const errorMessage = document.getElementById('errorMessage')
        const submitBtn = document.getElementById('submitBtn')

        togglePasswordBtn.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password'
            passwordInput.type = type
            const icon = togglePasswordBtn.querySelector('.material-symbols-outlined')
            icon.textContent = type === 'password' ? 'visibility' : 'visibility_off'
        })

        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault()
            const password = passwordInput.value
            if (!password) return

            submitBtn.disabled = true
            submitBtn.innerHTML = '<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white mx-auto"></div>'
            errorMessage.classList.add('hidden')

            try {
                const response = await fetch(\`/api/urls/\${shortCode}/verify-password\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                })

                if (response.ok) {
                    const data = await response.json()
                    window.location.href = data.original_url
                } else {
                    errorMessage.classList.remove('hidden')
                    passwordInput.value = ''
                    passwordInput.focus()
                }
            } catch (error) {
                console.error('Error:', error)
                errorMessage.textContent = '驗證失敗，請稍後再試'
                errorMessage.classList.remove('hidden')
            } finally {
                submitBtn.disabled = false
                submitBtn.innerHTML = '<span class="material-symbols-outlined">arrow_forward</span><span>繼續</span>'
            }
        })
    </script>
</body>
</html>`
}

export function renderNotFoundPage(shortCode: string): string {
  return `<!DOCTYPE html>
<html class="dark" lang="zh-TW">
<head>
    <meta charset="utf-8"/>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>短網址不存在 - TCurl</title>
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#1337ec",
                        "background-dark": "#101322",
                    },
                    fontFamily: {
                        "display": ["Space Grotesk", "sans-serif"]
                    }
                },
            },
        }
    </script>
</head>
<body class="bg-background-dark font-display min-h-screen flex items-center justify-center p-4">
    <div class="max-w-md w-full">
        <div class="bg-white/5 border border-white/10 rounded-xl p-8 shadow-2xl shadow-black/20">
            <div class="flex justify-center mb-6">
                <div class="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
                    <span class="material-symbols-outlined text-red-500 text-4xl">link_off</span>
                </div>
            </div>

            <h1 class="text-white text-2xl font-bold text-center mb-2">短網址不存在</h1>
            <p class="text-white/60 text-sm text-center mb-8">此短網址可能已被刪除或從未建立</p>

            <div class="space-y-3">
                <a
                    href="/"
                    class="flex items-center justify-center gap-2 w-full bg-primary hover:bg-blue-600 text-white rounded-lg h-12 px-5 font-bold transition-colors shadow-[0_0_20px_theme(colors.primary/0.4)]"
                >
                    <span class="material-symbols-outlined">add</span>
                    <span>建立新的短網址</span>
                </a>
                <a
                    href="/links"
                    class="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 text-white rounded-lg h-12 px-5 font-bold transition-colors"
                >
                    <span class="material-symbols-outlined">list</span>
                    <span>查看所有連結</span>
                </a>
            </div>
        </div>
    </div>
</body>
</html>`
}

export function renderAdPage(shortCode: string, originalUrl: string): string {
  // 解析目標網址的域名
  let targetDomain = ''
  try {
    const url = new URL(originalUrl)
    targetDomain = url.hostname
  } catch {
    targetDomain = originalUrl
  }

  return `<!DOCTYPE html>
<html class="dark" lang="zh-TW">
<head>
    <meta charset="utf-8"/>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>前往連結 - TCurl 慈濟短網址</title>
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#1337ec",
                        "background-dark": "#101322",
                        "tzu-chi": "#b8860b",
                    },
                    fontFamily: {
                        "display": ["Space Grotesk", "sans-serif"]
                    }
                },
            },
        }
    </script>
</head>
<body class="bg-background-dark font-display min-h-screen flex items-center justify-center p-4">
    <style>
        @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 20px rgba(19, 55, 236, 0.4); }
            50% { box-shadow: 0 0 40px rgba(19, 55, 236, 0.8), 0 0 60px rgba(19, 55, 236, 0.4); }
        }
        .btn-ready {
            animation: pulse-glow 1.5s ease-in-out infinite;
        }
    </style>
    <div class="w-full max-w-md md:max-w-2xl lg:max-w-4xl">
        <!-- 廣告區塊 + 安全驗證 -->
        <div class="bg-gradient-to-r from-tzu-chi/20 to-primary/20 border border-tzu-chi/30 rounded-xl p-4 md:p-6 mb-4 shadow-lg">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <img src="/images/tzuchi-logo.png" alt="慈濟" class="w-10 h-10 object-contain" onerror="this.style.display='none'"/>
                    <div>
                        <h2 class="text-white font-bold text-lg">慈濟基金會</h2>
                        <p class="text-white/60 text-xs">官方短網址服務</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 bg-green-500/20 px-3 py-1.5 rounded-full">
                    <span class="material-symbols-outlined text-green-400 text-lg">verified</span>
                    <span class="text-green-400 text-xs font-medium">官方認證連結</span>
                </div>
            </div>
        </div>

        <!-- 主要內容區 -->
        <div class="bg-white/5 border border-white/10 rounded-xl p-4 md:p-8 shadow-2xl shadow-black/20">

            <!-- 即將前往 - 更醒目 -->
            <div class="bg-primary/10 border-2 border-primary/30 rounded-xl p-4 md:p-6 mb-6">
                <div class="flex items-center gap-2 mb-3">
                    <span class="material-symbols-outlined text-primary text-2xl">open_in_new</span>
                    <h2 class="text-primary text-lg md:text-xl font-bold">即將前往</h2>
                </div>
                <div class="bg-white/5 rounded-lg p-3 md:p-4">
                    <p class="text-white font-bold text-lg md:text-2xl break-all mb-2">${escapeHtml(targetDomain)}</p>
                    <p class="text-white/50 text-xs md:text-sm break-all">${escapeHtml(originalUrl)}</p>
                </div>
            </div>

            <!-- 防詐騙小提醒 - 更醒目 -->
            <div class="bg-orange-500/10 border-2 border-orange-500/30 rounded-xl p-4 md:p-5 mb-6">
                <div class="flex items-center gap-2 mb-3">
                    <span class="material-symbols-outlined text-orange-500 text-2xl">warning</span>
                    <h3 class="text-orange-400 text-base md:text-lg font-bold">防詐騙小提醒</h3>
                </div>
                <ul class="text-orange-300/90 text-sm md:text-base space-y-2">
                    <li class="flex items-start gap-2">
                        <span class="text-orange-500">•</span>
                        <span>慈濟官方短網址為 <span class="text-orange-200 font-bold bg-orange-500/20 px-2 py-0.5 rounded">url.tzuchi.org</span>，請務必確認</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <span class="text-orange-500">•</span>
                        <span>請確認目標網址與您預期的一致</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <span class="text-orange-500">•</span>
                        <span>官方網站通常使用 https:// 加密連線</span>
                    </li>
                    <li class="flex items-start gap-2">
                        <span class="text-orange-500">•</span>
                        <span>如有疑慮，請直接輸入官方網址</span>
                    </li>
                </ul>
            </div>

            <!-- 倒數計時與前往按鈕 - 更大更明顯 -->
            <button
                type="button"
                id="goBtn"
                disabled
                class="w-full bg-primary/40 text-white/60 rounded-xl h-14 md:h-16 px-6 text-lg md:text-xl font-bold transition-all flex items-center justify-center gap-3 cursor-not-allowed"
            >
                <span id="btnIcon" class="material-symbols-outlined text-2xl">hourglass_top</span>
                <span id="btnText">請稍候 <span id="countdown">5</span> 秒</span>
            </button>

            <div class="mt-6 text-center">
                <button type="button" onclick="window.close()" class="text-white/60 hover:text-white text-sm transition-colors">關閉網頁</button>
            </div>
        </div>
    </div>

    <script>
        const shortCode = '${escapeJs(shortCode)}'
        const originalUrl = '${escapeJs(originalUrl)}'
        const goBtn = document.getElementById('goBtn')
        const btnIcon = document.getElementById('btnIcon')
        const btnText = document.getElementById('btnText')
        const countdownEl = document.getElementById('countdown')

        let countdown = 5
        let viewRecorded = false

        // 記錄廣告曝光
        async function recordAdView() {
            if (viewRecorded) return
            viewRecorded = true
            try {
                await fetch(\`/api/ad/\${shortCode}/view\`, { method: 'POST' })
            } catch (e) {
                console.error('Failed to record ad view:', e)
            }
        }

        // 頁面載入時記錄曝光
        recordAdView()

        // 倒數計時
        const timer = setInterval(() => {
            countdown--
            countdownEl.textContent = countdown

            if (countdown <= 0) {
                clearInterval(timer)
                goBtn.disabled = false
                goBtn.className = 'w-full bg-primary hover:bg-blue-600 text-white rounded-xl h-14 md:h-16 px-6 text-lg md:text-xl font-bold transition-all cursor-pointer btn-ready'
                btnIcon.style.display = 'none'
                btnText.textContent = '點擊前往網站'
            }
        }, 1000)

        // 點擊前往
        goBtn.addEventListener('click', async () => {
            if (goBtn.disabled) return

            goBtn.disabled = true
            btnText.innerHTML = '<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>'

            try {
                // 記錄廣告點擊
                const response = await fetch(\`/api/ad/\${shortCode}/click\`, { method: 'POST' })
                if (response.ok) {
                    const data = await response.json()
                    window.location.href = data.original_url
                } else {
                    // 如果 API 失敗，直接跳轉
                    window.location.href = originalUrl
                }
            } catch (e) {
                console.error('Error:', e)
                // 錯誤時仍然跳轉
                window.location.href = originalUrl
            }
        })
    </script>
</body>
</html>`
}

export function renderExpiredPage(expiresAt: string): string {
  return `<!DOCTYPE html>
<html class="dark" lang="zh-TW">
<head>
    <meta charset="utf-8"/>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>連結已過期 - TCurl</title>
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#1337ec",
                        "background-dark": "#101322",
                    },
                    fontFamily: {
                        "display": ["Space Grotesk", "sans-serif"]
                    }
                },
            },
        }
    </script>
</head>
<body class="bg-background-dark font-display min-h-screen flex items-center justify-center p-4">
    <div class="max-w-md w-full">
        <div class="bg-white/5 border border-white/10 rounded-xl p-8 shadow-2xl shadow-black/20">
            <div class="flex justify-center mb-6">
                <div class="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center">
                    <span class="material-symbols-outlined text-orange-500 text-4xl">schedule</span>
                </div>
            </div>

            <h1 class="text-white text-2xl font-bold text-center mb-2">連結已過期</h1>
            <p class="text-white/60 text-sm text-center mb-6">此短網址已超過有效期限，無法繼續使用</p>

            <div class="bg-white/5 border border-white/10 rounded-lg p-4 mb-6">
                <div class="flex items-center gap-3 text-white/80 text-sm">
                    <span class="material-symbols-outlined text-orange-500">info</span>
                    <div>
                        <p class="font-medium">過期時間</p>
                        <p id="expiredDate" class="text-white/60 text-xs mt-1"></p>
                    </div>
                </div>
            </div>

            <div class="space-y-3">
                <a
                    href="/"
                    class="flex items-center justify-center gap-2 w-full bg-primary hover:bg-blue-600 text-white rounded-lg h-12 px-5 font-bold transition-colors shadow-[0_0_20px_theme(colors.primary/0.4)]"
                >
                    <span class="material-symbols-outlined">add</span>
                    <span>建立新的短網址</span>
                </a>
                <a
                    href="/links"
                    class="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 text-white rounded-lg h-12 px-5 font-bold transition-colors"
                >
                    <span class="material-symbols-outlined">list</span>
                    <span>查看所有連結</span>
                </a>
            </div>
        </div>
    </div>

    <script>
        const expiresAt = '${escapeJs(expiresAt)}'
        const expiredDateEl = document.getElementById('expiredDate')

        if (expiresAt) {
            try {
                const date = new Date(expiresAt)
                expiredDateEl.textContent = date.toLocaleString('zh-TW', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            } catch (e) {
                expiredDateEl.textContent = '無法顯示'
            }
        } else {
            expiredDateEl.textContent = '未設定'
        }
    </script>
</body>
</html>`
}
