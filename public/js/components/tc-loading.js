/**
 * TCurl Loading Component
 *
 * @element tc-loading
 * @attr {string} size - 大小: sm | md | lg
 * @attr {string} text - 載入文字
 * @attr {boolean} overlay - 是否為全螢幕覆蓋模式
 *
 * @example
 * <tc-loading size="md" text="Loading..."></tc-loading>
 * <tc-loading overlay text="Please wait..."></tc-loading>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--tc-spacing-sm);
  }

  :host([overlay]) {
    position: fixed;
    inset: 0;
    background-color: rgba(16, 19, 34, 0.8);
    z-index: 9999;
  }

  .container {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-sm);
  }

  :host([overlay]) .container {
    flex-direction: column;
    gap: var(--tc-spacing-md);
  }

  .spinner {
    border-radius: 50%;
    border-style: solid;
    border-color: transparent;
    border-top-color: var(--tc-primary);
    animation: spin 0.8s linear infinite;
  }

  .spinner.size-sm {
    width: 16px;
    height: 16px;
    border-width: 2px;
  }

  .spinner.size-md {
    width: 24px;
    height: 24px;
    border-width: 3px;
  }

  .spinner.size-lg {
    width: 40px;
    height: 40px;
    border-width: 4px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .text {
    color: var(--tc-text-secondary);
    font-size: var(--tc-font-size-sm);
  }

  .text.size-sm {
    font-size: var(--tc-font-size-xs);
  }

  .text.size-lg {
    font-size: var(--tc-font-size-base);
  }
`;

export class TCLoading extends TCElement {
  static get observedAttributes() {
    return ['size', 'text', 'overlay'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const size = this.getAttribute('size') || 'md';
    const text = this.getAttribute('text');

    const textHtml = text
      ? `<span class="text size-${size}">${text}</span>`
      : '';

    this.setContent(styles, `
      <div class="container">
        <div class="spinner size-${size}"></div>
        ${textHtml}
      </div>
    `);
  }
}

customElements.define('tc-loading', TCLoading);
