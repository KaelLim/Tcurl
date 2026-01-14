/**
 * TCurl Input Component
 *
 * @element tc-input
 * @attr {string} type - 輸入類型: text | email | password | number | url
 * @attr {string} label - 標籤文字
 * @attr {string} placeholder - 佔位符文字
 * @attr {string} value - 輸入值
 * @attr {boolean} disabled - 是否禁用
 * @attr {boolean} required - 是否必填
 * @attr {string} error - 錯誤訊息
 * @attr {string} icon - 前置圖示
 * @attr {number} maxlength - 最大長度
 *
 * @event tc-input - 輸入時觸發
 * @event tc-change - 值改變時觸發
 *
 * @example
 * <tc-input label="Email" type="email" placeholder="Enter email" required></tc-input>
 * <tc-input label="Password" type="password" icon="lock"></tc-input>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .input-wrapper {
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

  .input-container {
    position: relative;
    display: flex;
    align-items: center;
  }

  .icon {
    position: absolute;
    left: var(--tc-spacing-md);
    color: var(--tc-text-muted);
    font-size: 20px;
    pointer-events: none;
  }

  input {
    width: 100%;
    height: 44px;
    padding: 0 var(--tc-spacing-md);
    font-family: var(--tc-font-family);
    font-size: var(--tc-font-size-base);
    color: var(--tc-text-primary);
    background-color: var(--tc-background-card);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-lg);
    outline: none;
    transition: all var(--tc-transition-fast);
  }

  input:focus {
    border-color: var(--tc-primary);
    box-shadow: 0 0 0 2px rgba(19, 55, 236, 0.3);
  }

  input::placeholder {
    color: var(--tc-text-hint);
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input.has-icon {
    padding-left: 44px;
  }

  input.has-error {
    border-color: var(--tc-error);
  }

  input.has-error:focus {
    box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.3);
  }

  .error-message {
    font-size: var(--tc-font-size-sm);
    color: var(--tc-error);
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-xs);
  }

  .error-message .material-symbols-outlined {
    font-size: 16px;
  }
`;

export class TCInput extends TCElement {
  static get observedAttributes() {
    return ['type', 'label', 'placeholder', 'value', 'disabled', 'required', 'error', 'icon', 'maxlength'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  get value() {
    const input = this.$('input');
    return input ? input.value : this.getAttribute('value') || '';
  }

  set value(val) {
    const input = this.$('input');
    if (input) {
      input.value = val;
    }
    this.setAttribute('value', val);
  }

  render() {
    const type = this.getAttribute('type') || 'text';
    const label = this.getAttribute('label');
    const placeholder = this.getAttribute('placeholder') || '';
    const value = this.getAttribute('value') || '';
    const disabled = this.hasAttribute('disabled');
    const required = this.hasAttribute('required');
    const error = this.getAttribute('error');
    const icon = this.getAttribute('icon');
    const maxlength = this.getAttribute('maxlength');

    const labelHtml = label
      ? `<label>${label}${required ? '<span class="required">*</span>' : ''}</label>`
      : '';

    const iconHtml = icon
      ? `<span class="material-symbols-outlined icon">${icon}</span>`
      : '';

    const errorHtml = error
      ? `<div class="error-message"><span class="material-symbols-outlined">error</span>${error}</div>`
      : '';

    const inputClasses = [
      icon ? 'has-icon' : '',
      error ? 'has-error' : ''
    ].filter(Boolean).join(' ');

    this.setContent(styles, `
      <div class="input-wrapper">
        ${labelHtml}
        <div class="input-container">
          ${iconHtml}
          <input
            type="${type}"
            class="${inputClasses}"
            placeholder="${placeholder}"
            value="${value}"
            ${disabled ? 'disabled' : ''}
            ${required ? 'required' : ''}
            ${maxlength ? `maxlength="${maxlength}"` : ''}
          />
        </div>
        ${errorHtml}
      </div>
    `);

    // Event listeners
    const input = this.$('input');
    input.addEventListener('input', (e) => {
      this.setAttribute('value', e.target.value);
      this.emit('tc-input', { value: e.target.value });
    });
    input.addEventListener('change', (e) => {
      this.emit('tc-change', { value: e.target.value });
    });
  }

  focus() {
    this.$('input')?.focus();
  }

  blur() {
    this.$('input')?.blur();
  }
}

customElements.define('tc-input', TCInput);
