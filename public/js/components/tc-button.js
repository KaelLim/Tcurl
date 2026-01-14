/**
 * TCurl Button Component
 *
 * @element tc-button
 * @attr {string} variant - 按鈕樣式: primary | secondary | danger | ghost
 * @attr {string} size - 按鈕大小: sm | md | lg
 * @attr {boolean} disabled - 是否禁用
 * @attr {boolean} loading - 是否載入中
 * @attr {string} icon - Material Symbol 圖示名稱
 * @attr {string} icon-position - 圖示位置: left | right
 *
 * @slot - 按鈕文字內容
 *
 * @example
 * <tc-button variant="primary">Primary Button</tc-button>
 * <tc-button variant="secondary" icon="add">Add Item</tc-button>
 * <tc-button variant="danger" loading>Deleting...</tc-button>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: inline-block;
  }

  :host([disabled]) {
    pointer-events: none;
    opacity: 0.5;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--tc-spacing-sm);
    font-family: var(--tc-font-family);
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all var(--tc-transition-fast);
    white-space: nowrap;
    border-radius: var(--tc-radius-lg);
  }

  /* Sizes */
  button.size-sm {
    height: 32px;
    padding: 0 var(--tc-spacing-md);
    font-size: var(--tc-font-size-sm);
  }

  button.size-md {
    height: 40px;
    padding: 0 var(--tc-spacing-lg);
    font-size: var(--tc-font-size-sm);
  }

  button.size-lg {
    height: 48px;
    padding: 0 var(--tc-spacing-xl);
    font-size: var(--tc-font-size-base);
  }

  /* Variants */
  button.variant-primary {
    background-color: var(--tc-primary);
    color: var(--tc-text-primary);
  }

  button.variant-primary:hover {
    background-color: var(--tc-primary-hover);
  }

  button.variant-secondary {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--tc-text-primary);
  }

  button.variant-secondary:hover {
    background-color: rgba(255, 255, 255, 0.2);
  }

  button.variant-danger {
    background-color: var(--tc-error);
    color: var(--tc-text-primary);
  }

  button.variant-danger:hover {
    background-color: #dc2626;
  }

  button.variant-ghost {
    background-color: transparent;
    color: var(--tc-text-secondary);
  }

  button.variant-ghost:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  /* Icon */
  .icon {
    font-size: 18px;
  }

  button.size-sm .icon {
    font-size: 16px;
  }

  button.size-lg .icon {
    font-size: 20px;
  }

  /* Loading */
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Full width */
  :host([full]) {
    display: block;
    width: 100%;
  }

  :host([full]) button {
    width: 100%;
  }
`;

export class TCButton extends TCElement {
  static get observedAttributes() {
    return ['variant', 'size', 'disabled', 'loading', 'icon', 'icon-position'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const variant = this.getAttribute('variant') || 'primary';
    const size = this.getAttribute('size') || 'md';
    const icon = this.getAttribute('icon');
    const iconPosition = this.getAttribute('icon-position') || 'left';
    const loading = this.hasAttribute('loading');
    const disabled = this.hasAttribute('disabled');

    const iconHtml = icon && !loading
      ? `<span class="material-symbols-outlined icon">${icon}</span>`
      : '';

    const spinnerHtml = loading
      ? `<span class="spinner"></span>`
      : '';

    const contentHtml = iconPosition === 'left'
      ? `${spinnerHtml}${iconHtml}<slot></slot>`
      : `<slot></slot>${iconHtml}${spinnerHtml}`;

    this.setContent(styles, `
      <button
        class="variant-${variant} size-${size}"
        ${disabled ? 'disabled' : ''}
      >
        ${contentHtml}
      </button>
    `);

    // Forward click event
    this.$('button').addEventListener('click', (e) => {
      if (!disabled && !loading) {
        this.emit('tc-click', { originalEvent: e });
      }
    });
  }
}

customElements.define('tc-button', TCButton);
