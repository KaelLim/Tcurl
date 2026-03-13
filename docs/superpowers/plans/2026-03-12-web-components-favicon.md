# Web Components Refactor + Favicon Unification — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated sidebar/header HTML across 6 pages with Web Components, unify favicon to local `/favicon.svg`, and add shared `<head>` injection for both client and server-rendered pages.

**Architecture:** Three Web Components (`tc-head-meta`, `tc-sidebar`, `tc-page-header`) handle client-side pages. A `htmlHead()` utility function handles server-rendered pages from `html-templates.ts`. A test page at `public/test/components.html` lets the user visually verify all components.

**Tech Stack:** Vanilla Web Components (Shadow DOM), Deno + Hono (server), TailwindCSS (CDN)

---

## Chunk 1: Foundation — `tc-head-meta` + `htmlHead()` + Favicon

### Task 1: Create `tc-head-meta` Web Component

**Files:**
- Create: `public/js/components/tc-head-meta.js`

This component injects shared `<head>` resources (favicon, Tailwind config, fonts, Material Symbols) into the document. It does NOT use Shadow DOM — it directly appends elements to `document.head`.

- [ ] **Step 1: Create `public/js/components/tc-head-meta.js`**

```javascript
/**
 * TCurl Head Meta Component
 * Injects shared <head> resources: favicon, Tailwind config, fonts, Material Symbols
 *
 * @element tc-head-meta
 * @example
 * <head>
 *   <meta charset="UTF-8">
 *   <meta name="viewport" content="width=device-width, initial-scale=1.0">
 *   <title>Page Title - TCurl</title>
 *   <script src="/js/components/tc-head-meta.js"></script>
 *   <tc-head-meta></tc-head-meta>
 * </head>
 */
class TCHeadMeta extends HTMLElement {
  connectedCallback() {
    this.#injectFavicon();
    this.#injectFonts();
    this.#injectTailwind();
    this.#injectMaterialSymbolsStyle();
  }

  #injectFavicon() {
    if (document.querySelector('link[rel="icon"]')) return;
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg';
    document.head.appendChild(link);
  }

  #injectFonts() {
    // Preconnect
    const preconnects = [
      { href: 'https://fonts.googleapis.com' },
      { href: 'https://fonts.gstatic.com', crossOrigin: '' },
    ];
    preconnects.forEach(({ href, crossOrigin }) => {
      if (document.querySelector(`link[href="${href}"][rel="preconnect"]`)) return;
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = href;
      if (crossOrigin !== undefined) link.crossOrigin = crossOrigin;
      document.head.appendChild(link);
    });

    // Space Grotesk font
    const fontHref = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap';
    if (!document.querySelector(`link[href="${fontHref}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = fontHref;
      document.head.appendChild(link);
    }

    // Material Symbols
    const iconHref = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined';
    if (!document.querySelector(`link[href^="${iconHref}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = iconHref;
      document.head.appendChild(link);
    }
  }

  #injectTailwind() {
    // Tailwind CDN script
    const twSrc = 'https://cdn.tailwindcss.com?plugins=forms,container-queries';
    if (!document.querySelector(`script[src="${twSrc}"]`)) {
      const script = document.createElement('script');
      script.src = twSrc;
      document.head.appendChild(script);
    }

    // Tailwind config - only if tailwind is loaded and not yet configured
    if (!document.querySelector('script[data-tc-tailwind-config]')) {
      const configScript = document.createElement('script');
      configScript.setAttribute('data-tc-tailwind-config', '');
      configScript.textContent = `
        if (typeof tailwind !== 'undefined') {
          tailwind.config = {
            darkMode: "class",
            theme: {
              extend: {
                colors: {
                  "primary": "#1337ec",
                  "background-light": "#f6f6f8",
                  "background-dark": "#101322",
                },
                fontFamily: {
                  "display": ["Space Grotesk", "sans-serif"]
                },
                borderRadius: {
                  "DEFAULT": "0.25rem",
                  "lg": "0.5rem",
                  "xl": "0.75rem",
                  "full": "9999px"
                },
              },
            },
          }
        }
      `;
      document.head.appendChild(configScript);
    }
  }

  #injectMaterialSymbolsStyle() {
    if (document.querySelector('style[data-tc-material-symbols]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-tc-material-symbols', '');
    style.textContent = `
      .material-symbols-outlined {
        font-variation-settings:
          'FILL' 0,
          'wght' 400,
          'GRAD' 0,
          'opsz' 24;
      }
    `;
    document.head.appendChild(style);
  }
}

customElements.define('tc-head-meta', TCHeadMeta);
```

- [ ] **Step 2: Verify by opening any page that includes it (will test in Task 4)**

---

### Task 2: Add `htmlHead()` utility to `html-templates.ts`

**Files:**
- Modify: `src/utils/html-templates.ts`

Add a shared `htmlHead()` function and refactor all four render functions to use it.

- [ ] **Step 1: Add `htmlHead()` function at the top of the file (after `escapeJs`)**

```typescript
/**
 * 產生共用 <head> 內容
 * 用於伺服端產出的頁面（password, expired, ad, not-found）
 */
function htmlHead(title: string): string {
  return `<meta charset="utf-8"/>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>${escapeHtml(title)} - TCurl</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
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
    </script>`;
}
```

- [ ] **Step 2: Update `renderPasswordPage` — replace `<head>` content with `htmlHead('密碼保護')`**

Replace lines 41–63 (everything inside `<head>`) with:
```html
    ${htmlHead('密碼保護')}
```

- [ ] **Step 3: Update `renderNotFoundPage` — replace `<head>` content with `htmlHead('短網址不存在')`**

Replace lines 177–199 (everything inside `<head>`) with:
```html
    ${htmlHead('短網址不存在')}
```

- [ ] **Step 4: Update `renderExpiredPage` — replace `<head>` content with `htmlHead('連結已過期')`**

Replace lines 428–449 (everything inside `<head>`) with:
```html
    ${htmlHead('連結已過期')}
```

- [ ] **Step 5: Update `renderAdPage` — replace `<head>` content with `htmlHead('前往連結')`**

Replace lines 247–269 (everything inside `<head>`) with:
```html
    ${htmlHead('前往連結')}
```

Note: The ad page also uses a `tzu-chi` color. Add it after the htmlHead call as an inline `<script>` that extends the config, OR add it to the htmlHead function with an optional `extraColors` parameter. Simpler approach: just add a `<style>` for `.bg-tzu-chi` directly in the ad page body since it's only used there.

Actually, the simplest approach is to keep the `tzu-chi` color as a one-off `<style>` in the ad page body:
```html
<style>
  .bg-tzu-chi\/20 { background-color: rgba(184, 134, 11, 0.2); }
  /* etc - but actually Tailwind generates these on the fly, so we need it in the config */
</style>
```

Better approach: extend `htmlHead()` with an optional `extraConfig` parameter:

```typescript
function htmlHead(title: string, extraColors?: Record<string, string>): string {
```

And in the tailwind config colors section, spread `...extraColors`. Then call it as:
```typescript
htmlHead('前往連結', { 'tzu-chi': '#b8860b' })
```

- [ ] **Step 6: Run `deno task check` to verify no type errors**

```bash
cd /web/html/urlpj/shorturl-api && deno task check
```

- [ ] **Step 7: Commit**

```bash
git add src/utils/html-templates.ts public/js/components/tc-head-meta.js
git commit -m "feat: add tc-head-meta component and htmlHead() utility for shared head content"
```

---

## Chunk 2: `tc-sidebar` Rewrite

### Task 3: Rewrite `tc-sidebar` Web Component

**Files:**
- Modify: `public/js/components/tc-sidebar.js` (full rewrite)

The current `tc-sidebar.js` exists but had bugs. Rewrite it with:
- Mobile responsive (hamburger toggle, overlay, close button)
- Desktop: static sidebar
- User section with `setUser()` / `clearUser()` API
- `tc-logout` event
- Local favicon (`/favicon.svg`)

Key differences from current version:
1. Must handle mobile hamburger + overlay (currently done in each HTML page separately)
2. Must include login section for unauthenticated state
3. Logo must use `/favicon.svg` (local)

- [ ] **Step 1: Rewrite `public/js/components/tc-sidebar.js`**

```javascript
/**
 * TCurl Sidebar Component
 *
 * @element tc-sidebar
 * @attr {string} active - Active nav item: home | links | analytics | feedback
 *
 * @method setUser({ name, email, avatar }) - Show authenticated user info
 * @method clearUser() - Show login prompt (unauthenticated state)
 *
 * @event tc-logout - Dispatched when logout button is clicked
 *
 * @example
 * <tc-sidebar active="home"></tc-sidebar>
 * <script>
 *   const sidebar = document.querySelector('tc-sidebar');
 *   sidebar.setUser({ name: 'User', email: 'user@example.com' });
 *   sidebar.addEventListener('tc-logout', () => { ... });
 * </script>
 */
import { TCElement } from './base.js';

const NAV_ITEMS = [
  { id: 'home', icon: 'home', label: '首頁', href: '/' },
  { id: 'links', icon: 'link', label: '我的連結', href: '/links' },
  { id: 'analytics', icon: 'bar_chart', label: '數據分析', href: '/analytics' },
  { id: 'feedback', icon: 'forum', label: '社群建議', href: '/feedback' },
];

export class TCSidebar extends TCElement {
  static get observedAttributes() {
    return ['active'];
  }

  #user = null;

  connectedCallback() {
    this.render();
    this.#setupMobileToggle();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  setUser({ name, email, avatar }) {
    this.#user = { name, email, avatar };
    this.#updateUserSection();
  }

  clearUser() {
    this.#user = null;
    this.#updateUserSection();
  }

  #updateUserSection() {
    const userSection = this.$('.user-section');
    const loginSection = this.$('.login-section');
    if (!userSection || !loginSection) return;

    if (this.#user) {
      userSection.classList.remove('hidden');
      loginSection.classList.add('hidden');

      const nameEl = this.$('.user-name');
      const emailEl = this.$('.user-email');
      const avatarEl = this.$('.user-avatar');

      if (nameEl) nameEl.textContent = this.#user.name || '使用者';
      if (emailEl) emailEl.textContent = this.#user.email || '';
      if (avatarEl) {
        if (this.#user.avatar) {
          avatarEl.innerHTML = `<img src="${this.#user.avatar}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;">`;
        } else {
          avatarEl.innerHTML = `<span class="material-symbols-outlined icon">person</span>`;
        }
      }
    } else {
      userSection.classList.add('hidden');
      loginSection.classList.remove('hidden');
    }
  }

  #setupMobileToggle() {
    // Listen for external toggle button clicks
    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-sidebar-toggle]');
      if (toggle) {
        e.stopPropagation();
        this.#openMobile();
      }
    });
  }

  #openMobile() {
    const sidebar = this.$('.sidebar');
    const overlay = this.$('.overlay');
    if (!sidebar || !overlay) return;
    sidebar.classList.add('open');
    overlay.classList.add('visible');
  }

  #closeMobile() {
    const sidebar = this.$('.sidebar');
    const overlay = this.$('.overlay');
    if (!sidebar || !overlay) return;
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }

  render() {
    const active = this.getAttribute('active') || '';

    const navHtml = NAV_ITEMS.map(item => `
      <a href="${item.href}"
         class="nav-item ${item.id === active ? 'active' : ''}"
         data-id="${item.id}">
        <span class="material-symbols-outlined icon">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `).join('');

    const styles = `
      :host {
        display: block;
      }

      /* Overlay */
      .overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 30;
      }
      .overlay.visible {
        display: block;
      }

      /* Sidebar */
      .sidebar {
        position: fixed;
        inset-block: 0;
        left: 0;
        z-index: 40;
        width: 256px;
        background-color: var(--tc-background-card);
        border-right: 1px solid var(--tc-border);
        padding: var(--tc-spacing-md);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        overflow-y: auto;
        transform: translateX(-100%);
        transition: transform 300ms ease;
      }
      .sidebar.open {
        transform: translateX(0);
      }

      @media (min-width: 1024px) {
        .overlay { display: none !important; }
        .sidebar {
          position: static;
          transform: none;
          flex-shrink: 0;
          height: 100%;
        }
        .mobile-header { display: none !important; }
      }

      .top-section {
        display: flex;
        flex-direction: column;
        gap: var(--tc-spacing-xl);
      }

      /* Mobile header with close button */
      .mobile-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .mobile-logo {
        display: flex;
        align-items: center;
        gap: var(--tc-spacing-sm);
      }
      .mobile-logo img { width: 53px; height: 28px; }
      .mobile-logo h1 {
        font-size: var(--tc-font-size-lg);
        font-weight: 700;
        color: var(--tc-text-primary);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mobile-logo p {
        font-size: var(--tc-font-size-xs);
        color: var(--tc-text-secondary);
      }
      .close-btn {
        background: none;
        border: none;
        color: var(--tc-text-primary);
        padding: var(--tc-spacing-sm);
        cursor: pointer;
        border-radius: var(--tc-radius-lg);
        transition: background-color var(--tc-transition-fast);
      }
      .close-btn:hover {
        background-color: rgba(255, 255, 255, 0.1);
      }

      /* Desktop logo */
      .desktop-logo {
        display: none;
        align-items: center;
        gap: var(--tc-spacing-sm);
        padding: var(--tc-spacing-sm);
      }
      @media (min-width: 1024px) {
        .desktop-logo { display: flex; }
      }
      .desktop-logo img { width: 76px; height: 40px; }
      .desktop-logo h1 {
        font-size: var(--tc-font-size-xl);
        font-weight: 700;
        color: var(--tc-text-primary);
        display: flex;
        align-items: center;
        gap: var(--tc-spacing-sm);
      }
      .desktop-logo p {
        font-size: var(--tc-font-size-xs);
        color: var(--tc-text-secondary);
      }

      .version-badge {
        padding: 2px 6px;
        font-size: var(--tc-font-size-xs);
        font-weight: 700;
        background-color: #3b82f6;
        color: #fff;
        border-radius: var(--tc-radius-sm);
      }
      .mobile-logo .version-badge {
        font-size: 8px;
      }

      /* Navigation */
      .nav {
        display: flex;
        flex-direction: column;
        gap: var(--tc-spacing-sm);
      }
      .nav-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: var(--tc-spacing-sm) 12px;
        border-radius: var(--tc-radius-lg);
        color: var(--tc-text-primary);
        text-decoration: none;
        font-size: var(--tc-font-size-sm);
        font-weight: 500;
        transition: background-color var(--tc-transition-fast);
        cursor: pointer;
      }
      .nav-item:hover { background-color: #282b39; }
      .nav-item.active { background-color: #282b39; }
      .nav-item .icon { font-size: 24px; }

      /* User & Login Sections */
      .user-section, .login-section {
        display: flex;
        flex-direction: column;
        gap: var(--tc-spacing-sm);
        padding-top: var(--tc-spacing-md);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }
      .user-section.hidden, .login-section.hidden { display: none; }

      .user-info {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: var(--tc-spacing-sm) 12px;
      }
      .user-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background-color: rgba(19, 55, 236, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex-shrink: 0;
      }
      .user-avatar .icon { font-size: 18px; color: var(--tc-primary); }
      .user-details { flex: 1; min-width: 0; }
      .user-name {
        font-size: var(--tc-font-size-sm);
        font-weight: 500;
        color: var(--tc-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .user-email {
        font-size: var(--tc-font-size-xs);
        color: var(--tc-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .logout-btn, .login-link {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: var(--tc-spacing-sm) 12px;
        border-radius: var(--tc-radius-lg);
        color: var(--tc-text-secondary);
        background: none;
        border: none;
        cursor: pointer;
        width: 100%;
        font-family: var(--tc-font-family);
        font-size: var(--tc-font-size-sm);
        font-weight: 500;
        text-decoration: none;
        transition: all var(--tc-transition-fast);
      }
      .logout-btn:hover {
        background-color: rgba(239, 68, 68, 0.2);
        color: var(--tc-error);
      }
      .login-link:hover {
        background-color: rgba(19, 55, 236, 0.2);
      }
      .login-link.secondary:hover {
        background-color: rgba(255, 255, 255, 0.1);
      }

      .footer {
        margin-top: auto;
        padding-top: var(--tc-spacing-md);
      }
    `;

    const savedUser = this.#user;

    this.setContent(styles, `
      <div class="overlay"></div>
      <aside class="sidebar">
        <div class="top-section">
          <!-- Mobile header -->
          <div class="mobile-header">
            <div class="mobile-logo">
              <img src="/favicon.svg" alt="TCurl Logo">
              <div>
                <h1>TCurl <span class="version-badge">v1.0.0</span></h1>
                <p>慈濟短網址</p>
              </div>
            </div>
            <button class="close-btn" data-action="close">
              <span class="material-symbols-outlined" style="font-size:24px;">close</span>
            </button>
          </div>

          <!-- Desktop logo -->
          <div class="desktop-logo">
            <img src="/favicon.svg" alt="TCurl Logo">
            <div>
              <h1>TCurl <span class="version-badge">v1.0.0</span></h1>
              <p>慈濟短網址</p>
            </div>
          </div>

          <nav class="nav">${navHtml}</nav>

          <!-- User section (authenticated) -->
          <div class="user-section hidden">
            <div class="user-info">
              <div class="user-avatar">
                <span class="material-symbols-outlined icon">person</span>
              </div>
              <div class="user-details">
                <div class="user-name">使用者</div>
                <div class="user-email"></div>
              </div>
            </div>
            <button class="logout-btn" data-action="logout">
              <span class="material-symbols-outlined icon">logout</span>
              <span>登出</span>
            </button>
          </div>

          <!-- Login section (unauthenticated) -->
          <div class="login-section">
            <a href="/login.html" class="login-link">
              <span class="material-symbols-outlined icon">login</span>
              <span>登入</span>
            </a>
          </div>
        </div>

        <div class="footer">
          <slot name="footer"></slot>
        </div>
      </aside>
    `);

    // Restore user state after re-render
    if (savedUser) {
      this.#user = savedUser;
      this.#updateUserSection();
    }

    // Event: close mobile
    this.$('[data-action="close"]')?.addEventListener('click', () => this.#closeMobile());
    this.$('.overlay')?.addEventListener('click', () => this.#closeMobile());

    // Event: logout
    this.$('[data-action="logout"]')?.addEventListener('click', () => {
      this.emit('tc-logout');
    });

    // Event: close mobile on nav click (mobile only)
    this.$$('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth < 1024) this.#closeMobile();
      });
    });
  }
}

customElements.define('tc-sidebar', TCSidebar);
```

- [ ] **Step 2: Commit**

```bash
git add public/js/components/tc-sidebar.js
git commit -m "feat: rewrite tc-sidebar with mobile support, user API, and local favicon"
```

---

## Chunk 3: `tc-page-header` + Test Page

### Task 4: Create `tc-page-header` Web Component

**Files:**
- Create: `public/js/components/tc-page-header.js`

- [ ] **Step 1: Create `public/js/components/tc-page-header.js`**

```javascript
/**
 * TCurl Page Header Component
 *
 * @element tc-page-header
 * @attr {string} title - Page title
 * @attr {string} description - Page description/subtitle
 *
 * @slot actions - Right-aligned action buttons
 *
 * @example
 * <tc-page-header title="我的連結" description="管理您建立的所有短網址">
 *   <button slot="actions">新增</button>
 * </tc-page-header>
 */
import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
    margin-bottom: var(--tc-spacing-xl);
  }

  .header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--tc-spacing-md);
  }

  .text h1 {
    font-size: var(--tc-font-size-4xl);
    font-weight: 900;
    color: var(--tc-text-primary);
    line-height: 1.2;
    letter-spacing: -0.033em;
  }

  .text p {
    font-size: var(--tc-font-size-base);
    color: var(--tc-text-secondary);
    margin-top: var(--tc-spacing-xs);
  }

  .actions {
    display: flex;
    gap: var(--tc-spacing-sm);
    align-items: center;
  }

  @media (max-width: 640px) {
    .text h1 {
      font-size: var(--tc-font-size-3xl);
    }
  }
`;

export class TCPageHeader extends TCElement {
  static get observedAttributes() {
    return ['title', 'description'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const title = this.getAttribute('title') || '';
    const description = this.getAttribute('description') || '';

    this.setContent(styles, `
      <div class="header">
        <div class="text">
          <h1>${title}</h1>
          ${description ? `<p>${description}</p>` : ''}
        </div>
        <div class="actions">
          <slot name="actions"></slot>
        </div>
      </div>
    `);
  }
}

customElements.define('tc-page-header', TCPageHeader);
```

- [ ] **Step 2: Commit**

```bash
git add public/js/components/tc-page-header.js
git commit -m "feat: add tc-page-header component"
```

---

### Task 5: Create Test Page

**Files:**
- Create: `public/test/components.html`

- [ ] **Step 1: Create `public/test/` directory and `components.html`**

```bash
mkdir -p public/test
```

```html
<!DOCTYPE html>
<html class="dark" lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Components Test - TCurl</title>
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <link href="https://fonts.googleapis.com" rel="preconnect"/>
    <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"/>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "primary": "#1337ec",
                        "background-light": "#f6f6f8",
                        "background-dark": "#101322",
                    },
                    fontFamily: {
                        "display": ["Space Grotesk", "sans-serif"]
                    },
                    borderRadius: {
                        "DEFAULT": "0.25rem",
                        "lg": "0.5rem",
                        "xl": "0.75rem",
                        "full": "9999px"
                    },
                },
            },
        }
    </script>
    <style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
    </style>
</head>
<body class="bg-background-light dark:bg-background-dark font-display">
    <!-- Mobile hamburger -->
    <button data-sidebar-toggle class="lg:hidden fixed top-4 left-4 z-50 text-white p-3 bg-[#111218] hover:bg-[#1a1d2e] rounded-lg transition-colors shadow-lg border border-white/10">
        <span class="material-symbols-outlined text-2xl">menu</span>
    </button>

    <div class="flex h-screen overflow-hidden">
        <!-- Sidebar Component -->
        <tc-sidebar active="home"></tc-sidebar>

        <!-- Main Content -->
        <main class="flex-1 p-8 overflow-y-auto">
            <div class="max-w-4xl mx-auto">
                <!-- Page Header Component -->
                <tc-page-header
                    title="Components Test"
                    description="This page demonstrates all Web Components working together.">
                    <button slot="actions"
                        class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded-lg font-bold transition-colors">
                        <span class="material-symbols-outlined text-lg">add</span>
                        Action Button
                    </button>
                </tc-page-header>

                <!-- Test Controls -->
                <div class="rounded-xl border border-white/10 bg-white/5 p-6 mb-6">
                    <h2 class="text-white text-lg font-bold mb-4">Sidebar Controls</h2>
                    <div class="flex flex-wrap gap-3">
                        <button id="setUserBtn"
                            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                            Set User (Authenticated)
                        </button>
                        <button id="clearUserBtn"
                            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors">
                            Clear User (Unauthenticated)
                        </button>
                        <button id="changeActiveBtn"
                            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                            Cycle Active Nav
                        </button>
                    </div>
                </div>

                <!-- Event Log -->
                <div class="rounded-xl border border-white/10 bg-white/5 p-6">
                    <h2 class="text-white text-lg font-bold mb-4">Event Log</h2>
                    <div id="eventLog" class="font-mono text-sm text-white/80 space-y-1 max-h-48 overflow-y-auto">
                        <p class="text-white/40">Events will appear here...</p>
                    </div>
                </div>
            </div>
        </main>
    </div>

    <!-- Load Components -->
    <script type="module">
        import './../../js/components/tc-sidebar.js';
        import './../../js/components/tc-page-header.js';

        const sidebar = document.querySelector('tc-sidebar');
        const eventLog = document.getElementById('eventLog');
        const navIds = ['home', 'links', 'analytics', 'feedback'];
        let navIndex = 0;

        function log(msg) {
            const p = document.createElement('p');
            p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            eventLog.prepend(p);
        }

        // Set User
        document.getElementById('setUserBtn').addEventListener('click', () => {
            sidebar.setUser({
                name: '張三',
                email: 'zhangsan@tzuchi.org.tw',
                avatar: null,
            });
            log('setUser() called — user section visible');
        });

        // Clear User
        document.getElementById('clearUserBtn').addEventListener('click', () => {
            sidebar.clearUser();
            log('clearUser() called — login section visible');
        });

        // Cycle Active
        document.getElementById('changeActiveBtn').addEventListener('click', () => {
            navIndex = (navIndex + 1) % navIds.length;
            sidebar.setAttribute('active', navIds[navIndex]);
            log(`active changed to "${navIds[navIndex]}"`);
        });

        // Listen for logout event
        sidebar.addEventListener('tc-logout', () => {
            log('tc-logout event fired');
        });
    </script>
</body>
</html>
```

- [ ] **Step 2: Run the dev server and open `http://localhost:3000/test/components.html` in a browser**

```bash
cd /web/html/urlpj/shorturl-api && deno task dev
```

Verify:
- Sidebar renders with logo, nav items, login section
- "Set User" button shows user section, hides login section
- "Clear User" button reverses it
- "Cycle Active" highlights different nav items
- On mobile viewport: hamburger button opens sidebar with overlay
- Favicon shows in browser tab (local `/favicon.svg`)

- [ ] **Step 3: Commit**

```bash
git add public/test/components.html
git commit -m "feat: add components test page for visual verification"
```

---

## Chunk 4: Migrate HTML Pages

### Task 6: Update Favicon in All HTML Pages

**Files:**
- Modify: `public/index.html`, `public/edit.html`, `public/links.html`, `public/analytics.html`, `public/feedback.html`, `public/feedback-detail.html`, `public/login.html`, `public/password.html`, `public/expired.html`, `public/privacy.html`

- [ ] **Step 1: Replace all external favicon references with local**

In every HTML file, find:
```html
<link rel="icon" type="image/svg+xml" href="https://info.tzuchi.org/favicon.svg"/>
```

Replace with:
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
```

- [ ] **Step 2: Replace all external favicon image references in sidebar logos**

In every HTML file with a sidebar, find all:
```html
<img src="https://info.tzuchi.org/favicon.svg" alt="TCurl Logo"
```

Replace with:
```html
<img src="/favicon.svg" alt="TCurl Logo"
```

- [ ] **Step 3: Commit**

```bash
git add public/*.html
git commit -m "fix: use local /favicon.svg instead of external info.tzuchi.org"
```

---

### Task 7: Migrate Sidebar Pages to `<tc-sidebar>`

This is the largest task. For each of the 6 pages with sidebars (index, edit, links, analytics, feedback, feedback-detail), replace the inline sidebar HTML with `<tc-sidebar>`.

**Files:**
- Modify: `public/index.html`, `public/edit.html`, `public/links.html`, `public/analytics.html`, `public/feedback.html`, `public/feedback-detail.html`

**Pattern for each page:**

1. Add module import before closing `</body>`:
```html
<script type="module">
  import '/js/components/tc-sidebar.js';
</script>
```

2. Replace the hamburger button:
```html
<!-- Old -->
<button id="menuToggle" class="lg:hidden fixed ...">...</button>

<!-- New -->
<button data-sidebar-toggle class="lg:hidden fixed top-4 left-4 z-50 text-white p-3 bg-[#111218] hover:bg-[#1a1d2e] rounded-lg transition-colors shadow-lg border border-white/10">
    <span class="material-symbols-outlined text-2xl">menu</span>
</button>
```

3. Replace the entire `<aside id="sidebar">...</aside>` and `<div id="overlay">...</div>` with:
```html
<tc-sidebar active="{page-id}"></tc-sidebar>
```

4. Update the auth script to use the component API instead of DOM manipulation:
```javascript
// Old
const userSection = document.getElementById('userSection');
const loginSection = document.getElementById('loginSection');
userSection.classList.remove('hidden');
loginSection.classList.add('hidden');
document.getElementById('userDisplayName').textContent = name;
document.getElementById('userEmail').textContent = email;

// New
const sidebar = document.querySelector('tc-sidebar');
sidebar.setUser({ name, email, avatar: avatarUrl });
sidebar.addEventListener('tc-logout', async () => {
    await auth.signOut();
});
```

5. Remove the mobile menu toggle script (now handled inside component).

**Page-specific `active` values:**

| Page | `active` |
|------|----------|
| `index.html` | `home` |
| `edit.html` | `home` |
| `links.html` | `links` |
| `analytics.html` | `analytics` |
| `feedback.html` | `feedback` |
| `feedback-detail.html` | `feedback` |

- [ ] **Step 1: Migrate `index.html`**

Remove: lines 64–151 (hamburger, sidebar, overlay), lines 340–372 (mobile toggle script)
Replace sidebar with `<tc-sidebar active="home"></tc-sidebar>`
Update auth script (lines 297–338) to use `sidebar.setUser()` / `sidebar.addEventListener('tc-logout', ...)`
Add `<script type="module">import '/js/components/tc-sidebar.js';</script>` before `</body>`

- [ ] **Step 2: Migrate `links.html`**

Same pattern with `active="links"`. This page has no mobile toggle script (desktop-only sidebar) so just replace the `<aside>` block.

- [ ] **Step 3: Migrate `analytics.html`**

Same pattern with `active="analytics"`.

- [ ] **Step 4: Migrate `edit.html`**

Same pattern with `active="home"`. This page also has mobile toggle script to remove.

- [ ] **Step 5: Migrate `feedback.html`**

Same pattern with `active="feedback"`.

- [ ] **Step 6: Migrate `feedback-detail.html`**

Same pattern with `active="feedback"`.

- [ ] **Step 7: Visually verify each page**

Open each migrated page in the browser and verify:
- Sidebar renders identically to the old version
- Active nav item is highlighted
- User section shows after auth
- Mobile hamburger works
- Logout works

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/edit.html public/links.html public/analytics.html public/feedback.html public/feedback-detail.html
git commit -m "refactor: replace inline sidebar HTML with tc-sidebar component across 6 pages"
```

---

### Task 8: Final Cleanup

**Files:**
- Modify: `public/js/components/index.js` (if it exists — update exports)

- [ ] **Step 1: Verify no remaining references to `info.tzuchi.org/favicon.svg`**

```bash
grep -r "info.tzuchi.org/favicon" public/ src/
```

Expected: no matches (note: sidebar logo `<img>` references in non-migrated places might remain — those are fine if they're for the full logo, not favicon).

- [ ] **Step 2: Run `deno task check` and `deno task lint`**

```bash
cd /web/html/urlpj/shorturl-api && deno task check && deno task lint
```

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: cleanup after web components migration"
```
