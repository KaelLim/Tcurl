/**
 * TCurl Skeleton Component
 *
 * @element tc-skeleton
 * @attr {string} variant - 樣式: text | circle | rect | card
 * @attr {string} width - 寬度
 * @attr {string} height - 高度
 * @attr {number} lines - 行數 (僅 text variant)
 *
 * @example
 * <tc-skeleton variant="text" lines="3"></tc-skeleton>
 * <tc-skeleton variant="circle" width="48px" height="48px"></tc-skeleton>
 * <tc-skeleton variant="rect" width="100%" height="200px"></tc-skeleton>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .skeleton {
    background: linear-gradient(
      90deg,
      var(--tc-background-elevated) 25%,
      rgba(255, 255, 255, 0.1) 50%,
      var(--tc-background-elevated) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* Variants */
  .skeleton.text {
    height: 16px;
    border-radius: var(--tc-radius-sm);
    margin-bottom: var(--tc-spacing-sm);
  }

  .skeleton.text:last-child {
    margin-bottom: 0;
    width: 60%;
  }

  .skeleton.circle {
    border-radius: 50%;
  }

  .skeleton.rect {
    border-radius: var(--tc-radius-lg);
  }

  .skeleton.card {
    border-radius: var(--tc-radius-xl);
    border: 1px solid var(--tc-border);
  }

  /* Container for text lines */
  .lines-container {
    display: flex;
    flex-direction: column;
  }
`;

export class TCSkeleton extends TCElement {
  static get observedAttributes() {
    return ['variant', 'width', 'height', 'lines'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const variant = this.getAttribute('variant') || 'rect';
    const width = this.getAttribute('width') || '100%';
    const height = this.getAttribute('height');
    const lines = parseInt(this.getAttribute('lines') || '1', 10);

    let html = '';

    if (variant === 'text' && lines > 1) {
      // Multiple text lines
      const linesHtml = Array(lines).fill(0).map(() =>
        `<div class="skeleton text" style="width: 100%;"></div>`
      ).join('');
      html = `<div class="lines-container">${linesHtml}</div>`;
    } else {
      // Single skeleton
      const heightValue = height || (variant === 'text' ? '16px' : variant === 'circle' ? width : '100px');
      html = `<div class="skeleton ${variant}" style="width: ${width}; height: ${heightValue};"></div>`;
    }

    this.setContent(styles, html);
  }
}

customElements.define('tc-skeleton', TCSkeleton);
