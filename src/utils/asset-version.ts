/**
 * 靜態資源版本號（cache busting）
 *
 * 版本號在 build 時由 package.json 的 version 打包進 Worker（不在執行期讀檔）。
 * HTML 經 Worker 輸出時把 /js/、/css/ 引用加上 ?v=版本號，配合 JS/CSS 長快取：
 * - `src="/js/..."`、`href="/css/..."` 屬性
 * - inline module script 的 `import '/js/...'`（例如 tc-sidebar.js；沒有 ?v= 會被瀏覽器快取一年）
 *
 * @module utils/asset-version
 */

import { version } from '../../package.json';

export const APP_VERSION: string = version || '0.0.0';

const versionQuery = `v=${APP_VERSION}`;

export function injectAssetVersion(html: string): string {
  return html
    .replace(/(src|href)="(\/(?:js|css)\/[^"]+)"/g, `$1="$2?${versionQuery}"`)
    .replace(/(\bimport\s+|\bfrom\s+)(['"])(\/js\/[^'"?]+\.js)\2/g, `$1$2$3?${versionQuery}$2`);
}
