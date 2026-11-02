/**
 * HTML 頁面路由（美化 URL，隱藏 .html 副檔名）
 *
 * HTML 檔案放在 Workers Static Assets（public/），透過 ASSETS binding 讀取，
 * 注入資源版本號後以 no-cache 回傳。
 *
 * @module routes/url-pages
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types/env.ts';
import { injectAssetVersion } from '../utils/asset-version.ts';

export const urlPageRoutes = new Hono<AppEnv>();

/**
 * 從 ASSETS binding 讀取 HTML 原始內容；找不到回傳 null
 *
 * @param assetPath - public/ 底下的路徑，例如 `/links.html`
 */
export async function fetchAssetHtml(c: Context<AppEnv>, assetPath: string): Promise<string | null> {
  const res = await c.env.ASSETS.fetch(new URL(assetPath, c.req.url));
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  return await res.text();
}

/**
 * 回傳注入版本號的 HTML（HTML 一律 no-cache，讓 ?v= 版本號隨部署更新）
 */
export function htmlResponse(c: Context<AppEnv>, raw: string): Response {
  c.header('Cache-Control', 'no-cache');
  return c.html(injectAssetVersion(raw));
}

async function serveHtml(c: Context<AppEnv>, path: string) {
  const raw = await fetchAssetHtml(c, path);
  if (raw === null) {
    return c.text('Not Found', 404);
  }
  return htmlResponse(c, raw);
}

urlPageRoutes.get('/links', (c) => serveHtml(c, '/links.html'));

urlPageRoutes.get('/edit/:id', (c) => serveHtml(c, '/edit.html'));

urlPageRoutes.get('/analytics', (c) => serveHtml(c, '/analytics.html'));

urlPageRoutes.get('/analytics/:id', (c) => serveHtml(c, '/analytics.html'));

urlPageRoutes.get('/feedback', (c) => serveHtml(c, '/feedback.html'));

urlPageRoutes.get('/feedback/:id', (c) => serveHtml(c, '/feedback-detail.html'));

urlPageRoutes.get('/docs', (c) => serveHtml(c, '/docs/index.html'));

urlPageRoutes.get('/ui-kit', (c) => serveHtml(c, '/ui-kit.html'));

urlPageRoutes.get('/admin', (c) => serveHtml(c, '/admin.html'));

urlPageRoutes.get('/r', (c) => serveHtml(c, '/room.html'));
