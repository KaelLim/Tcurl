/**
 * TCurl Avatar Component
 *
 * @element tc-avatar
 * @attr {string} src - 圖片網址
 * @attr {string} name - 使用者名稱（用於生成縮寫）
 * @attr {string} size - 大小: xs | sm | md | lg | xl
 * @attr {string} variant - 樣式: circle | rounded | square
 *
 * @example
 * <tc-avatar src="/images/user.jpg" size="md"></tc-avatar>
 * <tc-avatar name="John Doe" size="lg"></tc-avatar>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: inline-block;
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background-color: rgba(19, 55, 236, 0.2);
    color: var(--tc-primary);
    font-weight: 600;
    text-transform: uppercase;
  }

  /* Sizes */
  .avatar.size-xs {
    width: 24px;
    height: 24px;
    font-size: 10px;
  }

  .avatar.size-sm {
    width: 32px;
    height: 32px;
    font-size: 12px;
  }

  .avatar.size-md {
    width: 40px;
    height: 40px;
    font-size: 14px;
  }

  .avatar.size-lg {
    width: 48px;
    height: 48px;
    font-size: 16px;
  }

  .avatar.size-xl {
    width: 64px;
    height: 64px;
    font-size: 20px;
  }

  /* Variants */
  .avatar.variant-circle {
    border-radius: 50%;
  }

  .avatar.variant-rounded {
    border-radius: var(--tc-radius-lg);
  }

  .avatar.variant-square {
    border-radius: var(--tc-radius-sm);
  }

  /* Image */
  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Icon fallback */
  .avatar .icon {
    opacity: 0.8;
  }

  .avatar.size-xs .icon { font-size: 16px; }
  .avatar.size-sm .icon { font-size: 18px; }
  .avatar.size-md .icon { font-size: 22px; }
  .avatar.size-lg .icon { font-size: 28px; }
  .avatar.size-xl .icon { font-size: 36px; }
`;

export class TCAvatar extends TCElement {
  static get observedAttributes() {
    return ['src', 'name', 'size', 'variant'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  _getInitials(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].substring(0, 2);
    }
    return parts[0][0] + parts[parts.length - 1][0];
  }

  render() {
    const src = this.getAttribute('src');
    const name = this.getAttribute('name');
    const size = this.getAttribute('size') || 'md';
    const variant = this.getAttribute('variant') || 'circle';

    let content = '';
    if (src) {
      content = `<img src="${src}" alt="${name || 'Avatar'}" />`;
    } else if (name) {
      content = `<span class="initials">${this._getInitials(name)}</span>`;
    } else {
      content = `<span class="material-symbols-outlined icon">person</span>`;
    }

    this.setContent(styles, `
      <div class="avatar size-${size} variant-${variant}">
        ${content}
      </div>
    `);

    // Handle image error
    const img = this.$('img');
    if (img) {
      img.addEventListener('error', () => {
        const avatar = this.$('.avatar');
        if (name) {
          avatar.innerHTML = `<span class="initials">${this._getInitials(name)}</span>`;
        } else {
          avatar.innerHTML = `<span class="material-symbols-outlined icon">person</span>`;
        }
      });
    }
  }
}

customElements.define('tc-avatar', TCAvatar);
