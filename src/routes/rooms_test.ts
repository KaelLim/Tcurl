import { expect, test } from 'vitest';
import type { Hono } from 'hono';
import { createMemoryKv } from '../../tests/helpers/memory-kv.ts';
import { createRoomStore } from '../services/room-store.ts';
import type { AppEnv } from '../types/env.ts';
import { createRoomsRouter } from './rooms.ts';

const PASS = 'tzuchi-0718';

async function withApp(fn: (app: Hono<AppEnv>) => Promise<void>) {
  const store = createRoomStore(createMemoryKv());
  const app = createRoomsRouter(() => store);
  await fn(app);
}

test('缺少密語回傳 400', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items');
    expect(res.status).toBe(400);
  });
});

test('POST 建立項目後 GET 可取回', async () => {
  await withApp(async (app) => {
    const post = await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'https://example.com', title: 'hi' }),
    });
    expect(post.status).toBe(201);
    const get = await app.request('/api/rooms/items', { headers: { 'X-Room-Pass': PASS } });
    const data = (await get.json()) as { items: Array<{ title: string }> };
    expect(data.items.length).toBe(1);
    expect(data.items[0].title).toBe('hi');
  });
});

test('不同密語看不到彼此資料', async () => {
  await withApp(async (app) => {
    await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'https://example.com' }),
    });
    const other = await app.request('/api/rooms/items', {
      headers: { 'X-Room-Pass': 'different' },
    });
    expect(((await other.json()) as { items: unknown[] }).items.length).toBe(0);
  });
});

test('無效 URL 回傳 400', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'file:///etc/passwd' }),
    });
    expect(res.status).toBe(400);
  });
});

test('DELETE 不存在項目回傳 404', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items/nope', {
      method: 'DELETE',
      headers: { 'X-Room-Pass': PASS },
    });
    expect(res.status).toBe(404);
  });
});
