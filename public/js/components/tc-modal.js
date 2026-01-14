/**
 * TCurl Modal Component
 *
 * @element tc-modal
 * @attr {string} title - 彈窗標題
 * @attr {boolean} open - 是否開啟
 * @attr {string} size - 大小: sm | md | lg
 * @attr {boolean} closable - 是否可關閉 (預設 true)
 *
 * @slot - 彈窗內容
 * @slot footer - 彈窗底部（按鈕區）
 *
 * @event tc-close - 關閉時觸發
 *
 * @example
 * <tc-modal title="Confirm Delete" open>
 *   <p>Are you sure you want to delete this item?</p>
 *   <div slot="footer">
 *     <tc-button variant="secondary">Cancel</tc-button>
 *     <tc-button variant="danger">Delete</tc-button>
 *   </div>
 * </tc-modal>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: none;
  }

  :host([open]) {
    display: flex;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--tc-spacing-md);
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    background-color: var(--tc-background-elevated);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-xl);
    max-height: 90vh;
    overflow-y: auto;
    animation: slideIn 0.2s ease;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .modal.size-sm {
    width: 100%;
    max-width: 400px;
  }

  .modal.size-md {
    width: 100%;
    max-width: 500px;
  }

  .modal.size-lg {
    width: 100%;
    max-width: 640px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--tc-spacing-lg);
    border-bottom: 1px solid var(--tc-border);
  }

  .title {
    font-size: var(--tc-font-size-xl);
    font-weight: 700;
    color: var(--tc-text-primary);
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--tc-text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--tc-radius-md);
    transition: all var(--tc-transition-fast);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--tc-text-primary);
  }

  .content {
    padding: var(--tc-spacing-lg);
    color: var(--tc-text-secondary);
  }

  .footer {
    padding: var(--tc-spacing-lg);
    padding-top: var(--tc-spacing-md);
    border-top: 1px solid var(--tc-border);
    display: flex;
    gap: var(--tc-spacing-sm);
    justify-content: flex-end;
  }

  .footer:empty {
    display: none;
  }
`;

export class TCModal extends TCElement {
  static get observedAttributes() {
    return ['title', 'open', 'size', 'closable'];
  }

  connectedCallback() {
    this.render();
    this._handleKeydown = this._handleKeydown.bind(this);
    document.addEventListener('keydown', this._handleKeydown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._handleKeydown);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    this.render();
    if (name === 'open' && this.hasAttribute('open')) {
      // Focus trap
      requestAnimationFrame(() => {
        const firstFocusable = this.shadowRoot.querySelector('button, [tabindex]');
        firstFocusable?.focus();
      });
    }
  }

  _handleKeydown(e) {
    if (e.key === 'Escape' && this.hasAttribute('open')) {
      this.close();
    }
  }

  open() {
    this.setAttribute('open', '');
  }

  close() {
    const closable = !this.hasAttribute('closable') || this.getAttribute('closable') !== 'false';
    if (closable) {
      this.removeAttribute('open');
      this.emit('tc-close');
    }
  }

  render() {
    const title = this.getAttribute('title') || '';
    const size = this.getAttribute('size') || 'md';
    const closable = !this.hasAttribute('closable') || this.getAttribute('closable') !== 'false';

    const closeBtn = closable
      ? `<button class="close-btn" aria-label="Close">
           <span class="material-symbols-outlined">close</span>
         </button>`
      : '';

    this.setContent(styles, `
      <div class="backdrop">
        <div class="modal size-${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <header class="header">
            <h2 class="title" id="modal-title">${title}</h2>
            ${closeBtn}
          </header>
          <div class="content">
            <slot></slot>
          </div>
          <footer class="footer">
            <slot name="footer"></slot>
          </footer>
        </div>
      </div>
    `);

    // Event listeners
    this.$('.backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.close();
      }
    });

    this.$('.close-btn')?.addEventListener('click', () => {
      this.close();
    });
  }
}

customElements.define('tc-modal', TCModal);
