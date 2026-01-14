/**
 * TCurl Page Header Component
 *
 * @element tc-page-header
 * @attr {string} title - 頁面標題
 * @attr {string} subtitle - 頁面副標題/描述
 *
 * @slot actions - 右側操作按鈕區
 *
 * @example
 * <tc-page-header title="My Links" subtitle="Manage your short URLs">
 *   <tc-button slot="actions" variant="primary" icon="add">Create New</tc-button>
 * </tc-page-header>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
    margin-bottom: var(--tc-spacing-lg);
  }

  .header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--tc-spacing-md);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .title {
    font-size: var(--tc-font-size-4xl);
    font-weight: 900;
    color: var(--tc-text-primary);
    line-height: 1.2;
    letter-spacing: -0.033em;
    margin: 0;
  }

  .subtitle {
    font-size: var(--tc-font-size-base);
    font-weight: 400;
    color: var(--tc-text-hint);
    margin: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-sm);
  }
`;

export class TCPageHeader extends TCElement {
  static get observedAttributes() {
    return ['title', 'subtitle'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const title = this.getAttribute('title') || '';
    const subtitle = this.getAttribute('subtitle');

    const subtitleHtml = subtitle
      ? `<p class="subtitle">${subtitle}</p>`
      : '';

    this.setContent(styles, `
      <header class="header">
        <div class="text">
          <h1 class="title">${title}</h1>
          ${subtitleHtml}
        </div>
        <div class="actions">
          <slot name="actions"></slot>
        </div>
      </header>
    `);
  }
}

customElements.define('tc-page-header', TCPageHeader);
