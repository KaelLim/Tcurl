/**
 * TCurl Table Component
 *
 * @element tc-table
 * @attr {boolean} striped - 是否斑馬紋
 * @attr {boolean} hoverable - 是否 hover 效果
 * @attr {boolean} loading - 是否載入中
 *
 * @slot - tc-thead 和 tc-tbody 元素
 *
 * @example
 * <tc-table hoverable>
 *   <tc-thead>
 *     <tc-tr>
 *       <tc-th>Name</tc-th>
 *       <tc-th>Status</tc-th>
 *     </tc-tr>
 *   </tc-thead>
 *   <tc-tbody>
 *     <tc-tr>
 *       <tc-td>Item 1</tc-td>
 *       <tc-td>Active</tc-td>
 *     </tc-tr>
 *   </tc-tbody>
 * </tc-table>
 */

import { TCElement } from './base.js';

// Table container styles
const tableStyles = `
  :host {
    display: block;
    width: 100%;
  }

  .table-container {
    overflow: hidden;
    border-radius: var(--tc-radius-xl);
    border: 1px solid var(--tc-border);
    background-color: var(--tc-background-card);
  }

  .table-wrapper {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  /* Loading overlay */
  .loading-overlay {
    position: absolute;
    inset: 0;
    background-color: rgba(17, 18, 24, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }

  .loading-overlay.hidden {
    display: none;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid transparent;
    border-top-color: var(--tc-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .table-container {
    position: relative;
  }
`;

export class TCTable extends TCElement {
  static get observedAttributes() {
    return ['striped', 'hoverable', 'loading'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const loading = this.hasAttribute('loading');

    this.setContent(tableStyles, `
      <div class="table-container">
        <div class="loading-overlay ${loading ? '' : 'hidden'}">
          <div class="spinner"></div>
        </div>
        <div class="table-wrapper">
          <table>
            <slot></slot>
          </table>
        </div>
      </div>
    `);
  }
}

// Table Head
const theadStyles = `
  :host {
    display: table-header-group;
  }

  ::slotted(tc-tr) {
    background-color: var(--tc-background-elevated);
  }
`;

export class TCThead extends TCElement {
  connectedCallback() {
    this.setContent(theadStyles, `<slot></slot>`);
  }
}

// Table Body
const tbodyStyles = `
  :host {
    display: table-row-group;
  }

  ::slotted(tc-tr) {
    border-top: 1px solid var(--tc-border);
  }

  ::slotted(tc-tr:first-child) {
    border-top: none;
  }
`;

export class TCTbody extends TCElement {
  connectedCallback() {
    this.setContent(tbodyStyles, `<slot></slot>`);
  }
}

// Table Row
const trStyles = `
  :host {
    display: table-row;
    transition: background-color var(--tc-transition-fast);
  }

  :host(.hoverable:hover) {
    background-color: var(--tc-background-elevated);
  }

  :host(.clickable) {
    cursor: pointer;
  }
`;

export class TCTr extends TCElement {
  static get observedAttributes() {
    return ['href'];
  }

  connectedCallback() {
    this.render();

    // Check parent table for hoverable attribute
    const table = this.closest('tc-table');
    if (table?.hasAttribute('hoverable')) {
      this.classList.add('hoverable');
    }

    // Handle click
    const href = this.getAttribute('href');
    if (href) {
      this.classList.add('clickable');
      this.addEventListener('click', () => {
        window.location.href = href;
      });
    }
  }

  render() {
    this.setContent(trStyles, `<slot></slot>`);
  }
}

// Table Header Cell
const thStyles = `
  :host {
    display: table-cell;
    padding: var(--tc-spacing-md) var(--tc-spacing-lg);
    text-align: left;
    font-size: var(--tc-font-size-base);
    font-weight: 500;
    color: var(--tc-text-primary);
    white-space: nowrap;
  }

  :host([align="center"]) {
    text-align: center;
  }

  :host([align="right"]) {
    text-align: right;
  }

  :host([width]) {
    width: attr(width);
  }
`;

export class TCTh extends TCElement {
  static get observedAttributes() {
    return ['align', 'width'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const width = this.getAttribute('width');
    const widthStyle = width ? `width: ${width};` : '';

    this.setContent(thStyles + (widthStyle ? `:host { ${widthStyle} }` : ''), `<slot></slot>`);
  }
}

// Table Data Cell
const tdStyles = `
  :host {
    display: table-cell;
    padding: var(--tc-spacing-md) var(--tc-spacing-lg);
    font-size: var(--tc-font-size-base);
    color: var(--tc-text-secondary);
    vertical-align: middle;
  }

  :host([align="center"]) {
    text-align: center;
  }

  :host([align="right"]) {
    text-align: right;
  }

  :host([truncate]) {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export class TCTd extends TCElement {
  static get observedAttributes() {
    return ['align', 'truncate'];
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.setContent(tdStyles, `<slot></slot>`);
  }
}

// Register all table components
customElements.define('tc-table', TCTable);
customElements.define('tc-thead', TCThead);
customElements.define('tc-tbody', TCTbody);
customElements.define('tc-tr', TCTr);
customElements.define('tc-th', TCTh);
customElements.define('tc-td', TCTd);
