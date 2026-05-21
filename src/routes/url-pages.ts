/**
 * HTML 頁面路由（美化 URL，隱藏 .html 副檔名）
 *
 * @module routes/url-pages
 */

import { Hono } from '@hono/hono';
import type { Context } from '@hono/hono';
import { injectAssetVersion } from '../utils/asset-version.ts';

export const urlPageRoutes = new Hono();

async function serveHtml(c: Context, path: string) {
  const raw = await Deno.readTextFile(path);
  return c.html(injectAssetVersion(raw));
}

urlPageRoutes.get('/links', (c) => serveHtml(c, './public/links.html'));

urlPageRoutes.get('/edit/:id', (c) => serveHtml(c, './public/edit.html'));

urlPageRoutes.get('/analytics', (c) => serveHtml(c, './public/analytics.html'));

urlPageRoutes.get('/analytics/:id', (c) => serveHtml(c, './public/analytics.html'));

urlPageRoutes.get('/feedback', (c) => serveHtml(c, './public/feedback.html'));

urlPageRoutes.get('/feedback/:id', (c) => serveHtml(c, './public/feedback-detail.html'));

urlPageRoutes.get('/docs', (c) => serveHtml(c, './public/docs/index.html'));

urlPageRoutes.get('/ui-kit', (c) => serveHtml(c, './public/ui-kit.html'));
