/**
 * QR Code 樣式設定的格式檢查（src/utils/qr-code-options.ts）
 *
 * 服務 API 金鑰可以寫 qr_code_options（PATCH /api/urls/:id/qr-code），負責同仁在編輯頁打開
 * 「客製化 QR Code」時，其中的色碼會被放進 HTML 屬性。後端只接受網頁實際會送的 7 個鍵與格式
 * （與 public/docs/openapi.yaml 的 QrCodeOptions 一致），其他一律拒絕。
 * 前端跳脫的回歸測試在 tests/api_key_labels_ui_test.ts（編輯頁：QR Code 客製化對話框）。
 */

import { describe, expect, test } from 'vitest';

import { parseQrCodeOptions } from '../src/utils/qr-code-options.ts';

const FULL = {
  dotsColor: '#713d3d',
  bgColor: '#FFFFFF',
  bgOpacity: 0,
  dotsType: 'classy-rounded',
  cornersSquareType: 'extra-rounded',
  cornersDotType: 'rounded',
  showLogo: false,
};

describe('parseQrCodeOptions：接受', () => {
  test.each([
    ['網頁送出的完整設定', FULL],
    ['空物件（全部用預設）', {}],
    ['只有部分鍵', { dotsColor: '#000000', showLogo: true }],
    ['bgOpacity 100', { bgOpacity: 100 }],
  ])('%s', (_label, input) => {
    expect(parseQrCodeOptions(input)).toEqual({ ok: true, value: input });
  });

  test.each([
    ['dotsType', ['square', 'rounded', 'extra-rounded', 'dots', 'classy', 'classy-rounded']],
    ['cornersSquareType', ['square', 'dot', 'extra-rounded']],
    ['cornersDotType', ['square', 'dot', 'rounded']],
  ])('%s 的所有選項', (key, values) => {
    for (const v of values) {
      expect(parseQrCodeOptions({ [key]: v }).ok, `${key}=${v}`).toBe(true);
    }
  });

  test('回傳新物件（不是請求的同一個參考）', () => {
    const input = { ...FULL };
    const result = parseQrCodeOptions(input);
    expect(result.ok && result.value).not.toBe(input);
  });
});

describe('parseQrCodeOptions：拒絕', () => {
  test.each([
    ['null', null],
    ['陣列', [FULL]],
    ['字串', '#000000'],
    ['數字', 1],
  ])('qr_code_options 是 %s', (_label, input) => {
    expect(parseQrCodeOptions(input)).toEqual({ ok: false, message: 'qr_code_options 必須是物件' });
  });

  test.each([
    ['未知的鍵', { ...FULL, image: '/x.svg' }],
    ['舊的巢狀形狀', { dotsOptions: { color: '#000000' } }],
    ['__proto__', JSON.parse('{"__proto__": {"dotsColor": "#000000"}}')],
  ])('%s', (_label, input) => {
    const result = parseQrCodeOptions(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe(
      'qr_code_options 只接受 dotsColor、bgColor、bgOpacity、dotsType、cornersSquareType、cornersDotType、showLogo',
    );
  });

  test.each([
    ['dotsColor', '"><img src=x onerror=alert(1)>'],
    ['dotsColor', '#00000'],
    ['dotsColor', '#0000000'],
    ['dotsColor', '000000'],
    ['dotsColor', 'red'],
    ['dotsColor', '#00000g'],
    ['dotsColor', '#000000\n'],
    ['dotsColor', ['#000000']],
    ['dotsColor', null],
    ['bgColor', 'rgba(0,0,0,1)'],
    ['bgOpacity', -1],
    ['bgOpacity', 101],
    ['bgOpacity', 50.5],
    ['bgOpacity', '50'],
    ['bgOpacity', null],
    ['dotsType', 'Square'],
    ['dotsType', '<script>'],
    ['cornersSquareType', 'rounded'],
    ['cornersDotType', 'extra-rounded'],
    ['showLogo', 'true'],
    ['showLogo', 1],
  ])('%s = %j', (key, value) => {
    expect(parseQrCodeOptions({ ...FULL, [key]: value })).toEqual({
      ok: false,
      message: `qr_code_options.${key} 格式不正確`,
    });
  });
});
