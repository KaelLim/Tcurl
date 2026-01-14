/**
 * TCurl Chart Component (Chart.js Wrapper)
 *
 * @element tc-chart
 * @attr {string} type - 圖表類型: line | bar | pie | doughnut
 * @attr {string} height - 高度 (預設 300px)
 *
 * @method setData(labels, datasets) - 設定圖表資料
 * @method update() - 更新圖表
 * @method destroy() - 銷毀圖表
 *
 * @example
 * <tc-chart id="myChart" type="line" height="400px"></tc-chart>
 *
 * <script>
 *   const chart = document.getElementById('myChart');
 *   chart.setData(
 *     ['Jan', 'Feb', 'Mar'],
 *     [{ label: 'Clicks', data: [10, 20, 30] }]
 *   );
 * </script>
 */

import { TCElement } from './base.js';

const styles = `
  :host {
    display: block;
  }

  .chart-container {
    position: relative;
    width: 100%;
  }

  canvas {
    width: 100% !important;
  }
`;

// Default Chart.js theme for TCurl
const CHART_THEME = {
  colors: [
    '#1337ec', // primary
    '#22c55e', // success
    '#eab308', // warning
    '#ef4444', // error
    '#3b82f6', // info
    '#8b5cf6', // purple
    '#ec4899', // pink
  ],
  backgroundColor: 'transparent',
  borderColor: '#3b3f54',
  gridColor: 'rgba(59, 63, 84, 0.5)',
  textColor: '#9da1b9',
  fontFamily: "'Space Grotesk', sans-serif",
};

export class TCChart extends TCElement {
  static get observedAttributes() {
    return ['type', 'height'];
  }

  constructor() {
    super();
    this._chart = null;
    this._chartJsLoaded = false;
  }

  async connectedCallback() {
    this.render();
    await this._loadChartJs();
  }

  disconnectedCallback() {
    this.destroy();
  }

  async _loadChartJs() {
    // Check if Chart.js is already loaded
    if (window.Chart) {
      this._chartJsLoaded = true;
      return;
    }

    // Load Chart.js from CDN
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      script.onload = () => {
        this._chartJsLoaded = true;
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  render() {
    const height = this.getAttribute('height') || '300px';

    this.setContent(styles, `
      <div class="chart-container" style="height: ${height};">
        <canvas></canvas>
      </div>
    `);
  }

  /**
   * 設定圖表資料
   * @param {string[]} labels - X 軸標籤
   * @param {Array<{label: string, data: number[], backgroundColor?: string}>} datasets - 資料集
   */
  async setData(labels, datasets) {
    // Ensure Chart.js is loaded
    if (!this._chartJsLoaded) {
      await this._loadChartJs();
    }

    const type = this.getAttribute('type') || 'line';
    const canvas = this.$('canvas');

    if (!canvas || !window.Chart) {
      console.error('Chart.js not loaded or canvas not found');
      return;
    }

    // Destroy existing chart
    if (this._chart) {
      this._chart.destroy();
    }

    // Process datasets with theme colors
    const processedDatasets = datasets.map((ds, index) => {
      const color = ds.borderColor || ds.backgroundColor || CHART_THEME.colors[index % CHART_THEME.colors.length];
      const baseConfig = {
        label: ds.label,
        data: ds.data,
      };

      if (type === 'line') {
        return {
          ...baseConfig,
          borderColor: color,
          backgroundColor: this._hexToRgba(color, 0.1),
          borderWidth: 2,
          fill: ds.fill !== false,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: color,
          pointBorderColor: CHART_THEME.backgroundColor,
          pointBorderWidth: 2,
        };
      } else if (type === 'bar') {
        return {
          ...baseConfig,
          backgroundColor: ds.backgroundColor || this._hexToRgba(color, 0.8),
          borderColor: color,
          borderWidth: 1,
          borderRadius: 4,
        };
      } else if (type === 'pie' || type === 'doughnut') {
        return {
          ...baseConfig,
          backgroundColor: ds.backgroundColor || CHART_THEME.colors.slice(0, ds.data.length),
          borderColor: CHART_THEME.borderColor,
          borderWidth: 1,
        };
      }

      return { ...baseConfig, ...ds };
    });

    // Create chart
    this._chart = new window.Chart(canvas, {
      type,
      data: {
        labels,
        datasets: processedDatasets,
      },
      options: this._getDefaultOptions(type),
    });
  }

  _getDefaultOptions(type) {
    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: type === 'pie' || type === 'doughnut',
          position: 'bottom',
          labels: {
            color: CHART_THEME.textColor,
            font: {
              family: CHART_THEME.fontFamily,
              size: 12,
            },
            padding: 16,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: '#1c1d27',
          titleColor: '#ffffff',
          bodyColor: '#9da1b9',
          borderColor: CHART_THEME.borderColor,
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          titleFont: {
            family: CHART_THEME.fontFamily,
            weight: 600,
          },
          bodyFont: {
            family: CHART_THEME.fontFamily,
          },
        },
      },
    };

    if (type === 'line' || type === 'bar') {
      baseOptions.scales = {
        x: {
          grid: {
            color: CHART_THEME.gridColor,
            drawBorder: false,
          },
          ticks: {
            color: CHART_THEME.textColor,
            font: {
              family: CHART_THEME.fontFamily,
              size: 11,
            },
          },
        },
        y: {
          grid: {
            color: CHART_THEME.gridColor,
            drawBorder: false,
          },
          ticks: {
            color: CHART_THEME.textColor,
            font: {
              family: CHART_THEME.fontFamily,
              size: 11,
            },
          },
          beginAtZero: true,
        },
      };
    }

    if (type === 'doughnut') {
      baseOptions.cutout = '60%';
    }

    return baseOptions;
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * 更新圖表
   */
  update() {
    if (this._chart) {
      this._chart.update();
    }
  }

  /**
   * 銷毀圖表
   */
  destroy() {
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
  }

  /**
   * 取得 Chart.js 實例
   */
  getChart() {
    return this._chart;
  }
}

customElements.define('tc-chart', TCChart);
