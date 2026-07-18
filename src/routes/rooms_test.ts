import { assertEquals } from '@std/assert';
import type { Hono } from '@hono/hono';
import { createRoomStore } from '../services/room-store.ts';
import { createRoomsRouter } from './rooms.ts';

const PASS = 'tzuchi-0718';

async function withApp(fn: (app: Hono) => Promise<void>) {
  const kv = await Deno.openKv(':memory:');
  const app = createRoomsRouter(createRoomStore(kv));
  try {
    await fn(app);
  } finally {
    kv.close();
  }
}

Deno.test('缺少密語回傳 400', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items');
    assertEquals(res.status, 400);
  });
});

Deno.test('POST 建立項目後 GET 可取回', async () => {
  await withApp(async (app) => {
    const post = await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'https://example.com', title: 'hi' }),
    });
    assertEquals(post.status, 201);
    const get = await app.request('/api/rooms/items', { headers: { 'X-Room-Pass': PASS } });
    const data = await get.json();
    assertEquals(data.items.length, 1);
    assertEquals(data.items[0].title, 'hi');
  });
});

Deno.test('不同密語看不到彼此資料', async () => {
  await withApp(async (app) => {
    await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'https://example.com' }),
    });
    const other = await app.request('/api/rooms/items', {
      headers: { 'X-Room-Pass': 'different' },
    });
    assertEquals((await other.json()).items.length, 0);
  });
});

Deno.test('無效 URL 回傳 400', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'file:///etc/passwd' }),
    });
    assertEquals(res.status, 400);
  });
});

Deno.test('DELETE 不存在項目回傳 404', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items/nope', {
      method: 'DELETE',
      headers: { 'X-Room-Pass': PASS },
    });
    assertEquals(res.status, 404);
  });
});
