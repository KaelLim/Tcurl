/**
 * 測試用 Workers env 替身
 *
 * - ASSETS：從 public/ 讀檔（行為同 htmlHandling: 'none'：只有完全相符的路徑才找得到）
 * - ROOMS_KV：in-memory KV（支援 list 分頁）
 * - RATE_LIMITER / REDIRECT_RATE_LIMITER / PASSWORD_RATE_LIMITER：可控制結果的假限流器
 * - Supabase：攔截全域 fetch，只允許打到假的 SUPABASE_URL
 */

import { vi } from 'vitest';

import app from '../../src/main.ts';
import type { Bindings } from '../../src/types/env.ts';
import { createMemoryKv } from './memory-kv.ts';

export { createMemoryKv };

export const TEST_SUPABASE_URL = 'https://supabase.test';

// ============================================================
// ASSETS（public/ 文字檔）
// ============================================================

const PUBLIC_FILES = import.meta.glob<string>(
  '../../public/**/*.{html,js,json,svg,txt,yaml,md}',
  { query: '?raw', import: 'default', eager: true },
);

const assetMap = new Map<string, string>();
for (const [key, content] of Object.entries(PUBLIC_FILES)) {
  assetMap.set(key.replace(/^\.\.\/\.\.\/public/, ''), content);
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  yaml: 'application/yaml',
  md: 'text/markdown; charset=utf-8',
};

function toUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

export function createAssetsFetcher(): Fetcher {
  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const { pathname } = toUrl(input);
      const body = assetMap.get(decodeURIComponent(pathname));
      if (body === undefined) {
        return new Response('Not Found', { status: 404 });
      }
      const ext = pathname.slice(pathname.lastIndexOf('.') + 1);
      return new Response(body, {
        headers: { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' },
      });
    },
  } as unknown as Fetcher;
}

// ============================================================
// Rate Limiting
// ============================================================

export function createRateLimiter(success = true) {
  return { limit: vi.fn(async (_options: { key: string }) => ({ success })) };
}

// ============================================================
// Env / ExecutionContext
// ============================================================

export function createTestEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ASSETS: createAssetsFetcher(),
    ROOMS_KV: createMemoryKv() as unknown as KVNamespace,
    REDIRECT_CACHE: createMemoryKv() as unknown as KVNamespace,
    RATE_LIMITER: createRateLimiter() as unknown as RateLimit,
    REDIRECT_RATE_LIMITER: createRateLimiter() as unknown as RateLimit,
    PASSWORD_RATE_LIMITER: createRateLimiter() as unknown as RateLimit,
    SUPABASE_URL: TEST_SUPABASE_URL,
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    ADMIN_EMAILS: 'admin@example.com',
    BASE_URL: 'https://tcurl.test',
    CORS_ORIGIN: 'https://tcurl.test',
    ...overrides,
  };
}

export function createExecutionContext() {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: vi.fn((p: Promise<unknown>) => {
      tasks.push(p);
    }),
    passThroughOnException: () => {},
    props: {},
  };
  return {
    ctx: ctx as unknown as ExecutionContext,
    waitUntil: ctx.waitUntil,
    /** 等待所有 waitUntil 背景工作完成 */
    settle: () => Promise.all(tasks),
  };
}

/** 以測試 env 呼叫 Worker（等同 Workers runtime 呼叫 default export 的 fetch） */
export async function workerRequest(
  path: string,
  init?: RequestInit,
  env: Bindings = createTestEnv(),
) {
  const exec = createExecutionContext();
  const res = await app.request(path, init, env, exec.ctx);
  return { res, ...exec };
}

// ============================================================
// Supabase（攔截 fetch）
// ============================================================

export interface SupabaseCall {
  method: string;
  url: URL;
  headers: Headers;
  body: string | null;
}

export type SupabaseHandler = (
  call: SupabaseCall,
) => Response | undefined | Promise<Response | undefined>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** PostgREST 找不到單筆資料（.single()）時的回應 */
export function pgrstNotFound(): Response {
  return jsonResponse(
    {
      code: 'PGRST116',
      details: 'The result contains 0 rows',
      hint: null,
      message: 'JSON object requested, multiple (or no) rows returned',
    },
    406,
  );
}

/**
 * 攔截全域 fetch 模擬 Supabase。
 * handler 沒處理的請求一律回 401（等同使用無效金鑰），不會連到任何真實服務。
 */
export function mockSupabaseFetch(handler?: SupabaseHandler) {
  const calls: SupabaseCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== TEST_SUPABASE_URL) {
      throw new Error(`Unexpected outbound fetch: ${url.origin}`);
    }
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text();
    const call: SupabaseCall = { method: request.method, url, headers: request.headers, body };
    calls.push(call);
    const res = handler ? await handler(call) : undefined;
    return res ?? jsonResponse({ message: 'Invalid API key' }, 401);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fetch: fn };
}
