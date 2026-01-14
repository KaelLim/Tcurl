/**
 * TCurl Pagination Component
 *
 * @element tc-pagination
 * @attr {number} current - 當前頁碼
 * @attr {number} total - 總頁數
 * @attr {number} siblings - 顯示的鄰近頁數 (預設 1)
 *
 * @event tc-page-change - 頁碼改變時觸發
 *
 * @example
 * <tc-pagination current="1" total="10"></tc-pagination>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .pagination {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-xs);
  }

  .page-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
    padding: 0 var(--tc-spacing-sm);
    font-family: var(--tc-font-family);
    font-size: var(--tc-font-size-sm);
    font-weight: 500;
    color: var(--tc-text-secondary);
    background-color: transparent;
    border: 1px solid transparent;
    border-radius: var(--tc-radius-md);
    cursor: pointer;
    transition: all var(--tc-transition-fast);
  }

  .page-btn:hover:not(:disabled) {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--tc-text-primary);
  }

  .page-btn.active {
    background-color: var(--tc-primary);
    color: var(--tc-text-primary);
    border-color: var(--tc-primary);
  }

  .page-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .page-btn .icon {
    font-size: 20px;
  }

  .ellipsis {
    color: var(--tc-text-hint);
    padding: 0 var(--tc-spacing-xs);
  }
`;

export class TCPagination extends TCElement {
  static get observedAttributes() {
    return ['current', 'total', 'siblings'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  _getPageNumbers() {
    const current = parseInt(this.getAttribute('current') || '1', 10);
    const total = parseInt(this.getAttribute('total') || '1', 10);
    const siblings = parseInt(this.getAttribute('siblings') || '1', 10);

    const pages = [];

    // Always show first page
    pages.push(1);

    // Calculate range around current page
    const leftSibling = Math.max(2, current - siblings);
    const rightSibling = Math.min(total - 1, current + siblings);

    // Add ellipsis or pages between first and left sibling
    if (leftSibling > 2) {
      pages.push('...');
    } else if (leftSibling === 2) {
      pages.push(2);
    }

    // Add pages in the middle
    for (let i = leftSibling; i <= rightSibling; i++) {
      if (i !== 1 && i !== total) {
        pages.push(i);
      }
    }

    // Add ellipsis or pages between right sibling and last
    if (rightSibling < total - 1) {
      pages.push('...');
    } else if (rightSibling === total - 1) {
      pages.push(total - 1);
    }

    // Always show last page (if more than 1 page)
    if (total > 1) {
      pages.push(total);
    }

    return pages;
  }

  _goToPage(page) {
    const total = parseInt(this.getAttribute('total') || '1', 10);
    const newPage = Math.max(1, Math.min(total, page));
    this.setAttribute('current', newPage.toString());
    this.emit('tc-page-change', { page: newPage });
  }

  render() {
    const current = parseInt(this.getAttribute('current') || '1', 10);
    const total = parseInt(this.getAttribute('total') || '1', 10);
    const pages = this._getPageNumbers();

    const prevDisabled = current <= 1 ? 'disabled' : '';
    const nextDisabled = current >= total ? 'disabled' : '';

    const pagesHtml = pages.map(page => {
      if (page === '...') {
        return `<span class="ellipsis">...</span>`;
      }
      const isActive = page === current ? 'active' : '';
      return `<button class="page-btn ${isActive}" data-page="${page}">${page}</button>`;
    }).join('');

    this.setContent(styles, `
      <nav class="pagination" aria-label="Pagination">
        <button class="page-btn" data-action="prev" ${prevDisabled}>
          <span class="material-symbols-outlined icon">chevron_left</span>
        </button>
        ${pagesHtml}
        <button class="page-btn" data-action="next" ${nextDisabled}>
          <span class="material-symbols-outlined icon">chevron_right</span>
        </button>
      </nav>
    `);

    // Event listeners
    this.$$('.page-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page, 10);
        this._goToPage(page);
      });
    });

    this.$('[data-action="prev"]')?.addEventListener('click', () => {
      this._goToPage(current - 1);
    });

    this.$('[data-action="next"]')?.addEventListener('click', () => {
      this._goToPage(current + 1);
    });
  }
}

customElements.define('tc-pagination', TCPagination);
