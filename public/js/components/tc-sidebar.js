/**
 * TCurl Sidebar Component
 *
 * @element tc-sidebar
 * @attr {string} active - 當前啟用的頁面 ID
 * @attr {string} user-name - 使用者名稱
 * @attr {string} user-email - 使用者 Email
 * @attr {boolean} show-user - 是否顯示使用者區塊
 *
 * @slot footer - 側邊欄底部（例如新增按鈕）
 *
 * @event tc-logout - 登出按鈕點擊時觸發
 * @event tc-navigate - 導航點擊時觸發
 *
 * @example
 * <tc-sidebar active="links" user-name="John" user-email="john@example.com" show-user>
 *   <tc-button slot="footer" variant="primary" full>Create New</tc-button>
 * </tc-sidebar>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
    width: 256px;
    height: 100%;
    flex-shrink: 0;
  }

  .sidebar {
    width: 100%;
    height: 100%;
    background-color: var(--tc-background-card);
    border-right: 1px solid var(--tc-border);
    padding: var(--tc-spacing-md);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow-y: auto;
  }

  .top-section {
    display: flex;
    flex-direction: column;
    gap: var(--tc-spacing-xl);
  }

  /* Logo */
  .logo {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-sm);
    padding: var(--tc-spacing-sm);
  }

  .logo img {
    width: 76px;
    height: 40px;
  }

  .logo-text h1 {
    font-size: var(--tc-font-size-xl);
    font-weight: 700;
    color: var(--tc-text-primary);
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-sm);
  }

  .beta-badge {
    padding: 2px 6px;
    font-size: var(--tc-font-size-xs);
    font-weight: 700;
    background-color: #eab308;
    color: #000;
    border-radius: var(--tc-radius-sm);
  }

  .logo-text p {
    font-size: var(--tc-font-size-xs);
    color: var(--tc-text-secondary);
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
    transition: background-color var(--tc-transition-fast);
    cursor: pointer;
  }

  .nav-item:hover {
    background-color: #282b39;
  }

  .nav-item.active {
    background-color: #282b39;
  }

  .nav-item .icon {
    font-size: 24px;
    color: var(--tc-text-primary);
  }

  .nav-item span:not(.icon) {
    font-size: var(--tc-font-size-sm);
    font-weight: 500;
  }

  /* User Section */
  .user-section {
    display: flex;
    flex-direction: column;
    gap: var(--tc-spacing-sm);
    padding-top: var(--tc-spacing-md);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin-top: var(--tc-spacing-md);
  }

  .user-section.hidden {
    display: none;
  }

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
  }

  .user-avatar .icon {
    font-size: 18px;
    color: var(--tc-primary);
  }

  .user-details {
    flex: 1;
    min-width: 0;
  }

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

  .logout-btn {
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
    transition: all var(--tc-transition-fast);
  }

  .logout-btn:hover {
    background-color: rgba(239, 68, 68, 0.2);
    color: var(--tc-error);
  }

  .logout-btn .icon {
    font-size: 24px;
  }

  /* Footer slot */
  .footer {
    display: flex;
    flex-direction: column;
    gap: var(--tc-spacing-md);
    margin-top: auto;
    padding-top: var(--tc-spacing-md);
  }
`;

const NAV_ITEMS = [
  { id: 'home', icon: 'home', label: '首頁', href: '/' },
  { id: 'links', icon: 'link', label: '我的連結', href: '/links' },
  { id: 'analytics', icon: 'bar_chart', label: '數據分析', href: '/analytics' },
  { id: 'feedback', icon: 'forum', label: '社群建議', href: '/feedback' }
];

export class TCSidebar extends TCElement {
  static get observedAttributes() {
    return ['active', 'user-name', 'user-email', 'show-user'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const active = this.getAttribute('active') || '';
    const userName = this.getAttribute('user-name') || '使用者';
    const userEmail = this.getAttribute('user-email') || '';
    const showUser = this.hasAttribute('show-user');

    const navItemsHtml = NAV_ITEMS.map(item => `
      <a href="${item.href}"
         class="nav-item ${item.id === active ? 'active' : ''}"
         data-id="${item.id}">
        <span class="material-symbols-outlined icon">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `).join('');

    this.setContent(styles, `
      <aside class="sidebar">
        <div class="top-section">
          <div class="logo">
            <img src="https://info.tzuchi.org/favicon.svg" alt="TCurl Logo">
            <div class="logo-text">
              <h1>
                TCurl
                <span class="beta-badge">BETA</span>
              </h1>
              <p>慈濟短網址</p>
            </div>
          </div>

          <nav class="nav">
            ${navItemsHtml}
          </nav>

          <div class="user-section ${showUser ? '' : 'hidden'}">
            <div class="user-info">
              <div class="user-avatar">
                <span class="material-symbols-outlined icon">person</span>
              </div>
              <div class="user-details">
                <div class="user-name">${userName}</div>
                <div class="user-email">${userEmail}</div>
              </div>
            </div>
            <button class="logout-btn">
              <span class="material-symbols-outlined icon">logout</span>
              <span>登出</span>
            </button>
          </div>
        </div>

        <div class="footer">
          <slot name="footer"></slot>
        </div>
      </aside>
    `);

    // Event listeners
    this.$$('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Allow navigation but also emit event
        this.emit('tc-navigate', { id: item.dataset.id, href: item.href });
      });
    });

    this.$('.logout-btn')?.addEventListener('click', () => {
      this.emit('tc-logout');
    });
  }
}

customElements.define('tc-sidebar', TCSidebar);
