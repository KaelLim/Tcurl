/**
 * TCurl Textarea Component
 *
 * @element tc-textarea
 * @attr {string} label - 標籤文字
 * @attr {string} placeholder - 佔位符文字
 * @attr {string} value - 輸入值
 * @attr {boolean} disabled - 是否禁用
 * @attr {boolean} required - 是否必填
 * @attr {string} error - 錯誤訊息
 * @attr {number} rows - 行數 (預設 4)
 * @attr {number} maxlength - 最大長度
 * @attr {boolean} resize - 是否可調整大小 (預設 false)
 *
 * @event tc-input - 輸入時觸發
 * @event tc-change - 值改變時觸發
 *
 * @example
 * <tc-textarea label="Description" placeholder="Enter description..." rows="5"></tc-textarea>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .textarea-wrapper {
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

  .textarea-container {
    position: relative;
  }

  textarea {
    width: 100%;
    padding: var(--tc-spacing-md);
    font-family: var(--tc-font-family);
    font-size: var(--tc-font-size-base);
    color: var(--tc-text-primary);
    background-color: var(--tc-background-card);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-lg);
    outline: none;
    transition: all var(--tc-transition-fast);
    resize: none;
    line-height: 1.5;
  }

  textarea.resizable {
    resize: vertical;
  }

  textarea:focus {
    border-color: var(--tc-primary);
    box-shadow: 0 0 0 2px rgba(19, 55, 236, 0.3);
  }

  textarea::placeholder {
    color: var(--tc-text-hint);
  }

  textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  textarea.has-error {
    border-color: var(--tc-error);
  }

  textarea.has-error:focus {
    box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.3);
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
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

  .char-count {
    font-size: var(--tc-font-size-xs);
    color: var(--tc-text-hint);
  }

  .char-count.warning {
    color: var(--tc-warning);
  }

  .char-count.error {
    color: var(--tc-error);
  }
`;

export class TCTextarea extends TCElement {
  static get observedAttributes() {
    return ['label', 'placeholder', 'value', 'disabled', 'required', 'error', 'rows', 'maxlength', 'resize'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  get value() {
    const textarea = this.$('textarea');
    return textarea ? textarea.value : this.getAttribute('value') || '';
  }

  set value(val) {
    const textarea = this.$('textarea');
    if (textarea) {
      textarea.value = val;
    }
    this.setAttribute('value', val);
  }

  render() {
    const label = this.getAttribute('label');
    const placeholder = this.getAttribute('placeholder') || '';
    const value = this.getAttribute('value') || '';
    const disabled = this.hasAttribute('disabled');
    const required = this.hasAttribute('required');
    const error = this.getAttribute('error');
    const rows = this.getAttribute('rows') || '4';
    const maxlength = this.getAttribute('maxlength');
    const resize = this.hasAttribute('resize');

    const labelHtml = label
      ? `<label>${label}${required ? '<span class="required">*</span>' : ''}</label>`
      : '';

    const errorHtml = error
      ? `<div class="error-message"><span class="material-symbols-outlined">error</span>${error}</div>`
      : '<div></div>';

    const charCountHtml = maxlength
      ? `<span class="char-count">${value.length}/${maxlength}</span>`
      : '';

    const textareaClasses = [
      error ? 'has-error' : '',
      resize ? 'resizable' : ''
    ].filter(Boolean).join(' ');

    this.setContent(styles, `
      <div class="textarea-wrapper">
        ${labelHtml}
        <div class="textarea-container">
          <textarea
            class="${textareaClasses}"
            placeholder="${placeholder}"
            rows="${rows}"
            ${disabled ? 'disabled' : ''}
            ${required ? 'required' : ''}
            ${maxlength ? `maxlength="${maxlength}"` : ''}
          >${value}</textarea>
        </div>
        <div class="footer">
          ${errorHtml}
          ${charCountHtml}
        </div>
      </div>
    `);

    // Event listeners
    const textarea = this.$('textarea');
    textarea.addEventListener('input', (e) => {
      this.setAttribute('value', e.target.value);
      this.emit('tc-input', { value: e.target.value });
      this._updateCharCount(e.target.value.length);
    });
    textarea.addEventListener('change', (e) => {
      this.emit('tc-change', { value: e.target.value });
    });
  }

  _updateCharCount(length) {
    const maxlength = parseInt(this.getAttribute('maxlength'), 10);
    if (!maxlength) return;

    const charCount = this.$('.char-count');
    if (charCount) {
      charCount.textContent = `${length}/${maxlength}`;
      charCount.classList.remove('warning', 'error');
      if (length >= maxlength) {
        charCount.classList.add('error');
      } else if (length >= maxlength * 0.9) {
        charCount.classList.add('warning');
      }
    }
  }

  focus() {
    this.$('textarea')?.focus();
  }

  blur() {
    this.$('textarea')?.blur();
  }
}

customElements.define('tc-textarea', TCTextarea);
