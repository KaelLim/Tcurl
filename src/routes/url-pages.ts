/**
 * HTML 頁面路由（美化 URL，隱藏 .html 副檔名）
 *
 * @module routes/url-pages
 */

import { Hono } from '@hono/hono';

export const urlPageRoutes = new Hono();

urlPageRoutes.get('/links', async (c) => {
  const content = await Deno.readTextFile('./public/links.html');
  return c.html(content);
});

urlPageRoutes.get('/edit/:id', async (c) => {
  // 直接提供 edit.html，JavaScript 會從 URL 路徑讀取 ID
  const content = await Deno.readTextFile('./public/edit.html');
  return c.html(content);
});

urlPageRoutes.get('/analytics', async (c) => {
  const content = await Deno.readTextFile('./public/analytics.html');
  return c.html(content);
});

urlPageRoutes.get('/analytics/:id', async (c) => {
  // 支援 /analytics/uuid 格式
  const content = await Deno.readTextFile('./public/analytics.html');
  return c.html(content);
});

urlPageRoutes.get('/feedback', async (c) => {
  const content = await Deno.readTextFile('./public/feedback.html');
  return c.html(content);
});

urlPageRoutes.get('/feedback/:id', async (c) => {
  // 支援 /feedback/uuid 格式
  const content = await Deno.readTextFile('./public/feedback-detail.html');
  return c.html(content);
});

urlPageRoutes.get('/docs', async (c) => {
  const content = await Deno.readTextFile('./public/docs/index.html');
  return c.html(content);
});

// UI Kit - 開發者專用
urlPageRoutes.get('/ui-kit', async (c) => {
  const content = await Deno.readTextFile('./public/ui-kit.html');
  return c.html(content);
});
