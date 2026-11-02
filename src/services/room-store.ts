/**
 * 密語房間儲存服務（Workers KV）
 *
 * 以 roomKey 為前綴，將每個房間的資料隔離於 Workers KV（binding: ROOMS_KV）。
 * 與正式 Postgres 完全無關。
 *
 * 注意：Workers KV 為最終一致性，剛寫入的項目可能延遲數十秒才出現在 list 結果中。
 *
 * 項目序列化後不超過 1024 bytes（KV metadata 上限）時，也存進 key 的 metadata，
 * listItems 直接從 list 結果讀取，不必逐筆 get（避免 N+1 與每次呼叫 1000 次 KV 操作上限）。
 *
 * @module services/room-store
 */

const ITEM_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天後自動過期（KV expirationTtl 最小 60 秒）
const METADATA_MAX_BYTES = 1024; // Workers KV metadata 序列化後的上限
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

/** 房間儲存用到的 KV 操作（Workers KVNamespace 的子集，方便測試注入 in-memory 實作） */
export type RoomKv = Pick<KVNamespace, 'get' | 'put' | 'delete' | 'list'>;

export type RoomStore = ReturnType<typeof createRoomStore>;

function generateShortCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHORT_CODE_LEN));
  let out = '';
  for (const b of bytes) out += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
  return out;
}

// roomKey 為 64 字元 hex、id 為 UUID，皆不含冒號，前綴不會互相重疊
function itemKey(roomKey: string, id: string): string {
  return `room:${roomKey}:item:${id}`;
}

function itemPrefix(roomKey: string): string {
  return `room:${roomKey}:item:`;
}

/** list 回傳的 metadata 是否為完整的 RoomItem（舊資料或過大的項目沒有 metadata） */
function isRoomItem(value: unknown): value is RoomItem {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.shortCode === 'string' &&
    typeof v.originalUrl === 'string' &&
    typeof v.title === 'string' &&
    typeof v.createdAt === 'string'
  );
}

/** 以注入的 KV namespace 建立房間儲存（方便測試傳入 in-memory KV） */
export function createRoomStore(kv: RoomKv) {
  /** 寫入項目；序列化後不超過 1024 bytes 時一併存進 metadata（超過則不帶 metadata，put 會清掉舊的） */
  async function putItem(key: string, item: RoomItem): Promise<void> {
    const json = JSON.stringify(item);
    const fitsMetadata = new TextEncoder().encode(json).byteLength <= METADATA_MAX_BYTES;
    if (fitsMetadata) {
      try {
        await kv.put(key, json, { expirationTtl: ITEM_TTL_SECONDS, metadata: item });
        return;
      } catch (err) {
        // 縱深防禦：metadata 被 KV 拒絕（例如 413）時改存不帶 metadata 的版本，listItems 會改用 get 讀取
        console.warn('[RoomStore] put with metadata failed, retrying without metadata:', err);
      }
    }
    await kv.put(key, json, { expirationTtl: ITEM_TTL_SECONDS });
  }

  async function listItems(roomKey: string): Promise<RoomItem[]> {
    const items: RoomItem[] = [];
    const namesWithoutMetadata: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await kv.list<RoomItem>({ prefix: itemPrefix(roomKey), cursor });
      for (const key of page.keys) {
        if (isRoomItem(key.metadata)) items.push(key.metadata);
        else namesWithoutMetadata.push(key.name);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    // 沒有 metadata 的 key（過大的項目）才逐筆 get
    const values = await Promise.all(namesWithoutMetadata.map((name) => kv.get<RoomItem>(name, 'json')));
    // list 與 get 之間可能剛好過期或被刪除，略過 null
    for (const v of values) if (v !== null) items.push(v);
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
    await putItem(itemKey(roomKey, item.id), item);
    return item;
  }

  async function updateItem(
    roomKey: string,
    id: string,
    patch: UpdateRoomItemInput,
  ): Promise<RoomItem | null> {
    const key = itemKey(roomKey, id);
    const existing = await kv.get<RoomItem>(key, 'json');
    if (!existing) return null;
    const updated: RoomItem = {
      ...existing,
      originalUrl: patch.originalUrl ?? existing.originalUrl,
      title: patch.title !== undefined ? patch.title.trim() : existing.title,
    };
    await putItem(key, updated);
    return updated;
  }

  async function removeItem(roomKey: string, id: string): Promise<boolean> {
    const key = itemKey(roomKey, id);
    const existing = await kv.get<RoomItem>(key, 'json');
    if (!existing) return false;
    await kv.delete(key);
    return true;
  }

  return { listItems, createItem, updateItem, removeItem };
}
