/**
 * public/docs/openapi.yaml 與金鑰白名單（src/middleware/api-key-auth.ts 的 API_KEY_ROUTES）一致
 * （spec §6.3、§6.9：文件要標明哪些端點接受金鑰、需要哪個權限）；
 * public/docs/llm.txt 的金鑰段落也列出同一份端點與權限
 *
 * 專案沒有 YAML 套件：openapi.yaml 是手寫、固定 2 格縮排，這裡依縮排逐行掃描 paths 底下的
 * 端點、`security` 與說明文字。YAML 本身是否有效另以 PyYAML 檢查（見 Task 8 報告）。
 */

import { describe, expect, test } from 'vitest';

import { API_KEY_ROUTES } from '../src/middleware/api-key-auth.ts';

const FILES = import.meta.glob<string>(
  ['../public/docs/openapi.yaml', '../public/docs/llm.txt', '../cloudflare.config.ts'],
  { query: '?raw', import: 'default', eager: true },
);
const yaml = FILES['../public/docs/openapi.yaml'];
if (yaml === undefined) throw new Error('missing fixture: docs/openapi.yaml');
const llm = FILES['../public/docs/llm.txt'];
if (llm === undefined) throw new Error('missing fixture: docs/llm.txt');
const config = FILES['../cloudflare.config.ts'];
if (config === undefined) throw new Error('missing fixture: cloudflare.config.ts');

/** cloudflare.config.ts 裡某個 Rate Limiting binding 的上限與時間窗（文件寫的數字要與它相同） */
function rateLimitOf(binding: string): { limit: string; period: string } {
  const match = new RegExp(
    `${binding}: bindings\\.rateLimit\\(\\{[^}]*simple: \\{ limit: (\\d+), period: (\\d+) \\}`,
  ).exec(config!);
  if (!match) throw new Error(`cloudflare.config.ts 找不到 ${binding}`);
  return { limit: match[1], period: match[2] };
}

interface Operation {
  /** 例如 `GET /api/urls/:id`（路徑參數 `{id}` 換成 Hono 的 `:id`） */
  route: string;
  /** 端點自己的 security；沒寫則為 null（沿用文件層級） */
  security: string[] | null;
  /** 端點區塊的所有文字（summary、description…） */
  text: string;
  responses: string[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** 依縮排掃描 paths 底下的端點 */
function scanOperations(src: string): Operation[] {
  const lines = src.split('\n');
  const start = lines.indexOf('paths:');
  const ops: Operation[] = [];
  let path = '';
  let op: Operation | null = null;
  let section: 'security' | 'responses' | null = null;

  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // 下一個頂層鍵（components:）
    const pathMatch = line.match(/^ {2}(\/\S*):\s*$/);
    if (pathMatch) {
      path = pathMatch[1].replace(/\{(\w+)\}/g, ':$1');
      op = null;
      continue;
    }
    const methodMatch = line.match(/^ {4}(\w+):\s*$/);
    if (methodMatch && METHODS.includes(methodMatch[1])) {
      op = { route: `${methodMatch[1].toUpperCase()} ${path}`, security: null, text: '', responses: [] };
      ops.push(op);
      section = null;
      continue;
    }
    if (!op) continue;
    op.text += `${line}\n`;

    const key = line.match(/^ {6}([\w-]+):/);
    if (key) {
      section = key[1] === 'security' || key[1] === 'responses' ? key[1] : null;
      if (key[1] === 'security') op.security = [];
      continue;
    }
    const scheme = line.match(/^ {8}- (\w+): \[\]\s*$/);
    if (section === 'security' && scheme) op.security!.push(scheme[1]);
    const status = line.match(/^ {8}'(\d{3})':/);
    if (section === 'responses' && status) op.responses.push(status[1]);
  }
  return ops;
}

/** 頂層 `security:` 的 scheme 名稱 */
function globalSecurity(src: string): string[] {
  const m = src.match(/^security:\n((?: {2}- \w+: \[\]\n)+)/m);
  return m ? [...m[1].matchAll(/- (\w+):/g)].map((x) => x[1]) : [];
}

const ops = scanOperations(yaml);
const effective = (op: Operation) => op.security ?? globalSecurity(yaml);
const keyOps = ops.filter((op) => effective(op).includes('ApiKeyAuth'));
const whitelist = API_KEY_ROUTES.map((r) => `${r.method} ${r.path}`);

describe('openapi.yaml：服務 API 金鑰', () => {
  test('掃描得到文件裡的端點（防止掃描失效讓其他測試空轉）', () => {
    expect(ops.length).toBeGreaterThanOrEqual(15);
    expect(ops.map((op) => op.route)).toContain('GET /api/urls/:id');
    expect(globalSecurity(yaml)).toEqual(['BearerAuth']);
  });

  test('securitySchemes.ApiKeyAuth：http bearer，bearerFormat tcurl_sk_…', () => {
    const block = yaml.match(/^ {4}ApiKeyAuth:\n((?: {6}.*\n|\n)+)/m)?.[1] ?? '';
    expect(block).toMatch(/^ {6}type: http$/m);
    expect(block).toMatch(/^ {6}scheme: bearer$/m);
    expect(block).toMatch(/^ {6}bearerFormat: 'tcurl_sk_…'$/m);
  });

  test('標示 ApiKeyAuth 的端點與白名單完全一致（每個白名單端點都有文件）', () => {
    expect(keyOps.map((op) => op.route).sort()).toEqual([...whitelist].sort());
  });

  test('接受金鑰的端點照樣接受網頁登入的 JWT（BearerAuth 與 ApiKeyAuth 擇一）', () => {
    for (const op of keyOps) expect(op.security, op.route).toEqual(['BearerAuth', 'ApiKeyAuth']);
  });

  test('接受金鑰的端點註明需要的權限，與白名單相同', () => {
    for (const route of API_KEY_ROUTES) {
      const op = keyOps.find((o) => o.route === `${route.method} ${route.path}`);
      const scopes = [...(op?.text ?? '').matchAll(/API 金鑰需要 `(\w+)` 權限/g)].map((m) => m[1]);
      expect(scopes, `${route.method} ${route.path}`).toEqual([route.scope]);
    }
  });

  test('接受金鑰的端點列出 401、403、404（有 :id 時）、429', () => {
    for (const op of keyOps) {
      expect(op.responses, op.route).toEqual(expect.arrayContaining(['401', '403', '429']));
      if (op.route.includes(':id')) expect(op.responses, op.route).toContain('404');
    }
  });

  test('info.description 說明發放方式、權限 read/write、401/403/404/429/503 的意義', () => {
    const info = yaml.slice(0, yaml.indexOf('\nservers:'));
    expect(info).toMatch(/^ {2}description: \|/m);
    for (const text of ['管理者', 'tcurl_sk_', '`read`', '`write`', 'API 金鑰無效或已失效']) {
      expect(info, text).toContain(text);
    }
    for (const status of ['401', '403', '404', '429', '503']) {
      expect(info, status).toMatch(new RegExp(`\\| ${status} \\|`));
    }
  });

  test('info.description 說明 /api/* 的公開端點帶著金鑰也會得到 401（文件裡的公開端點逐一點名）', () => {
    const info = yaml.slice(0, yaml.indexOf('\nservers:'));
    expect(info).toContain('帶著金鑰也會得到 401');
    // security: [] 的 /api/* 端點（/api/auth/* 已列在拒絕金鑰的端點）
    const publicApi = ops
      .filter((op) => op.security?.length === 0)
      .map((op) => op.route.split(' ')[1].replace(/:(\w+)/g, '{$1}'))
      .filter((path) => path.startsWith('/api/') && !path.startsWith('/api/auth/'));
    expect(publicApi).toContain('/api/urls/{shortCode}/verify-password');
    for (const path of [...publicApi, '/api/ad/*', '/api/version']) {
      expect(info, path).toContain(`\`${path}\``);
    }
    // 轉址與廣告頁不在 /api/* 底下，中介層不看 Authorization
    expect(info).toContain('`/s/{shortCode}`');
  });
});

/** llm.txt 的 `### Service API Keys` 段落（到下一個 `## ` 標題為止） */
function llmKeySection(src: string): string {
  const start = src.indexOf('### Service API Keys');
  if (start < 0) return '';
  const end = src.indexOf('\n## ', start);
  return src.slice(start, end < 0 ? undefined : end);
}

describe('llm.txt：服務 API 金鑰', () => {
  const section = llmKeySection(llm);

  test('有 Service API Keys 段落，寫明 Authorization: Bearer tcurl_sk_…', () => {
    expect(section).not.toBe('');
    expect(section).toContain('Authorization: Bearer tcurl_sk_');
  });

  test('端點表與白名單完全一致（方法、路徑、權限）', () => {
    const row = /^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \| `(\w+)` \|$/gm;
    const rows = [...section.matchAll(row)].map(
      ([, method, path, scope]) => `${method} ${path.replace(/\{(\w+)\}/g, ':$1')} ${scope}`,
    );
    const expected = API_KEY_ROUTES.map((r) => `${r.method} ${r.path} ${r.scope}`);
    expect(rows.sort()).toEqual(expected.sort());
  });

  test('說明只能存取這把金鑰自己建立的短網址、其他端點帶金鑰回 401，並列出錯誤碼', () => {
    expect(section).toMatch(/only access short URLs created with that same key/);
    expect(section).toMatch(/other `\/api\/\*` endpoint[^\n]*`401`/);
    for (const status of ['401', '403', '404', '429', '503']) {
      expect(section, status).toContain(`\`${status}\``);
    }
    expect(section).toContain('Retry-After');
  });

  test('429 寫明每把金鑰與每個來源 IP 的上限（數字與 cloudflare.config.ts、openapi 的 429 說明相同）', () => {
    const perKey = rateLimitOf('API_KEY_RATE_LIMITER');
    const perIp = rateLimitOf('API_KEY_VERIFY_RATE_LIMITER');
    const line = section.split('\n').find((l) => l.startsWith('- `429`')) ?? '';
    expect(line).toContain(`each key: ${perKey.limit} requests per ${perKey.period} seconds`);
    expect(line).toMatch(
      new RegExp(`same public IP[^\\n]*: ${perIp.limit} requests per ${perIp.period} seconds in total`),
    );

    const row = yaml.split('\n').find((l) => l.trim().startsWith('| 429 |')) ?? '';
    expect(row).toContain(`每 ${perKey.period} 秒 ${perKey.limit} 次`);
    expect(row).toContain(`每 ${perIp.period} 秒最多 ${perIp.limit} 次`);
  });
});
