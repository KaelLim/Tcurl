/**
 * 錯誤回應不回傳資料庫錯誤原文（只在伺服器 log 記錄）
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { jsonResponse, mockSupabaseFetch, pgrstNotFound, workerRequest } from './helpers/test-env.ts';

const AUTH = { Authorization: 'Bearer user-jwt' };
const URL_ID = '77777777-7777-7777-7777-777777777777';
const FEEDBACK_ID = '88888888-8888-8888-8888-888888888888';

/** 模擬 PostgREST 錯誤（內含資料表／欄位／constraint 名稱） */
function pgError(): Response {
  return jsonResponse(
    {
      code: '42703',
      message: 'column feedbacks.internal_secret_col does not exist',
      details: 'constraint urls_internal_secret_check',
      hint: 'internal_secret_hint',
    },
    400,
  );
}

const authUser = {
  id: '99999999-9999-9999-9999-999999999999',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'user@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockSupabaseFetch((call) => {
    if (call.url.pathname === '/auth/v1/user') return jsonResponse(authUser);
    if (call.url.pathname === '/rest/v1/feedback_votes' && call.method === 'GET') {
      return pgrstNotFound(); // 尚未投票 → 走新增投票
    }
    if (call.url.pathname === '/rest/v1/urls' && call.method === 'GET') {
      return jsonResponse({ short_code: 'abc123', qr_code_path: null });
    }
    if (call.url.pathname.startsWith('/rest/v1/')) return pgError();
    return undefined;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const json = { ...AUTH, 'Content-Type': 'application/json' };

test.each([
  ['GET /api/feedbacks', '/api/feedbacks', { headers: AUTH }],
  [
    'POST /api/feedbacks',
    '/api/feedbacks',
    { method: 'POST', headers: json, body: JSON.stringify({ title: 't', content: 'c' }) },
  ],
  [
    'PUT /api/feedbacks/:id',
    `/api/feedbacks/${FEEDBACK_ID}`,
    { method: 'PUT', headers: json, body: JSON.stringify({ title: 't' }) },
  ],
  ['DELETE /api/feedbacks/:id', `/api/feedbacks/${FEEDBACK_ID}`, { method: 'DELETE', headers: AUTH }],
  [
    'POST /api/feedbacks/:id/comments',
    `/api/feedbacks/${FEEDBACK_ID}/comments`,
    { method: 'POST', headers: json, body: JSON.stringify({ content: 'c' }) },
  ],
  [
    'DELETE /api/feedbacks/:id/comments/:commentId',
    `/api/feedbacks/${FEEDBACK_ID}/comments/${FEEDBACK_ID}`,
    { method: 'DELETE', headers: AUTH },
  ],
  ['POST /api/feedbacks/:id/vote', `/api/feedbacks/${FEEDBACK_ID}/vote`, { method: 'POST', headers: AUTH }],
  [
    'PATCH /api/urls/:id/qr-code',
    `/api/urls/${URL_ID}/qr-code`,
    { method: 'PATCH', headers: json, body: JSON.stringify({ qr_code_options: { a: 1 } }) },
  ],
])('%s：資料庫錯誤時回 500 但不含錯誤原文', async (_label, path, init) => {
  const { res } = await workerRequest(path, init as RequestInit);
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(text).not.toContain('internal_secret');
  expect(text).not.toContain('42703');
  expect(text).not.toContain('does not exist');
});
