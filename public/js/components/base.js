/**
 * TCurl Web Components - Base Module
 * 共用基礎類別與樣式變數
 */

// CSS 變數 - 對應 Tailwind 色系
export const CSS_VARS = `
  :host {
    /* Colors */
    --tc-primary: #1337ec;
    --tc-primary-hover: #0f2bc4;
    --tc-background-dark: #101322;
    --tc-background-card: #111218;
    --tc-background-elevated: #1c1d27;
    --tc-border: #3b3f54;

    /* Text Colors */
    --tc-text-primary: #ffffff;
    --tc-text-secondary: rgba(255, 255, 255, 0.9);
    --tc-text-muted: rgba(255, 255, 255, 0.7);
    --tc-text-hint: #9da1b9;

    /* Status Colors */
    --tc-success: #22c55e;
    --tc-success-bg: rgba(34, 197, 94, 0.2);
    --tc-warning: #eab308;
    --tc-warning-bg: rgba(234, 179, 8, 0.2);
    --tc-error: #ef4444;
    --tc-error-bg: rgba(239, 68, 68, 0.2);
    --tc-info: #3b82f6;
    --tc-info-bg: rgba(59, 130, 246, 0.2);

    /* Spacing */
    --tc-spacing-xs: 0.25rem;
    --tc-spacing-sm: 0.5rem;
    --tc-spacing-md: 1rem;
    --tc-spacing-lg: 1.5rem;
    --tc-spacing-xl: 2rem;

    /* Border Radius */
    --tc-radius-sm: 0.25rem;
    --tc-radius-md: 0.5rem;
    --tc-radius-lg: 0.75rem;
    --tc-radius-full: 9999px;

    /* Font */
    --tc-font-family: 'Space Grotesk', sans-serif;
    --tc-font-size-xs: 0.75rem;
    --tc-font-size-sm: 0.875rem;
    --tc-font-size-base: 1rem;
    --tc-font-size-lg: 1.125rem;
    --tc-font-size-xl: 1.25rem;
    --tc-font-size-2xl: 1.5rem;
    --tc-font-size-3xl: 1.875rem;
    --tc-font-size-4xl: 2.25rem;

    /* Transitions */
    --tc-transition-fast: 150ms ease;
    --tc-transition-normal: 200ms ease;
    --tc-transition-slow: 300ms ease;

    /* Shadows */
    --tc-shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --tc-shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    --tc-shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  }
`;

// 共用 CSS Reset
export const CSS_RESET = `
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :host {
    font-family: var(--tc-font-family);
  }
`;

// Material Symbols 樣式
export const MATERIAL_SYMBOLS = `
  .material-symbols-outlined {
    font-family: 'Material Symbols Outlined';
    font-weight: normal;
    font-style: normal;
    font-size: 24px;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    display: inline-block;
    white-space: nowrap;
    word-wrap: normal;
    direction: ltr;
    -webkit-font-feature-settings: 'liga';
    font-feature-settings: 'liga';
    -webkit-font-smoothing: antialiased;
    font-variation-settings:
      'FILL' 0,
      'wght' 400,
      'GRAD' 0,
      'opsz' 24;
  }

  .material-symbols-outlined.filled {
    font-variation-settings:
      'FILL' 1,
      'wght' 400,
      'GRAD' 0,
      'opsz' 24;
  }
`;

/**
 * TCurl 基礎元件類別
 * 所有 tc-* 元件都應該繼承此類別
 */
export class TCElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  /**
   * 取得共用基礎樣式
   */
  getBaseStyles() {
    return `${CSS_VARS}${CSS_RESET}${MATERIAL_SYMBOLS}`;
  }

  /**
   * 渲染元件（子類別需覆寫）
   */
  render() {
    // Override in subclass
  }

  /**
   * 便捷方法：設定 Shadow DOM 內容
   */
  setContent(styles, html) {
    this.shadowRoot.innerHTML = `
      <style>${this.getBaseStyles()}${styles}</style>
      ${html}
    `;
  }

  /**
   * 便捷方法：查詢 Shadow DOM 內元素
   */
  $(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  /**
   * 便捷方法：查詢 Shadow DOM 內多個元素
   */
  $$(selector) {
    return this.shadowRoot.querySelectorAll(selector);
  }

  /**
   * 便捷方法：發送自定義事件
   */
  emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, {
      detail,
      bubbles: true,
      composed: true
    }));
  }
}
