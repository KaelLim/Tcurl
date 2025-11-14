// HTML 模板工具函數

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
        const shortCode = '${shortCode}'
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
        const expiresAt = '${expiresAt}'
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
