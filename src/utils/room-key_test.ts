import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { deriveRoomKey, normalizePassphrase } from './room-key.ts';

Deno.test('normalizePassphrase 去除頭尾空白並做 NFC', () => {
  assertEquals(normalizePassphrase('  hello  '), 'hello');
});

Deno.test('deriveRoomKey 同密語得到同一 key', async () => {
  assertEquals(await deriveRoomKey('tzuchi-0718'), await deriveRoomKey('tzuchi-0718'));
});

Deno.test('deriveRoomKey 空白差異正規化後視為同一房', async () => {
  assertEquals(await deriveRoomKey('tzuchi-0718'), await deriveRoomKey('  tzuchi-0718  '));
});

Deno.test('deriveRoomKey 不同密語得到不同 key', async () => {
  assertNotEquals(await deriveRoomKey('room-a'), await deriveRoomKey('room-b'));
});

Deno.test('deriveRoomKey 產生 64 字元 hex', async () => {
  const k = await deriveRoomKey('x');
  assertEquals(k.length, 64);
  assert(/^[0-9a-f]+$/.test(k));
});
