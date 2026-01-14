/**
 * TCurl Badge Component
 *
 * @element tc-badge
 * @attr {string} variant - 樣式: default | success | warning | error | info
 * @attr {string} size - 大小: sm | md
 * @attr {string} icon - Material Symbol 圖示名稱
 *
 * @slot - 標籤文字
 *
 * @example
 * <tc-badge variant="success" icon="check_circle">Active</tc-badge>
 * <tc-badge variant="warning">Pending</tc-badge>
 * <tc-badge variant="error" size="sm">Error</tc-badge>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: inline-block;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--tc-font-family);
    font-weight: 500;
    border-radius: var(--tc-radius-full);
    white-space: nowrap;
  }

  /* Sizes */
  .badge.size-sm {
    padding: 2px 8px;
    font-size: var(--tc-font-size-xs);
  }

  .badge.size-sm .icon {
    font-size: 12px;
  }

  .badge.size-md {
    padding: 4px 10px;
    font-size: var(--tc-font-size-sm);
  }

  .badge.size-md .icon {
    font-size: 14px;
  }

  /* Variants */
  .badge.variant-default {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--tc-text-muted);
  }

  .badge.variant-success {
    background-color: var(--tc-success-bg);
    color: var(--tc-success);
  }

  .badge.variant-warning {
    background-color: var(--tc-warning-bg);
    color: var(--tc-warning);
  }

  .badge.variant-error {
    background-color: var(--tc-error-bg);
    color: var(--tc-error);
  }

  .badge.variant-info {
    background-color: var(--tc-info-bg);
    color: var(--tc-info);
  }

  .badge.variant-primary {
    background-color: rgba(19, 55, 236, 0.2);
    color: var(--tc-primary);
  }

  .icon {
    line-height: 1;
  }
`;

export class TCBadge extends TCElement {
  static get observedAttributes() {
    return ['variant', 'size', 'icon'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const variant = this.getAttribute('variant') || 'default';
    const size = this.getAttribute('size') || 'md';
    const icon = this.getAttribute('icon');

    const iconHtml = icon
      ? `<span class="material-symbols-outlined icon">${icon}</span>`
      : '';

    this.setContent(styles, `
      <span class="badge variant-${variant} size-${size}">
        ${iconHtml}
        <slot></slot>
      </span>
    `);
  }
}

customElements.define('tc-badge', TCBadge);
