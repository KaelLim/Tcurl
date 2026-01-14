/**
 * TCurl Toast Component
 *
 * @element tc-toast
 * @attr {string} variant - 樣式: success | error | warning | info
 * @attr {string} message - 訊息內容
 * @attr {number} duration - 顯示時間 (ms)，預設 3000，設為 0 不自動關閉
 * @attr {boolean} dismissible - 是否可手動關閉
 *
 * @event tc-dismiss - 關閉時觸發
 *
 * @example
 * <tc-toast variant="success" message="Saved successfully!" duration="3000"></tc-toast>
 *
 * // 或使用靜態方法
 * TCToast.show('Operation completed', 'success');
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    position: fixed;
    top: var(--tc-spacing-md);
    right: var(--tc-spacing-md);
    z-index: 9999;
    animation: slideIn 0.3s ease;
  }

  :host(.hiding) {
    animation: slideOut 0.3s ease forwards;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(100%);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(0);
    }
    to {
      opacity: 0;
      transform: translateX(100%);
    }
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-sm);
    padding: 12px var(--tc-spacing-md);
    border-radius: var(--tc-radius-lg);
    box-shadow: var(--tc-shadow-lg);
    min-width: 200px;
    max-width: 400px;
  }

  .toast.variant-success {
    background-color: var(--tc-success);
    color: white;
  }

  .toast.variant-error {
    background-color: var(--tc-error);
    color: white;
  }

  .toast.variant-warning {
    background-color: var(--tc-warning);
    color: black;
  }

  .toast.variant-info {
    background-color: var(--tc-info);
    color: white;
  }

  .icon {
    font-size: 20px;
    flex-shrink: 0;
  }

  .message {
    flex: 1;
    font-size: var(--tc-font-size-sm);
    font-weight: 500;
  }

  .dismiss-btn {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 2px;
    border-radius: var(--tc-radius-sm);
    opacity: 0.8;
    transition: opacity var(--tc-transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dismiss-btn:hover {
    opacity: 1;
  }

  .dismiss-btn .icon {
    font-size: 18px;
  }
`;

const ICONS = {
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
  info: 'info'
};

export class TCToast extends TCElement {
  static get observedAttributes() {
    return ['variant', 'message', 'duration', 'dismissible'];
  }

  connectedCallback() {
    this.render();
    this._startTimer();
  }

  disconnectedCallback() {
    this._clearTimer();
  }

  attributeChangedCallback() {
    this.render();
  }

  _startTimer() {
    const duration = parseInt(this.getAttribute('duration') ?? '3000', 10);
    if (duration > 0) {
      this._timer = setTimeout(() => this.dismiss(), duration);
    }
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  dismiss() {
    this._clearTimer();
    this.classList.add('hiding');
    setTimeout(() => {
      this.emit('tc-dismiss');
      this.remove();
    }, 300);
  }

  render() {
    const variant = this.getAttribute('variant') || 'info';
    const message = this.getAttribute('message') || '';
    const dismissible = this.hasAttribute('dismissible');

    const icon = ICONS[variant] || ICONS.info;

    const dismissBtn = dismissible
      ? `<button class="dismiss-btn" aria-label="Dismiss">
           <span class="material-symbols-outlined icon">close</span>
         </button>`
      : '';

    this.setContent(styles, `
      <div class="toast variant-${variant}" role="alert">
        <span class="material-symbols-outlined icon">${icon}</span>
        <span class="message">${message}</span>
        ${dismissBtn}
      </div>
    `);

    this.$('.dismiss-btn')?.addEventListener('click', () => this.dismiss());
  }

  /**
   * 靜態方法：顯示 Toast
   * @param {string} message - 訊息
   * @param {string} variant - 樣式 (success | error | warning | info)
   * @param {number} duration - 顯示時間 (ms)
   * @returns {TCToast} Toast 元素
   */
  static show(message, variant = 'info', duration = 3000) {
    // Remove existing toasts
    document.querySelectorAll('tc-toast').forEach(t => t.dismiss());

    const toast = document.createElement('tc-toast');
    toast.setAttribute('message', message);
    toast.setAttribute('variant', variant);
    toast.setAttribute('duration', duration.toString());
    toast.setAttribute('dismissible', '');
    document.body.appendChild(toast);
    return toast;
  }

  static success(message, duration = 3000) {
    return TCToast.show(message, 'success', duration);
  }

  static error(message, duration = 3000) {
    return TCToast.show(message, 'error', duration);
  }

  static warning(message, duration = 3000) {
    return TCToast.show(message, 'warning', duration);
  }

  static info(message, duration = 3000) {
    return TCToast.show(message, 'info', duration);
  }
}

customElements.define('tc-toast', TCToast);

// Export for global access
window.TCToast = TCToast;
