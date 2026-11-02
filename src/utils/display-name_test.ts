/**
 * 顯示名稱 fallback：中文姓名 → full_name → name → display_name → email（@ 前段）→ fallback
 */

import { expect, test } from 'vitest';
import { getDisplayName } from './display-name.ts';

const email = 'someone@example.com';

test.each([
  [
    '舊 Keycloak 帳號：中文姓 + 名',
    { chinese_lastname: '王', chinese_firstname: '小明', full_name: 'Xiao Ming Wang' },
    '王小明',
  ],
  ['只有中文名、沒有姓 → full_name', { chinese_firstname: '小明', full_name: 'Xiao Ming Wang' }, 'Xiao Ming Wang'],
  ['Google：full_name', { full_name: 'Xiao Ming Wang', name: 'Ming' }, 'Xiao Ming Wang'],
  ['Google：只有 name', { name: 'Ming' }, 'Ming'],
  ['name 優先於 display_name', { name: 'Ming', display_name: '小明' }, 'Ming'],
  ['email 註冊帳號：只有 display_name', { display_name: '小明' }, '小明'],
  ['沒有任何名稱 → email @ 前段', {}, 'someone'],
  ['非字串的 metadata 會被忽略', { full_name: 123, name: { x: 1 }, display_name: true }, 'someone'],
])('%s', (_label, meta, expected) => {
  expect(getDisplayName({ email, user_metadata: meta }, '未知')).toBe(expected);
});

test('沒有 email 也沒有名稱時用 fallback', () => {
  expect(getDisplayName({ email: null, user_metadata: null }, '匿名用戶')).toBe('匿名用戶');
});
