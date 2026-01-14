/**
 * TCurl Card Component
 *
 * @element tc-card
 * @attr {string} variant - 樣式: default | elevated | interactive
 * @attr {boolean} padding - 是否有內距 (預設 true)
 * @attr {string} href - 連結網址（設定後變為可點擊）
 *
 * @slot header - 卡片標題區
 * @slot - 卡片內容
 * @slot footer - 卡片底部區
 *
 * @example
 * <tc-card>
 *   <span slot="header">Card Title</span>
 *   <p>Card content goes here</p>
 * </tc-card>
 *
 * <tc-card variant="interactive" href="/detail">
 *   Click me
 * </tc-card>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .card {
    background-color: var(--tc-background-card);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-xl);
    overflow: hidden;
    transition: all var(--tc-transition-fast);
  }

  .card.variant-elevated {
    background-color: var(--tc-background-elevated);
  }

  .card.variant-interactive {
    cursor: pointer;
  }

  .card.variant-interactive:hover {
    background-color: var(--tc-background-elevated);
  }

  .card.has-padding {
    padding: var(--tc-spacing-lg);
  }

  .card.has-padding .header {
    padding: 0;
    padding-bottom: var(--tc-spacing-md);
    border-bottom: 1px solid var(--tc-border);
    margin-bottom: var(--tc-spacing-md);
  }

  .card.has-padding .footer {
    padding: 0;
    padding-top: var(--tc-spacing-md);
    border-top: 1px solid var(--tc-border);
    margin-top: var(--tc-spacing-md);
  }

  .card:not(.has-padding) .header {
    padding: var(--tc-spacing-md) var(--tc-spacing-lg);
    background-color: var(--tc-background-elevated);
    border-bottom: 1px solid var(--tc-border);
  }

  .card:not(.has-padding) .content {
    padding: var(--tc-spacing-lg);
  }

  .card:not(.has-padding) .footer {
    padding: var(--tc-spacing-md) var(--tc-spacing-lg);
    border-top: 1px solid var(--tc-border);
  }

  .header:empty,
  .footer:empty {
    display: none;
  }

  ::slotted([slot="header"]) {
    font-size: var(--tc-font-size-lg);
    font-weight: 600;
    color: var(--tc-text-primary);
  }

  a.card-link {
    text-decoration: none;
    color: inherit;
    display: block;
  }
`;

export class TCCard extends TCElement {
  static get observedAttributes() {
    return ['variant', 'padding', 'href'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const variant = this.getAttribute('variant') || 'default';
    const hasPadding = !this.hasAttribute('padding') || this.getAttribute('padding') !== 'false';
    const href = this.getAttribute('href');

    const classes = [
      'card',
      `variant-${variant}`,
      hasPadding ? 'has-padding' : ''
    ].filter(Boolean).join(' ');

    const content = `
      <div class="header">
        <slot name="header"></slot>
      </div>
      <div class="content">
        <slot></slot>
      </div>
      <div class="footer">
        <slot name="footer"></slot>
      </div>
    `;

    const html = href
      ? `<a href="${href}" class="card-link"><div class="${classes}">${content}</div></a>`
      : `<div class="${classes}">${content}</div>`;

    this.setContent(styles, html);

    // Click event for interactive cards
    if (variant === 'interactive' && !href) {
      this.$('.card').addEventListener('click', () => {
        this.emit('tc-click');
      });
    }
  }
}

customElements.define('tc-card', TCCard);
