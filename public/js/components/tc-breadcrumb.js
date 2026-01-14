/**
 * TCurl Breadcrumb Component
 *
 * @element tc-breadcrumb
 *
 * @slot - tc-breadcrumb-item 元素
 *
 * @example
 * <tc-breadcrumb>
 *   <tc-breadcrumb-item href="/links">我的連結</tc-breadcrumb-item>
 *   <tc-breadcrumb-item>編輯連結</tc-breadcrumb-item>
 * </tc-breadcrumb>
 */

import { TCElement } from './base.js';

const breadcrumbStyles = `
  :host {
    display: block;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-sm);
    font-size: var(--tc-font-size-sm);
  }

  ::slotted(tc-breadcrumb-item:not(:last-child))::after {
    content: '/';
    margin-left: var(--tc-spacing-sm);
    color: var(--tc-text-hint);
  }
`;

export class TCBreadcrumb extends TCElement {
  connectedCallback() {
    this.render();
  }

  render() {
    this.setContent(breadcrumbStyles, `
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <slot></slot>
      </nav>
    `);
  }
}

// Breadcrumb Item
const itemStyles = `
  :host {
    display: inline-flex;
    align-items: center;
  }

  a, span {
    color: var(--tc-text-hint);
    text-decoration: none;
    transition: color var(--tc-transition-fast);
  }

  a:hover {
    color: var(--tc-text-primary);
  }

  :host(:last-child) span,
  :host(:last-child) a {
    color: var(--tc-text-primary);
    font-weight: 500;
  }

  .icon {
    font-size: 16px;
    margin-right: var(--tc-spacing-xs);
  }

  .separator {
    margin: 0 var(--tc-spacing-sm);
    color: var(--tc-text-hint);
  }
`;

export class TCBreadcrumbItem extends TCElement {
  static get observedAttributes() {
    return ['href', 'icon'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const href = this.getAttribute('href');
    const icon = this.getAttribute('icon');

    const iconHtml = icon
      ? `<span class="material-symbols-outlined icon">${icon}</span>`
      : '';

    // Check if this is the last item
    const isLast = !this.nextElementSibling;
    const separatorHtml = isLast ? '' : `<span class="separator">/</span>`;

    if (href) {
      this.setContent(itemStyles, `
        <a href="${href}">
          ${iconHtml}
          <slot></slot>
        </a>
        ${separatorHtml}
      `);
    } else {
      this.setContent(itemStyles, `
        <span>
          ${iconHtml}
          <slot></slot>
        </span>
        ${separatorHtml}
      `);
    }
  }
}

customElements.define('tc-breadcrumb', TCBreadcrumb);
customElements.define('tc-breadcrumb-item', TCBreadcrumbItem);
