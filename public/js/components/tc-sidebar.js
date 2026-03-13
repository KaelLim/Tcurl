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
          <div class="mobile-header">
            <div class="mobile-logo">
              <img src="/favicon.svg" alt="TCurl Logo">
              <div>
                <h1>TCurl <span class="version-badge">v1.1.0</span></h1>
                <p>慈濟短網址</p>
              </div>
            </div>
            <button class="close-btn" data-action="close">
              <span class="material-symbols-outlined" style="font-size:24px;">close</span>
            </button>
          </div>

          <div class="desktop-logo">
            <img src="/favicon.svg" alt="TCurl Logo">
            <div>
              <h1>TCurl <span class="version-badge">v1.1.0</span></h1>
              <p>慈濟短網址</p>
            </div>
          </div>

          <nav class="nav">${navHtml}</nav>

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

    if (savedUser) {
      this.#user = savedUser;
      this.#updateUserSection();
    }

    this.$('[data-action="close"]')?.addEventListener('click', () => this.#closeMobile());
    this.$('.overlay')?.addEventListener('click', () => this.#closeMobile());

    this.$('[data-action="logout"]')?.addEventListener('click', () => {
      this.emit('tc-logout');
    });

    this.$$('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth < 1024) this.#closeMobile();
      });
    });
  }
}

customElements.define('tc-sidebar', TCSidebar);
