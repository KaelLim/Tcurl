/**
 * TCurl Empty State Component
 *
 * @element tc-empty-state
 * @attr {string} icon - Material Symbol 圖示名稱
 * @attr {string} title - 標題
 * @attr {string} description - 描述文字
 *
 * @slot - 操作按鈕區
 *
 * @example
 * <tc-empty-state
 *   icon="folder_open"
 *   title="No items found"
 *   description="Create your first item to get started"
 * >
 *   <tc-button variant="primary" icon="add">Create New</tc-button>
 * </tc-empty-state>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--tc-spacing-xl) var(--tc-spacing-md);
  }

  .icon {
    font-size: 64px;
    color: var(--tc-text-hint);
    opacity: 0.5;
    margin-bottom: var(--tc-spacing-md);
  }

  .title {
    font-size: var(--tc-font-size-lg);
    font-weight: 600;
    color: var(--tc-text-secondary);
    margin: 0 0 var(--tc-spacing-sm) 0;
  }

  .description {
    font-size: var(--tc-font-size-sm);
    color: var(--tc-text-muted);
    margin: 0 0 var(--tc-spacing-lg) 0;
    max-width: 400px;
  }

  .actions {
    display: flex;
    gap: var(--tc-spacing-sm);
  }
`;

export class TCEmptyState extends TCElement {
  static get observedAttributes() {
    return ['icon', 'title', 'description'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const icon = this.getAttribute('icon') || 'inbox';
    const title = this.getAttribute('title') || '';
    const description = this.getAttribute('description') || '';

    const titleHtml = title
      ? `<h3 class="title">${title}</h3>`
      : '';

    const descriptionHtml = description
      ? `<p class="description">${description}</p>`
      : '';

    this.setContent(styles, `
      <div class="empty-state">
        <span class="material-symbols-outlined icon">${icon}</span>
        ${titleHtml}
        ${descriptionHtml}
        <div class="actions">
          <slot></slot>
        </div>
      </div>
    `);
  }
}

customElements.define('tc-empty-state', TCEmptyState);
