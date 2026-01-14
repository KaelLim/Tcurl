/**
 * TCurl Dropdown Component
 *
 * @element tc-dropdown
 * @attr {string} position - 位置: bottom-left | bottom-right | top-left | top-right
 * @attr {boolean} open - 是否開啟
 *
 * @slot trigger - 觸發按鈕
 * @slot - 下拉選單內容
 *
 * @event tc-select - 選擇選項時觸發
 *
 * @example
 * <tc-dropdown>
 *   <tc-button slot="trigger" variant="ghost" icon="more_vert"></tc-button>
 *   <tc-dropdown-item icon="edit">Edit</tc-dropdown-item>
 *   <tc-dropdown-item icon="delete" variant="danger">Delete</tc-dropdown-item>
 * </tc-dropdown>
 */

import { TCElement } from './base.js';

const dropdownStyles = `
  :host {
    position: relative;
    display: inline-block;
  }

  .trigger {
    cursor: pointer;
  }

  .menu {
    position: absolute;
    min-width: 160px;
    background-color: var(--tc-background-elevated);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-lg);
    box-shadow: var(--tc-shadow-lg);
    padding: var(--tc-spacing-xs) 0;
    z-index: 100;
    opacity: 0;
    visibility: hidden;
    transform: translateY(-8px);
    transition: all var(--tc-transition-fast);
  }

  .menu.open {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }

  /* Positions */
  .menu.bottom-left {
    top: 100%;
    left: 0;
    margin-top: var(--tc-spacing-xs);
  }

  .menu.bottom-right {
    top: 100%;
    right: 0;
    margin-top: var(--tc-spacing-xs);
  }

  .menu.top-left {
    bottom: 100%;
    left: 0;
    margin-bottom: var(--tc-spacing-xs);
  }

  .menu.top-right {
    bottom: 100%;
    right: 0;
    margin-bottom: var(--tc-spacing-xs);
  }
`;

export class TCDropdown extends TCElement {
  static get observedAttributes() {
    return ['position', 'open'];
  }

  connectedCallback() {
    this.render();
    this._handleOutsideClick = this._handleOutsideClick.bind(this);
    document.addEventListener('click', this._handleOutsideClick);
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._handleOutsideClick);
  }

  attributeChangedCallback() {
    this.render();
  }

  _handleOutsideClick(e) {
    if (!this.contains(e.target)) {
      this.close();
    }
  }

  toggle() {
    if (this.hasAttribute('open')) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.setAttribute('open', '');
    this.$('.menu')?.classList.add('open');
  }

  close() {
    this.removeAttribute('open');
    this.$('.menu')?.classList.remove('open');
  }

  render() {
    const position = this.getAttribute('position') || 'bottom-left';
    const isOpen = this.hasAttribute('open');

    this.setContent(dropdownStyles, `
      <div class="trigger">
        <slot name="trigger"></slot>
      </div>
      <div class="menu ${position} ${isOpen ? 'open' : ''}">
        <slot></slot>
      </div>
    `);

    // Toggle on trigger click
    this.$('.trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
  }
}

// Dropdown Item
const itemStyles = `
  :host {
    display: block;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-sm);
    padding: var(--tc-spacing-sm) var(--tc-spacing-md);
    font-size: var(--tc-font-size-sm);
    color: var(--tc-text-secondary);
    cursor: pointer;
    transition: all var(--tc-transition-fast);
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    font-family: var(--tc-font-family);
  }

  .item:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--tc-text-primary);
  }

  .item.variant-danger {
    color: var(--tc-error);
  }

  .item.variant-danger:hover {
    background-color: var(--tc-error-bg);
  }

  .item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon {
    font-size: 18px;
  }
`;

export class TCDropdownItem extends TCElement {
  static get observedAttributes() {
    return ['icon', 'variant', 'disabled'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const icon = this.getAttribute('icon');
    const variant = this.getAttribute('variant') || 'default';
    const disabled = this.hasAttribute('disabled');

    const iconHtml = icon
      ? `<span class="material-symbols-outlined icon">${icon}</span>`
      : '';

    this.setContent(itemStyles, `
      <button class="item variant-${variant}" ${disabled ? 'disabled' : ''}>
        ${iconHtml}
        <slot></slot>
      </button>
    `);

    this.$('button').addEventListener('click', () => {
      if (!disabled) {
        // Close parent dropdown
        const dropdown = this.closest('tc-dropdown');
        dropdown?.close();

        // Emit event
        this.emit('tc-select', { item: this });
      }
    });
  }
}

// Dropdown Divider
const dividerStyles = `
  :host {
    display: block;
    height: 1px;
    background-color: var(--tc-border);
    margin: var(--tc-spacing-xs) 0;
  }
`;

export class TCDropdownDivider extends TCElement {
  connectedCallback() {
    this.setContent(dividerStyles, '');
  }
}

customElements.define('tc-dropdown', TCDropdown);
customElements.define('tc-dropdown-item', TCDropdownItem);
customElements.define('tc-dropdown-divider', TCDropdownDivider);
