/**
 * 密語房間儲存服務（Deno KV）
 *
 * 以 roomKey 為前綴，將每個房間的資料隔離於 Deno KV。
 * 與正式 Postgres 完全無關，資料存於獨立 SQLite。
 *
 * @module services/room-store
 */

const ITEM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天後自動過期
const SHORT_CODE_LEN = 7;
const SHORT_CODE_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** 房間內一筆記錄（POC：短網址） */
export interface RoomItem {
  id: string;
  shortCode: string;
  originalUrl: string;
  title: string;
  createdAt: string;
}

/** 建立記錄的輸入 */
export interface CreateRoomItemInput {
  originalUrl: string;
  title?: string;
}

/** 編輯記錄的輸入 */
export interface UpdateRoomItemInput {
  originalUrl?: string;
  title?: string;
}

export type RoomStore = ReturnType<typeof createRoomStore>;

function generateShortCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHORT_CODE_LEN));
  let out = '';
  for (const b of bytes) out += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
  return out;
}

function itemKey(roomKey: string, id: string): Deno.KvKey {
  return ['room', roomKey, 'item', id];
}

function itemPrefix(roomKey: string): Deno.KvKey {
  return ['room', roomKey, 'item'];
}

/** 以注入的 Deno.Kv 建立房間儲存（方便測試傳入 in-memory KV） */
export function createRoomStore(kv: Deno.Kv) {
  async function listItems(roomKey: string): Promise<RoomItem[]> {
    const items: RoomItem[] = [];
    for await (const entry of kv.list<RoomItem>({ prefix: itemPrefix(roomKey) })) {
      items.push(entry.value);
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // 新的在前
    return items;
  }

  async function createItem(roomKey: string, input: CreateRoomItemInput): Promise<RoomItem> {
    const item: RoomItem = {
      id: crypto.randomUUID(),
      shortCode: generateShortCode(),
      originalUrl: input.originalUrl,
      title: input.title?.trim() || '',
      createdAt: new Date().toISOString(),
    };
    await kv.set(itemKey(roomKey, item.id), item, { expireIn: ITEM_TTL_MS });
    return item;
  }

  async function updateItem(
    roomKey: string,
    id: string,
    patch: UpdateRoomItemInput,
  ): Promise<RoomItem | null> {
    const key = itemKey(roomKey, id);
    const existing = await kv.get<RoomItem>(key);
    if (!existing.value) return null;
    const updated: RoomItem = {
      ...existing.value,
      originalUrl: patch.originalUrl ?? existing.value.originalUrl,
      title: patch.title !== undefined ? patch.title.trim() : existing.value.title,
    };
    await kv.set(key, updated, { expireIn: ITEM_TTL_MS });
    return updated;
  }

  async function removeItem(roomKey: string, id: string): Promise<boolean> {
    const key = itemKey(roomKey, id);
    const existing = await kv.get<RoomItem>(key);
    if (!existing.value) return false;
    await kv.delete(key);
    return true;
  }

  return { listItems, createItem, updateItem, removeItem };
}
