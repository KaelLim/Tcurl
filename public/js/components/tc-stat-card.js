/**
 * TCurl Stat Card Component
 *
 * @element tc-stat-card
 * @attr {string} label - 標籤文字
 * @attr {string} value - 數值
 * @attr {string} icon - Material Symbol 圖示名稱
 * @attr {string} trend - 趨勢: up | down | neutral
 * @attr {string} trend-value - 趨勢數值 (例如 "+12%")
 * @attr {string} variant - 樣式: default | primary | success | warning | error
 *
 * @example
 * <tc-stat-card
 *   label="Total Clicks"
 *   value="12,345"
 *   icon="bar_chart"
 *   trend="up"
 *   trend-value="+12%"
 * ></tc-stat-card>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .stat-card {
    background-color: var(--tc-background-card);
    border: 1px solid var(--tc-border);
    border-radius: var(--tc-radius-xl);
    padding: var(--tc-spacing-lg);
    display: flex;
    flex-direction: column;
    gap: var(--tc-spacing-sm);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .label {
    font-size: var(--tc-font-size-sm);
    color: var(--tc-text-secondary);
    font-weight: 500;
  }

  .icon-wrapper {
    width: 36px;
    height: 36px;
    border-radius: var(--tc-radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-wrapper.variant-default {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--tc-text-muted);
  }

  .icon-wrapper.variant-primary {
    background-color: rgba(19, 55, 236, 0.2);
    color: var(--tc-primary);
  }

  .icon-wrapper.variant-success {
    background-color: var(--tc-success-bg);
    color: var(--tc-success);
  }

  .icon-wrapper.variant-warning {
    background-color: var(--tc-warning-bg);
    color: var(--tc-warning);
  }

  .icon-wrapper.variant-error {
    background-color: var(--tc-error-bg);
    color: var(--tc-error);
  }

  .icon-wrapper .icon {
    font-size: 20px;
  }

  .value {
    font-size: var(--tc-font-size-2xl);
    font-weight: 700;
    color: var(--tc-text-primary);
    line-height: 1.2;
  }

  .footer {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-xs);
  }

  .trend {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: var(--tc-font-size-sm);
    font-weight: 500;
  }

  .trend.up {
    color: var(--tc-success);
  }

  .trend.down {
    color: var(--tc-error);
  }

  .trend.neutral {
    color: var(--tc-text-muted);
  }

  .trend .trend-icon {
    font-size: 16px;
  }

  .description {
    font-size: var(--tc-font-size-xs);
    color: var(--tc-text-hint);
  }
`;

const TREND_ICONS = {
  up: 'trending_up',
  down: 'trending_down',
  neutral: 'trending_flat'
};

export class TCStatCard extends TCElement {
  static get observedAttributes() {
    return ['label', 'value', 'icon', 'trend', 'trend-value', 'variant', 'description'];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const label = this.getAttribute('label') || '';
    const value = this.getAttribute('value') || '-';
    const icon = this.getAttribute('icon');
    const trend = this.getAttribute('trend');
    const trendValue = this.getAttribute('trend-value');
    const variant = this.getAttribute('variant') || 'default';
    const description = this.getAttribute('description');

    const iconHtml = icon
      ? `<div class="icon-wrapper variant-${variant}">
           <span class="material-symbols-outlined icon">${icon}</span>
         </div>`
      : '';

    let footerHtml = '';
    if (trend && trendValue) {
      const trendIcon = TREND_ICONS[trend] || TREND_ICONS.neutral;
      footerHtml = `
        <div class="footer">
          <span class="trend ${trend}">
            <span class="material-symbols-outlined trend-icon">${trendIcon}</span>
            ${trendValue}
          </span>
          ${description ? `<span class="description">${description}</span>` : ''}
        </div>
      `;
    } else if (description) {
      footerHtml = `
        <div class="footer">
          <span class="description">${description}</span>
        </div>
      `;
    }

    this.setContent(styles, `
      <div class="stat-card">
        <div class="header">
          <span class="label">${label}</span>
          ${iconHtml}
        </div>
        <div class="value">${value}</div>
        ${footerHtml}
      </div>
    `);
  }
}

customElements.define('tc-stat-card', TCStatCard);
