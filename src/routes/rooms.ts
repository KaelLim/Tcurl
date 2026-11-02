/**
 * 密語房間 API 路由（免登入）
 *
 * 密語走 X-Room-Pass header，伺服器當場導出 roomKey，
 * 一切讀寫限定於該房間前綴。無跨房間端點。
 *
 * @module routes/rooms
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types/env.ts';
import { deriveRoomKey, normalizePassphrase } from '../utils/room-key.ts';
import { validateUrl } from '../utils/url-validator.ts';
import type { RoomStore } from '../services/room-store.ts';

const MISSING_PASS = { error: '缺少密語（X-Room-Pass）' };

async function resolveRoomKey(c: Context): Promise<string | null> {
  const pass = c.req.header('X-Room-Pass');
  if (!pass || normalizePassphrase(pass).length === 0) return null;
  return await deriveRoomKey(pass);
}

/**
 * 以注入的 store 解析函數建立 rooms 路由（方便測試）
 *
 * Workers 的 KV binding 只能從請求的 env 取得，因此每個請求才解析 store。
 */
export function createRoomsRouter(resolveStore: (c: Context<AppEnv>) => RoomStore): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/api/rooms/items', async (c) => {
    const roomKey = await resolveRoomKey(c);
    if (!roomKey) return c.json(MISSING_PASS, 400);
    return c.json({ items: await resolveStore(c).listItems(roomKey) });
  });

  app.post('/api/rooms/items', async (c) => {
    const roomKey = await resolveRoomKey(c);
    if (!roomKey) return c.json(MISSING_PASS, 400);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.originalUrl !== 'string') {
      return c.json({ error: '缺少 originalUrl' }, 400);
    }
    const check = validateUrl(body.originalUrl);
    if (!check.valid) return c.json({ error: check.reason }, 400);

    const item = await resolveStore(c).createItem(roomKey, {
      originalUrl: body.originalUrl,
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    return c.json({ item }, 201);
  });

  app.put('/api/rooms/items/:id', async (c) => {
    const roomKey = await resolveRoomKey(c);
    if (!roomKey) return c.json(MISSING_PASS, 400);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: '請求內容無效' }, 400);
    if (typeof body.originalUrl === 'string') {
      const check = validateUrl(body.originalUrl);
      if (!check.valid) return c.json({ error: check.reason }, 400);
    }
    const updated = await resolveStore(c).updateItem(roomKey, c.req.param('id'), {
      originalUrl: typeof body.originalUrl === 'string' ? body.originalUrl : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    if (!updated) return c.json({ error: '找不到項目' }, 404);
    return c.json({ item: updated });
  });

  app.delete('/api/rooms/items/:id', async (c) => {
    const roomKey = await resolveRoomKey(c);
    if (!roomKey) return c.json(MISSING_PASS, 400);
    const ok = await resolveStore(c).removeItem(roomKey, c.req.param('id'));
    if (!ok) return c.json({ error: '找不到項目' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
