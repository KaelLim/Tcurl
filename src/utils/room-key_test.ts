import { expect, test } from 'vitest';
import { deriveRoomKey, normalizePassphrase } from './room-key.ts';

test('normalizePassphrase 去除頭尾空白並做 NFC', () => {
  expect(normalizePassphrase('  hello  ')).toBe('hello');
});

test('deriveRoomKey 同密語得到同一 key', async () => {
  expect(await deriveRoomKey('tzuchi-0718')).toBe(await deriveRoomKey('tzuchi-0718'));
});

test('deriveRoomKey 空白差異正規化後視為同一房', async () => {
  expect(await deriveRoomKey('tzuchi-0718')).toBe(await deriveRoomKey('  tzuchi-0718  '));
});

test('deriveRoomKey 不同密語得到不同 key', async () => {
  expect(await deriveRoomKey('room-a')).not.toBe(await deriveRoomKey('room-b'));
});

test('deriveRoomKey 產生 64 字元 hex', async () => {
  const k = await deriveRoomKey('x');
  expect(k.length).toBe(64);
  expect(/^[0-9a-f]+$/.test(k)).toBe(true);
});

test('deriveRoomKey 與舊版（@std/encoding encodeHex）輸出一致', async () => {
  // SHA-256("tcurl-room:v1:x") 的小寫 hex，確保改用自寫 hex 後既有房間 key 不變
  expect(await deriveRoomKey('x')).toBe(
    'c96a52b7e7f0841a28a7e5b66bd83f7ab46cde2747373b4170cf5e3ca4409b10',
  );
});
