import { assertEquals, assertExists } from '@std/assert';
import { createRoomStore } from './room-store.ts';

async function withStore(fn: (store: ReturnType<typeof createRoomStore>) => Promise<void>) {
  const kv = await Deno.openKv(':memory:');
  try {
    await fn(createRoomStore(kv));
  } finally {
    kv.close();
  }
}

Deno.test('createItem 後 listItems 可取回', async () => {
  await withStore(async (store) => {
    const created = await store.createItem('roomA', {
      originalUrl: 'https://example.com',
      title: 'T',
    });
    assertExists(created.shortCode);
    const items = await store.listItems('roomA');
    assertEquals(items.length, 1);
    assertEquals(items[0].originalUrl, 'https://example.com');
  });
});

Deno.test('不同房間彼此隔離', async () => {
  await withStore(async (store) => {
    await store.createItem('roomA', { originalUrl: 'https://a.com' });
    assertEquals((await store.listItems('roomB')).length, 0);
  });
});

Deno.test('updateItem 修改欄位、保留未變欄位', async () => {
  await withStore(async (store) => {
    const it = await store.createItem('roomA', { originalUrl: 'https://a.com', title: 'old' });
    const updated = await store.updateItem('roomA', it.id, { title: 'new' });
    assertEquals(updated?.title, 'new');
    assertEquals(updated?.originalUrl, 'https://a.com');
  });
});

Deno.test('updateItem 找不到回傳 null', async () => {
  await withStore(async (store) => {
    assertEquals(await store.updateItem('roomA', 'nope', { title: 'x' }), null);
  });
});

Deno.test('removeItem 刪除後 list 為空', async () => {
  await withStore(async (store) => {
    const it = await store.createItem('roomA', { originalUrl: 'https://a.com' });
    assertEquals(await store.removeItem('roomA', it.id), true);
    assertEquals((await store.listItems('roomA')).length, 0);
  });
});

Deno.test('removeItem 找不到回傳 false', async () => {
  await withStore(async (store) => {
    assertEquals(await store.removeItem('roomA', 'nope'), false);
  });
});
