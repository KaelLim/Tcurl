import { expect, test } from 'vitest';
import { createMemoryKv } from '../../tests/helpers/memory-kv.ts';
import { createRoomStore, type RoomItem } from './room-store.ts';

async function withStore(
  fn: (store: ReturnType<typeof createRoomStore>) => Promise<void>,
  pageSize?: number,
) {
  await fn(createRoomStore(createMemoryKv(pageSize)));
}

test('createItem 後 listItems 可取回', async () => {
  await withStore(async (store) => {
    const created = await store.createItem('roomA', {
      originalUrl: 'https://example.com',
      title: 'T',
    });
    expect(created.shortCode).toBeTruthy();
    const items = await store.listItems('roomA');
    expect(items.length).toBe(1);
    expect(items[0].originalUrl).toBe('https://example.com');
  });
});

test('不同房間彼此隔離', async () => {
  await withStore(async (store) => {
    await store.createItem('roomA', { originalUrl: 'https://a.com' });
    expect((await store.listItems('roomB')).length).toBe(0);
  });
});

test('updateItem 修改欄位、保留未變欄位', async () => {
  await withStore(async (store) => {
    const it = await store.createItem('roomA', { originalUrl: 'https://a.com', title: 'old' });
    const updated = await store.updateItem('roomA', it.id, { title: 'new' });
    expect(updated?.title).toBe('new');
    expect(updated?.originalUrl).toBe('https://a.com');
  });
});

test('updateItem 找不到回傳 null', async () => {
  await withStore(async (store) => {
    expect(await store.updateItem('roomA', 'nope', { title: 'x' })).toBe(null);
  });
});

test('removeItem 刪除後 list 為空', async () => {
  await withStore(async (store) => {
    const it = await store.createItem('roomA', { originalUrl: 'https://a.com' });
    expect(await store.removeItem('roomA', it.id)).toBe(true);
    expect((await store.listItems('roomA')).length).toBe(0);
  });
});

test('removeItem 找不到回傳 false', async () => {
  await withStore(async (store) => {
    expect(await store.removeItem('roomA', 'nope')).toBe(false);
  });
});

function recordPuts(kv: ReturnType<typeof createMemoryKv>) {
  const puts: Array<{ key: string; options: unknown }> = [];
  const originalPut = kv.put.bind(kv);
  kv.put = (async (key: string, value: string, options?: unknown) => {
    puts.push({ key, options });
    return originalPut(key, value, options as KVNamespacePutOptions);
  }) as typeof kv.put;
  return puts;
}

test('createItem 以 7 天 expirationTtl 寫入 KV，並把項目存進 metadata', async () => {
  const kv = createMemoryKv();
  const puts = recordPuts(kv);

  const store = createRoomStore(kv);
  const it = await store.createItem('roomA', { originalUrl: 'https://a.com' });
  expect(puts).toEqual([
    { key: `room:roomA:item:${it.id}`, options: { expirationTtl: 7 * 24 * 60 * 60, metadata: it } },
  ]);
});

test('listItems 從 list 的 metadata 取值，不逐筆 get', async () => {
  const kv = createMemoryKv(2);
  const store = createRoomStore(kv);
  for (let i = 0; i < 5; i++) {
    await store.createItem('roomA', { originalUrl: `https://a.com/${i}`, title: `t${i}` });
  }
  kv.getCalls = 0;
  const items = await store.listItems('roomA');
  expect(items.length).toBe(5);
  expect(kv.getCalls).toBe(0);
});

test('序列化超過 1024 bytes 的項目不放 metadata，listItems 改用 get 取回', async () => {
  const kv = createMemoryKv();
  const puts = recordPuts(kv);
  const store = createRoomStore(kv);

  const small = await store.createItem('roomA', { originalUrl: 'https://a.com/small' });
  // 中文每字 3 bytes：400 字 = 1200 bytes，必定超過 metadata 上限
  const big = await store.createItem('roomA', {
    originalUrl: 'https://a.com/big',
    title: '長'.repeat(400),
  });
  expect(puts[1].options).toEqual({ expirationTtl: 7 * 24 * 60 * 60 });

  kv.getCalls = 0;
  const items = await store.listItems('roomA');
  expect(items.map((i) => i.id).sort()).toEqual([small.id, big.id].sort());
  expect(items.find((i) => i.id === big.id)?.title).toBe('長'.repeat(400));
  expect(kv.getCalls).toBe(1); // 只有沒有 metadata 的那筆
});

test('updateItem 會同步更新 metadata；變大超過上限時清掉 metadata', async () => {
  const kv = createMemoryKv();
  const store = createRoomStore(kv);
  const it = await store.createItem('roomA', { originalUrl: 'https://a.com', title: 'old' });

  await store.updateItem('roomA', it.id, { title: 'new' });
  let page = await kv.list({ prefix: 'room:roomA:item:' });
  expect((page.keys[0].metadata as RoomItem).title).toBe('new');
  expect((await store.listItems('roomA'))[0].title).toBe('new');

  await store.updateItem('roomA', it.id, { title: '長'.repeat(400) });
  page = await kv.list({ prefix: 'room:roomA:item:' });
  expect(page.keys[0].metadata).toBeUndefined();
  expect((await store.listItems('roomA'))[0].title).toBe('長'.repeat(400));
});

test('沒有 metadata 的舊資料仍可列出（fallback 到 get）', async () => {
  const kv = createMemoryKv();
  const legacy: RoomItem = {
    id: 'legacy-id',
    shortCode: 'abcdefg',
    originalUrl: 'https://legacy.example.com',
    title: 'legacy',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  await kv.put('room:roomA:item:legacy-id', JSON.stringify(legacy));
  const store = createRoomStore(kv);
  expect(await store.listItems('roomA')).toEqual([legacy]);
});

test('listItems 會走完 KV list 分頁，並依建立時間新到舊排序', async () => {
  await withStore(async (store) => {
    const created: RoomItem[] = [];
    for (let i = 0; i < 5; i++) {
      created.push(await store.createItem('roomA', { originalUrl: `https://a.com/${i}` }));
      await new Promise((r) => setTimeout(r, 2)); // 確保 createdAt 不同
    }
    const items = await store.listItems('roomA');
    expect(items.length).toBe(5);
    expect(items.map((i) => i.id)).toEqual(created.reverse().map((i) => i.id));
  }, 2);
});

test('put 帶 metadata 被拒時改存不帶 metadata 的版本，listItems 仍可取回', async () => {
  const kv = createMemoryKv();
  const realPut = kv.put.bind(kv);
  let rejected = 0;
  kv.put = (async (key: string, value: string, options?: { metadata?: unknown }) => {
    if (options && 'metadata' in options && options.metadata !== undefined) {
      rejected++;
      throw new Error('413 metadata too large');
    }
    return realPut(key, value, options as never);
  }) as typeof kv.put;
  const store = createRoomStore(kv);
  const room = 'fallback-room-key';
  const created = await store.createItem(room, { shortCode: 'abc123', originalUrl: 'https://example.com', title: '標題' } as never);
  expect(rejected).toBe(1);
  const items = await store.listItems(room);
  expect(items.map((i: RoomItem) => i.id)).toEqual([created.id]);
});
