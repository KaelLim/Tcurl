/**
 * TCurl Select Component
 *
 * @element tc-select
 * @attr {string} label - 標籤文字
 * @attr {string} value - 選中值
 * @attr {boolean} disabled - 是否禁用
 * @attr {boolean} required - 是否必填
 * @attr {string} placeholder - 佔位符文字
 *
 * @slot - tc-option 元素
 *
 * @event tc-change - 值改變時觸發
 *
 * @example
 * <tc-select label="Category" value="suggestion">
 *   <tc-option value="suggestion">Suggestion</tc-option>
 *   <tc-option value="bug">Bug</tc-option>
 * </tc-select>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .select-wrapper {
    display: flex;
    flex-direction: column;
    gap: var(--tc-spacing-sm);
  }

  label {
    font-size: var(--tc-font-size-sm);
    font-weight: 500;
    color: var(--tc-text-primary);
  }

  .required {
    color: var(--tc-error);
    margin-left: 2px;
  }

  .select-container {
    position: relative;
  }

  select {
    width: 100%;
    height: 44px;
    padding: 0 40px 0 var(--tc-spacing-md);
    font-family: var(--tc-font-family);
    font-size: var(--tc-font-size-base);
    color: var(--tc-text-primary);
    background-color: var(--tc-background-card);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-lg);
    outline: none;
    cursor: pointer;
    appearance: none;
    transition: all var(--tc-transition-fast);
  }

  select:focus {
    border-color: var(--tc-primary);
    box-shadow: 0 0 0 2px rgba(19, 55, 236, 0.3);
  }

  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  select option {
    background-color: var(--tc-background-card);
    color: var(--tc-text-primary);
    padding: var(--tc-spacing-sm);
  }

  .arrow {
    position: absolute;
    right: var(--tc-spacing-md);
    top: 50%;
    transform: translateY(-50%);
    color: var(--tc-text-muted);
    pointer-events: none;
    font-size: 20px;
  }
`;

export class TCSelect extends TCElement {
  static get observedAttributes() {
    return ['label', 'value', 'disabled', 'required', 'placeholder'];
  }

  connectedCallback() {
    this.render();
    this._observer = new MutationObserver(() => this.render());
    this._observer.observe(this, { childList: true, subtree: true });
  }

  disconnectedCallback() {
    this._observer?.disconnect();
  }

  attributeChangedCallback() {
    this.render();
  }

  get value() {
    const select = this.$('select');
    return select ? select.value : this.getAttribute('value') || '';
  }

  set value(val) {
    const select = this.$('select');
    if (select) {
      select.value = val;
    }
    this.setAttribute('value', val);
  }

  render() {
    const label = this.getAttribute('label');
    const value = this.getAttribute('value') || '';
    const disabled = this.hasAttribute('disabled');
    const required = this.hasAttribute('required');
    const placeholder = this.getAttribute('placeholder');

    const labelHtml = label
      ? `<label>${label}${required ? '<span class="required">*</span>' : ''}</label>`
      : '';

    // Get options from tc-option or native option children
    const tcOptions = Array.from(this.querySelectorAll('tc-option'));
    const nativeOptions = Array.from(this.querySelectorAll(':scope > option'));
    const options = tcOptions.length > 0 ? tcOptions : nativeOptions;

    const optionsHtml = options.map(opt => {
      const optValue = opt.getAttribute('value') || '';
      const optLabel = opt.textContent || optValue;
      const selected = optValue === value ? 'selected' : '';
      return `<option value="${optValue}" ${selected}>${optLabel}</option>`;
    }).join('');

    const placeholderHtml = placeholder
      ? `<option value="" disabled ${!value ? 'selected' : ''}>${placeholder}</option>`
      : '';

    this.setContent(styles, `
      <div class="select-wrapper">
        ${labelHtml}
        <div class="select-container">
          <select
            ${disabled ? 'disabled' : ''}
            ${required ? 'required' : ''}
          >
            ${placeholderHtml}
            ${optionsHtml}
          </select>
          <span class="material-symbols-outlined arrow">expand_more</span>
        </div>
      </div>
    `);

    // Event listener
    const select = this.$('select');
    select.addEventListener('change', (e) => {
      this.setAttribute('value', e.target.value);
      this.emit('tc-change', { value: e.target.value });
    });
  }
}

// tc-option is just for defining options, doesn't render anything
class TCOption extends HTMLElement {
  static get observedAttributes() {
    return ['value'];
  }
}

customElements.define('tc-select', TCSelect);
customElements.define('tc-option', TCOption);
