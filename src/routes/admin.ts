import { Hono, type Context } from 'hono';
import type { User } from '@supabase/supabase-js';

import { generateApiKey, type ApiKeyScope } from '../services/api-keys.ts';
import { getSupabase, extractToken } from '../services/supabase.ts';
import type { AppEnv, Bindings } from '../types/env.ts';
import { getDisplayName } from '../utils/display-name.ts';
import { sendUnauthorized } from './_helpers.ts';

export const adminRoutes = new Hono<AppEnv>();

// /api/admin/urls 的 subrequest 預算（Workers Free 方案每次請求最多 50 個，保留餘裕以 45 為上限）
// - 固定 3 個：auth.getUser（管理員判斷）、urls 查詢、auth.admin.listUsers（一次取回所有建立者）
// - 每列 1 個：url_clicks 點擊數 count
// - 剩下的預算才給 listUsers 第一頁裡找不到的建立者逐筆 getUserById（使用者超過 1000 人才會發生）
const ADMIN_SUBREQUEST_BUDGET = 45;
const ADMIN_URLS_FIXED_SUBREQUESTS = 3;
const ADMIN_URLS_DEFAULT_LIMIT = 20;
const ADMIN_URLS_MAX_LIMIT = 40; // 3 + 40 = 43，至少保留 2 個給 fallback
const ADMIN_USERS_PER_PAGE = 1000;

function getAdminEmails(adminEmails: string | undefined): string[] {
  return (adminEmails || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function getAdminUser(
  env: Bindings,
  authHeader: string | undefined
): Promise<{ id: string; email: string } | null> {
  const token = extractToken(authHeader);
  if (!token) return null;

  const supabase = getSupabase(env);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user || !user.email) return null;
  // email 必須已驗證：避免 Email provider 開著卻沒要求驗證時，有人先用管理員 email 註冊取得權限
  if (!user.email_confirmed_at) return null;
  if (!getAdminEmails(env.ADMIN_EMAILS).includes(user.email.toLowerCase())) return null;

  return { id: user.id, email: user.email };
}

adminRoutes.get('/api/admin/check', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  return c.json({ is_admin: !!admin });
});

adminRoutes.get('/api/admin/stats', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const supabase = getSupabase(c.env);
  const today = new Date().toISOString().split('T')[0];

  const [urlsResult, activeResult, clicksResult, todayResult, usersResult, feedbacksResult] =
    await Promise.all([
      supabase.from('urls').select('*', { count: 'exact', head: true }),
      supabase.from('urls').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('url_clicks').select('*', { count: 'exact', head: true }),
      supabase
        .from('url_clicks')
        .select('*', { count: 'exact', head: true })
        .gte('clicked_at', today),
      supabase.auth.admin.listUsers({ page: 1, perPage: ADMIN_USERS_PER_PAGE }),
      supabase.from('feedbacks').select('*', { count: 'exact', head: true }),
    ]);

  return c.json({
    total_urls: urlsResult.count || 0,
    active_urls: activeResult.count || 0,
    total_clicks: clicksResult.count || 0,
    today_clicks: todayResult.count || 0,
    total_users: usersResult.data?.users?.length || 0,
    total_feedbacks: feedbacksResult.count || 0,
  });
});

adminRoutes.get('/api/admin/urls', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(c.req.query('limit') || '') || ADMIN_URLS_DEFAULT_LIMIT, 1),
    ADMIN_URLS_MAX_LIMIT
  );
  const search = c.req.query('search') || '';
  const offset = (page - 1) * limit;

  const supabase = getSupabase(c.env);

  let query = supabase
    .from('urls')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`short_code.ilike.%${search}%,original_url.ilike.%${search}%`);
  }

  const { data: urls, count, error } = await query;

  if (error) {
    console.error('Admin fetch URLs error:', error);
    return c.json({ error: 'Failed to fetch URLs' }, 500);
  }

  // 建立者：一次 listUsers 取回（含 user_metadata，顯示名稱與其他頁面一致）。
  // 不用 public.user_profiles：它的 display_name 只在建立帳號時寫入，大多數是完整 email，沒有 Google 的 full_name。
  const userIds = [...new Set((urls || []).map((u) => u.created_by).filter(Boolean))] as string[];
  const userMap: Record<string, { email: string; display_name: string }> = {};
  const addCreator = (user: User) => {
    userMap[user.id] = {
      email: user.email || '',
      display_name: getDisplayName(user, '未知'),
    };
  };
  if (userIds.length > 0) {
    const wanted = new Set(userIds);
    const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: ADMIN_USERS_PER_PAGE,
    });
    if (usersError) {
      console.error('Admin list users error:', usersError.message);
    }
    for (const user of usersPage?.users || []) {
      if (wanted.has(user.id)) addCreator(user);
    }

    // 第一頁沒有的建立者才逐筆查，且不超過剩餘的 subrequest 預算（超過的建立者顯示為 null）
    const fallbackBudget = Math.max(
      ADMIN_SUBREQUEST_BUDGET - ADMIN_URLS_FIXED_SUBREQUESTS - (urls || []).length,
      0
    );
    const missing = userIds.filter((uid) => !userMap[uid]).slice(0, fallbackBudget);
    await Promise.all(
      missing.map(async (uid) => {
        const { data: userData } = await supabase.auth.admin.getUserById(uid);
        if (userData?.user) addCreator(userData.user);
      })
    );
  }

  const urlIds = (urls || []).map((u) => u.id);
  const clickCounts: Record<string, number> = {};
  if (urlIds.length > 0) {
    await Promise.all(
      urlIds.map(async (urlId) => {
        const { count: clicks } = await supabase
          .from('url_clicks')
          .select('*', { count: 'exact', head: true })
          .eq('url_id', urlId);
        clickCounts[urlId] = clicks || 0;
      })
    );
  }

  return c.json({
    data: (urls || []).map((url) => ({
      ...url,
      creator: userMap[url.created_by] || null,
      click_count: clickCounts[url.id] || 0,
    })),
    total: count || 0,
    page,
    limit,
  });
});

adminRoutes.get('/api/admin/users', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const supabase = getSupabase(c.env);
  const {
    data: { users },
    error,
  } = await supabase.auth.admin.listUsers({ page: 1, perPage: ADMIN_USERS_PER_PAGE });

  if (error) {
    console.error('Admin fetch users error:', error);
    return c.json({ error: 'Failed to fetch users' }, 500);
  }

  const { data: allUrls } = await supabase.from('urls').select('created_by');

  const urlCounts: Record<string, number> = {};
  for (const url of allUrls || []) {
    if (url.created_by) {
      urlCounts[url.created_by] = (urlCounts[url.created_by] || 0) + 1;
    }
  }

  return c.json(
    (users || []).map((user) => {
      return {
        id: user.id,
        email: user.email,
        display_name: getDisplayName(user, '未知'),
        url_count: urlCounts[user.id] || 0,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      };
    })
  );
});

adminRoutes.get('/api/admin/feedbacks', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('feedbacks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Admin fetch feedbacks error:', error);
    return c.json({ error: 'Failed to fetch feedbacks' }, 500);
  }

  const feedbacksWithAuthors = await Promise.all(
    (data || []).map(async (feedback) => {
      if (feedback.created_by) {
        const { data: userData } = await supabase.auth.admin.getUserById(feedback.created_by);
        if (userData?.user) {
          feedback.author = {
            id: userData.user.id,
            display_name: getDisplayName(userData.user, '匿名用戶'),
          };
        }
      }
      return feedback;
    })
  );

  return c.json(feedbacksWithAuthors);
});

adminRoutes.put('/api/admin/feedbacks/:id/status', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const id = c.req.param('id');
  const { status } = await c.req.json();
  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];

  if (!validStatuses.includes(status)) {
    return c.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400);
  }

  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('feedbacks')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    console.error('Admin update feedback status error:', error);
    return c.json({ error: 'Failed to update feedback status' }, 500);
  }

  return c.json(data);
});

// ============================================================
// 服務 API 金鑰（spec §6.6）
//
// 管理者判斷只用 getAdminUser；金鑰請求在 middleware/api-key-auth.ts 就被擋下（不在白名單 → 401）。
// 資料都經 SECURITY DEFINER RPC（supabase/migrations/20261103120902_api_keys.sql），
// 回傳的單筆不含 key_hash。完整金鑰只出現在發放（POST）的 201 回應，不進 RPC、不進記錄。
// ============================================================

/** 到期日選項（天）；null = 不過期。發放時省略 = 1 年 */
const API_KEY_EXPIRY_DAYS: readonly unknown[] = [90, 365];
const API_KEY_DEFAULT_EXPIRY_DAYS = 365;
const API_KEY_SCOPES: readonly ApiKeyScope[] = ['read', 'write'];
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const API_KEY_NOT_FOUND_BODY = { error: '找不到這把 API 金鑰' };
// api_key_owner_id：未刪除、至少登入過一次、目前未停權的 @tzuchi.org.tw 帳號（spec §6.6）
const OWNER_NOT_FOUND_MESSAGE = '找不到這位同仁（需先登入過 TCurl，且帳號未被停權）';
const INVALID_BODY_MESSAGE = '請求內容必須是 JSON 物件';
const INVALID_NAME_MESSAGE = '請輸入服務名稱';
const INVALID_OWNER_MESSAGE = '請輸入負責同仁的 email';
const INVALID_SCOPES_MESSAGE = '權限只能是 read、write，至少選一項';
const INVALID_EXPIRY_MESSAGE = '到期日只能是 90 天、1 年或不過期';

/** RPC 以 22023 拒絕的參數（error.message 為 RAISE 的內容）→ 給管理者看的訊息 */
const INVALID_PARAM_MESSAGES = new Map([
  ['invalid_name', INVALID_NAME_MESSAGE],
  ['invalid_scopes', INVALID_SCOPES_MESSAGE],
  ['invalid_expires_at', '到期日必須在未來'],
]);

/** 讀取 JSON 物件 body；不是合法 JSON 或不是物件回 null */
async function readJsonObject(c: Context<AppEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isScopeList(value: unknown): value is ApiKeyScope[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((scope) => API_KEY_SCOPES.includes(scope))
  );
}

/** expires_in_days 只能是 90、365 或 null（不過期） */
function isExpiryOption(value: unknown): value is number | null {
  return value === null || API_KEY_EXPIRY_DAYS.includes(value);
}

/** 到期時間 = 現在 + days 天；null = 不過期 */
function expiresAt(days: number | null): string | null {
  return days === null ? null : new Date(Date.now() + days * DAY_MS).toISOString();
}

/**
 * 金鑰 RPC 的錯誤（PostgREST 錯誤物件）→ 回應。P0002 有兩種意義，只能靠 message 區分。
 * 22023 只有管理者輸入的參數（INVALID_PARAM_MESSAGES）回 400；其他 22023（invalid_actor、
 * invalid_key_hash、invalid_key_prefix）是 Worker 傳錯參數，和其餘錯誤一樣
 * 只記 code 與 message（不記參數），回 500 且不回傳資料庫錯誤原文。
 */
function apiKeyRpcError(
  c: Context<AppEnv>,
  action: string,
  error: { code?: string; message?: string }
): Response {
  if (error.code === 'P0002' && error.message === 'owner_not_found') {
    return c.json({ error: OWNER_NOT_FOUND_MESSAGE }, 400);
  }
  if (error.code === 'P0002' && error.message === 'api_key_not_found') {
    return c.json(API_KEY_NOT_FOUND_BODY, 404);
  }
  const invalidParamMessage =
    error.code === '22023' ? INVALID_PARAM_MESSAGES.get(error.message ?? '') : undefined;
  if (invalidParamMessage) {
    return c.json({ error: invalidParamMessage }, 400);
  }
  console.error(`Admin ${action} API key error:`, error.code, error.message);
  return c.json({ error: `Failed to ${action} API key` }, 500);
}

// 金鑰管理的回應一律不快取：POST 201 含完整金鑰，列表含負責同仁 email。
// `/*` 也涵蓋 /api/admin/api-keys 本身；要註冊在下列路由之前
adminRoutes.use('/api/admin/api-keys/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

adminRoutes.get('/api/admin/api-keys', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const { data, error } = await getSupabase(c.env).rpc('list_api_keys');
  if (error) return apiKeyRpcError(c, 'list', error);

  return c.json(data ?? []);
});

adminRoutes.post('/api/admin/api-keys', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const body = await readJsonObject(c);
  if (!body) return c.json({ error: INVALID_BODY_MESSAGE }, 400);

  const {
    name,
    owner_email: ownerEmail,
    scopes = API_KEY_SCOPES,
    expires_in_days: days = API_KEY_DEFAULT_EXPIRY_DAYS,
  } = body;
  if (typeof name !== 'string') return c.json({ error: INVALID_NAME_MESSAGE }, 400);
  if (typeof ownerEmail !== 'string') return c.json({ error: INVALID_OWNER_MESSAGE }, 400);
  if (!isScopeList(scopes)) return c.json({ error: INVALID_SCOPES_MESSAGE }, 400);
  if (!isExpiryOption(days)) return c.json({ error: INVALID_EXPIRY_MESSAGE }, 400);

  // RPC 只收前綴與雜湊；負責同仁 email 原樣傳遞（大小寫、前後空白由 SQL 處理）
  const { key, prefix, hash } = await generateApiKey();
  const { data, error } = await getSupabase(c.env).rpc('create_api_key', {
    p_name: name,
    p_owner_email: ownerEmail,
    p_scopes: scopes,
    p_expires_at: expiresAt(days),
    p_key_prefix: prefix,
    p_key_hash: hash,
    p_actor: admin.id,
  });
  if (error) return apiKeyRpcError(c, 'create', error);

  // 完整金鑰唯一一次出現的地方
  return c.json({ ...data, key }, 201);
});

adminRoutes.post('/api/admin/api-keys/:id/revoke', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json(API_KEY_NOT_FOUND_BODY, 404);

  const { data, error } = await getSupabase(c.env).rpc('revoke_api_key', {
    p_key_id: id,
    p_actor: admin.id,
  });
  if (error) return apiKeyRpcError(c, 'revoke', error);

  return c.json(data);
});

/** 改名稱、到期日，或轉移負責同仁；省略的欄位不變 */
adminRoutes.put('/api/admin/api-keys/:id', async (c) => {
  const admin = await getAdminUser(c.env, c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json(API_KEY_NOT_FOUND_BODY, 404);

  const body = await readJsonObject(c);
  if (!body) return c.json({ error: INVALID_BODY_MESSAGE }, 400);

  const { name, owner_email: ownerEmail, expires_in_days: days } = body;
  if (name !== undefined && typeof name !== 'string') {
    return c.json({ error: INVALID_NAME_MESSAGE }, 400);
  }
  if (ownerEmail !== undefined && typeof ownerEmail !== 'string') {
    return c.json({ error: INVALID_OWNER_MESSAGE }, 400);
  }
  if (days !== undefined && !isExpiryOption(days)) {
    return c.json({ error: INVALID_EXPIRY_MESSAGE }, 400);
  }

  const { data, error } = await getSupabase(c.env).rpc('update_api_key', {
    p_key_id: id,
    p_actor: admin.id,
    p_name: name ?? null,
    p_expires_at: days === undefined ? null : expiresAt(days),
    p_clear_expiry: days === null,
    p_new_owner_email: ownerEmail ?? null,
  });
  if (error) return apiKeyRpcError(c, 'update', error);

  return c.json(data);
});
