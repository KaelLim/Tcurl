/**
 * TCurl Toggle Component
 *
 * @element tc-toggle
 * @attr {boolean} checked - 是否開啟
 * @attr {boolean} disabled - 是否禁用
 * @attr {string} label - 標籤文字
 * @attr {string} description - 說明文字
 *
 * @event tc-change - 狀態改變時觸發
 *
 * @example
 * <tc-toggle label="啟用連結" checked></tc-toggle>
 * <tc-toggle label="密碼保護" description="需要密碼才能訪問此連結"></tc-toggle>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .toggle-wrapper {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--tc-spacing-md);
  }

  .toggle-content {
    flex: 1;
  }

  .toggle-label {
    font-size: var(--tc-font-size-sm);
    font-weight: 500;
    color: var(--tc-text-primary);
    cursor: pointer;
  }

  .toggle-description {
    font-size: var(--tc-font-size-xs);
    color: var(--tc-text-hint);
    margin-top: var(--tc-spacing-xs);
  }

  /* Toggle Switch */
  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }

  .toggle-input {
    position: absolute;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
    z-index: 1;
    margin: 0;
  }

  .toggle-track {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: var(--tc-radius-full);
    transition: background-color var(--tc-transition-fast);
  }

  .toggle-input:checked + .toggle-track {
    background-color: var(--tc-primary);
  }

  .toggle-input:disabled + .toggle-track {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background-color: white;
    border-radius: 50%;
    transition: transform var(--tc-transition-fast);
    pointer-events: none;
  }

  .toggle-input:checked ~ .toggle-thumb {
    transform: translateX(20px);
  }

  /* Focus ring */
  .toggle-input:focus-visible + .toggle-track {
    outline: 2px solid var(--tc-primary);
    outline-offset: 2px;
  }

  /* Disabled state */
  :host([disabled]) .toggle-label {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :host([disabled]) .toggle-input {
    cursor: not-allowed;
  }
`;

export class TCToggle extends TCElement {
  static get observedAttributes() {
    return ['checked', 'disabled', 'label', 'description'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  get checked() {
    return this.hasAttribute('checked');
  }

  set checked(value) {
    if (value) {
      this.setAttribute('checked', '');
    } else {
      this.removeAttribute('checked');
    }
  }

  toggle() {
    if (!this.hasAttribute('disabled')) {
      this.checked = !this.checked;
      this.emit('tc-change', { checked: this.checked });
    }
  }

  render() {
    const label = this.getAttribute('label') || '';
    const description = this.getAttribute('description') || '';
    const checked = this.hasAttribute('checked');
    const disabled = this.hasAttribute('disabled');
    const id = `toggle-${Math.random().toString(36).substr(2, 9)}`;

    const descriptionHtml = description
      ? `<div class="toggle-description">${description}</div>`
      : '';

    this.setContent(styles, `
      <div class="toggle-wrapper">
        <div class="toggle-content">
          <label class="toggle-label" for="${id}">${label}</label>
          ${descriptionHtml}
        </div>
        <div class="toggle-switch">
          <input
            type="checkbox"
            id="${id}"
            class="toggle-input"
            ${checked ? 'checked' : ''}
            ${disabled ? 'disabled' : ''}
          />
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </div>
      </div>
    `);

    // Event listener
    const input = this.$('.toggle-input');
    input.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.setAttribute('checked', '');
      } else {
        this.removeAttribute('checked');
      }
      this.emit('tc-change', { checked: e.target.checked });
    });
  }
}

customElements.define('tc-toggle', TCToggle);
