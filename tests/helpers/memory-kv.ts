/**
 * 測試用 in-memory Workers KV（只實作 room-store 用到的 get / put / delete / list）
 *
 * - list 支援分頁；put 帶 metadata 時，list 的 key 也會帶 metadata（同 Workers KV）
 * - getCalls 記錄 get 的呼叫次數，用來驗證 list 不做 N+1 讀取
 */

import type { RoomKv } from '../../src/services/room-store.ts';

export type MemoryKv = RoomKv & { getCalls: number };

export function createMemoryKv(pageSize = 1000): MemoryKv {
  const store = new Map<string, { value: string; metadata?: unknown }>();
  const kv = {
    getCalls: 0,
    async get(key: string, type?: string) {
      kv.getCalls++;
      const entry = store.get(key);
      if (entry === undefined) return null;
      return type === 'json' ? JSON.parse(entry.value) : entry.value;
    },
    async put(key: string, value: string, options: { metadata?: unknown } = {}) {
      // 同 Workers KV：metadata 以 JSON 序列化保存；沒帶 metadata 的 put 會清掉舊 metadata
      store.set(
        key,
        options.metadata === undefined
          ? { value }
          : { value, metadata: JSON.parse(JSON.stringify(options.metadata)) },
      );
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options: { prefix?: string; cursor?: string } = {}) {
      const names = [...store.keys()].filter((k) => k.startsWith(options.prefix ?? '')).sort();
      const start = options.cursor ? Number(options.cursor) : 0;
      const keys = names.slice(start, start + pageSize).map((name) => {
        const metadata = store.get(name)?.metadata;
        return metadata === undefined ? { name } : { name, metadata };
      });
      const next = start + pageSize;
      const complete = next >= names.length;
      return complete
        ? { keys, list_complete: true, cacheStatus: null }
        : { keys, list_complete: false, cursor: String(next), cacheStatus: null };
    },
  };
  return kv as unknown as MemoryKv;
}
