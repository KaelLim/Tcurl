/**
 * TCurl Tooltip Component
 *
 * @element tc-tooltip
 * @attr {string} text - 提示文字
 * @attr {string} position - 位置: top | bottom | left | right
 *
 * @slot - 被包裹的元素
 *
 * @example
 * <tc-tooltip text="Click to copy" position="top">
 *   <tc-button icon="content_copy"></tc-button>
 * </tc-tooltip>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: inline-block;
    position: relative;
  }

  .trigger {
    display: inline-block;
  }

  .tooltip {
    position: absolute;
    padding: var(--tc-spacing-sm) var(--tc-spacing-md);
    font-size: var(--tc-font-size-xs);
    font-weight: 500;
    color: var(--tc-text-primary);
    background-color: var(--tc-background-elevated);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-md);
    white-space: nowrap;
    z-index: 1000;
    opacity: 0;
    visibility: hidden;
    transition: all var(--tc-transition-fast);
    pointer-events: none;
    box-shadow: var(--tc-shadow-md);
  }

  .tooltip.visible {
    opacity: 1;
    visibility: visible;
  }

  /* Positions */
  .tooltip.top {
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(-8px);
  }

  .tooltip.bottom {
    top: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(8px);
  }

  .tooltip.left {
    right: 100%;
    top: 50%;
    transform: translateY(-50%) translateX(-8px);
  }

  .tooltip.right {
    left: 100%;
    top: 50%;
    transform: translateY(-50%) translateX(8px);
  }

  /* Arrow */
  .tooltip::after {
    content: '';
    position: absolute;
    border: 6px solid transparent;
  }

  .tooltip.top::after {
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border-top-color: var(--tc-border);
  }

  .tooltip.bottom::after {
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    border-bottom-color: var(--tc-border);
  }

  .tooltip.left::after {
    left: 100%;
    top: 50%;
    transform: translateY(-50%);
    border-left-color: var(--tc-border);
  }

  .tooltip.right::after {
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border-right-color: var(--tc-border);
  }
`;

export class TCTooltip extends TCElement {
  static get observedAttributes() {
    return ['text', 'position'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  show() {
    this.$('.tooltip')?.classList.add('visible');
  }

  hide() {
    this.$('.tooltip')?.classList.remove('visible');
  }

  render() {
    const text = this.getAttribute('text') || '';
    const position = this.getAttribute('position') || 'top';

    this.setContent(styles, `
      <div class="trigger">
        <slot></slot>
      </div>
      <div class="tooltip ${position}" role="tooltip">${text}</div>
    `);

    const trigger = this.$('.trigger');
    trigger.addEventListener('mouseenter', () => this.show());
    trigger.addEventListener('mouseleave', () => this.hide());
    trigger.addEventListener('focus', () => this.show(), true);
    trigger.addEventListener('blur', () => this.hide(), true);
  }
}

customElements.define('tc-tooltip', TCTooltip);
