/**
 * TCurl Tabs Component
 *
 * @element tc-tabs
 * @attr {string} active - 當前啟用的 tab ID
 *
 * @slot - tc-tab 和 tc-tab-panel 元素
 *
 * @event tc-tab-change - Tab 切換時觸發
 *
 * @example
 * <tc-tabs active="tab1">
 *   <tc-tab id="tab1">Tab 1</tc-tab>
 *   <tc-tab id="tab2">Tab 2</tc-tab>
 *   <tc-tab-panel tab="tab1">Content 1</tc-tab-panel>
 *   <tc-tab-panel tab="tab2">Content 2</tc-tab-panel>
 * </tc-tabs>
 */

import { TCElement } from './base.js';

const tabsStyles = `
  :host {
    display: block;
  }

  .tabs-container {
    display: flex;
    flex-direction: column;
  }

  .tab-list {
    display: flex;
    gap: var(--tc-spacing-xs);
    border-bottom: 1px solid var(--tc-border);
    margin-bottom: var(--tc-spacing-md);
  }

  .tab-panels {
    min-height: 0;
  }
`;

export class TCTabs extends TCElement {
  static get observedAttributes() {
    return ['active'];
  }

  connectedCallback() {
    this.render();
    this._initTabs();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'active' && oldValue !== newValue) {
      this._updateActiveTab();
    }
  }

  _initTabs() {
    // Set initial active tab
    const active = this.getAttribute('active');
    const tabs = this.querySelectorAll('tc-tab');

    if (!active && tabs.length > 0) {
      const firstTab = tabs[0];
      this.setAttribute('active', firstTab.id);
    }

    this._updateActiveTab();
  }

  _updateActiveTab() {
    const active = this.getAttribute('active');
    const tabs = this.querySelectorAll('tc-tab');
    const panels = this.querySelectorAll('tc-tab-panel');

    // Update tabs
    tabs.forEach(tab => {
      if (tab.id === active) {
        tab.setAttribute('active', '');
      } else {
        tab.removeAttribute('active');
      }
    });

    // Update panels
    panels.forEach(panel => {
      if (panel.getAttribute('tab') === active) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', '');
      }
    });
  }

  selectTab(tabId) {
    this.setAttribute('active', tabId);
    this.emit('tc-tab-change', { tab: tabId });
  }

  render() {
    this.setContent(tabsStyles, `
      <div class="tabs-container">
        <div class="tab-list" role="tablist">
          <slot name="tabs"></slot>
        </div>
        <div class="tab-panels">
          <slot></slot>
        </div>
      </div>
    `);
  }
}

// Tab
const tabStyles = `
  :host {
    display: inline-block;
  }

  button {
    display: flex;
    align-items: center;
    gap: var(--tc-spacing-sm);
    padding: var(--tc-spacing-sm) var(--tc-spacing-md);
    font-family: var(--tc-font-family);
    font-size: var(--tc-font-size-sm);
    font-weight: 500;
    color: var(--tc-text-muted);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: all var(--tc-transition-fast);
    margin-bottom: -1px;
  }

  button:hover {
    color: var(--tc-text-primary);
  }

  button.active {
    color: var(--tc-primary);
    border-bottom-color: var(--tc-primary);
  }

  .icon {
    font-size: 18px;
  }
`;

export class TCTab extends TCElement {
  static get observedAttributes() {
    return ['active', 'icon', 'disabled'];
  }

  connectedCallback() {
    this.render();
    this.slot = 'tabs';
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const isActive = this.hasAttribute('active');
    const icon = this.getAttribute('icon');
    const disabled = this.hasAttribute('disabled');

    const iconHtml = icon
      ? `<span class="material-symbols-outlined icon">${icon}</span>`
      : '';

    this.setContent(tabStyles, `
      <button
        role="tab"
        class="${isActive ? 'active' : ''}"
        ${disabled ? 'disabled' : ''}
        aria-selected="${isActive}"
      >
        ${iconHtml}
        <slot></slot>
      </button>
    `);

    this.$('button').addEventListener('click', () => {
      if (!disabled) {
        const tabs = this.closest('tc-tabs');
        tabs?.selectTab(this.id);
      }
    });
  }
}

// Tab Panel
const panelStyles = `
  :host {
    display: block;
  }

  :host([hidden]) {
    display: none;
  }
`;

export class TCTabPanel extends TCElement {
  static get observedAttributes() {
    return ['tab', 'hidden'];
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.setContent(panelStyles, `<slot></slot>`);
  }
}

customElements.define('tc-tabs', TCTabs);
customElements.define('tc-tab', TCTab);
customElements.define('tc-tab-panel', TCTabPanel);
