/**
 * 密語 → roomKey 導出工具
 *
 * 將使用者輸入的密語正規化後雜湊，作為房間隔離的 key 前綴。
 * 原始密語不落地，只保留雜湊。
 *
 * @module utils/room-key
 */

import { crypto } from '@std/crypto';
import { encodeHex } from '@std/encoding/hex';

/** 命名空間前綴，避免 roomKey 是明文密語的裸 SHA-256 */
const KEY_NAMESPACE = 'tcurl-room:v1:';

/**
 * 正規化密語：去頭尾空白 + Unicode NFC。
 * 區分大小寫（不折疊），行為可預期。
 */
export function normalizePassphrase(raw: string): string {
  return raw.trim().normalize('NFC');
}

/**
 * 由密語導出 roomKey（SHA-256 hex 字串）。
 * 同一密語（正規化後相同）→ 同一 roomKey。
 */
export async function deriveRoomKey(passphrase: string): Promise<string> {
  const normalized = normalizePassphrase(passphrase);
  const data = new TextEncoder().encode(`${KEY_NAMESPACE}${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return encodeHex(new Uint8Array(digest));
}
