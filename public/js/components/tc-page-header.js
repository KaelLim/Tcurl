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
