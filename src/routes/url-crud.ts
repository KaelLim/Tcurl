/**
 * URL CRUD 路由
 *
 * 提供短網址的建立、讀取、更新、刪除操作
 *
 * @module routes/url-crud
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import bcrypt from 'bcryptjs';

import type { ApiKeyPrincipal } from '../services/api-keys.ts';
import { getSupabase, getSupabaseForApiKey, extractToken } from '../services/supabase.ts';
import type { SupabaseEnv } from '../services/supabase.ts';
import { invalidateUrl } from '../services/redirect-cache.ts';
import type { AppEnv } from '../types/env.ts';
import { parseQrCodeOptions } from '../utils/qr-code-options.ts';
import { generateShortCode, isValidShortCode } from '../utils/shortcode.ts';
import { validateUrl } from '../utils/url-validator.ts';
import {
  getApiKey,
  getUserClientFromRequest,
  runInBackground,
  scopeToCaller,
  sendUnauthorized,
} from './_helpers.ts';

export const urlCrudRoutes = new Hono<AppEnv>();

/** bcrypt cost（與舊版 deno.land/x/bcrypt 預設值相同） */
const BCRYPT_ROUNDS = 10;

/** PUT /api/urls/:id 可由請求直接更新的欄位（password / password_protected 另外處理） */
const UPDATABLE_FIELDS = ['original_url', 'expires_at', 'is_active'] as const;

/**
 * 金鑰呼叫者的 GET/POST/PUT /api/urls* 回應只含這些欄位（= openapi.yaml 的 UrlRecord）。
 * 不含 password_hash：負責同仁在網頁上替金鑰的短網址設了人工密碼時，外部服務不能拿到 bcrypt 雜湊離線破解；
 * 之後新增的欄位也不會自動回給金鑰。使用者（JWT）照舊回整列（`*`）。
 */
const API_KEY_URL_COLUMNS =
  'id, short_code, original_url, password_protected, expires_at, qr_code_generated, ' +
  'qr_code_path, qr_code_options, is_active, created_by, api_key_id, created_at, updated_at';

/** 依呼叫者決定 urls 回傳的欄位：金鑰 → API_KEY_URL_COLUMNS；使用者 → `*`（與以前相同） */
function urlColumnsFor(key: ApiKeyPrincipal | undefined): string {
  return key ? API_KEY_URL_COLUMNS : '*';
}

/**
 * urlColumnsFor 查回的一列。欄位清單是執行期才決定的字串，supabase-js 無法從型別推論結果，
 * 所以在 `.select<string, UrlRow>()` 明確指定（沒有產生資料庫型別，只列 handler 會用到的欄位）
 */
type UrlRow = Record<string, unknown> & { short_code: string };

/** 密碼驗證限流的時間窗（秒），上限設定在 cloudflare.config.ts 的 PASSWORD_RATE_LIMITER */
const PASSWORD_RATE_LIMIT_PERIOD_SECONDS = 60;

/**
 * 密碼驗證專屬限流（鍵：CF-Connecting-IP + 短碼）。
 * 與全站限流相同：RATE_LIMIT_ENABLED=false 時停用、限流服務異常時放行。
 */
async function allowPasswordAttempt(c: Context<AppEnv>, shortCode: string): Promise<boolean> {
  const limiter = c.env.PASSWORD_RATE_LIMITER;
  if (c.env.RATE_LIMIT_ENABLED === 'false' || !limiter) return true;

  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  try {
    const { success } = await limiter.limit({ key: `${ip}:${shortCode}` });
    return success;
  } catch (err) {
    console.error('Password rate limiter error:', err instanceof Error ? err.message : err);
    return true;
  }
}

/**
 * 金鑰建立的短網址（api_key_id 非 null）附上金鑰名稱與是否已撤銷（spec §6.7 的「由 API：〈名稱〉建立」）。
 * api_keys 開了 RLS 且沒有 policy，只有 service role 讀得到，所以兩種呼叫者都用 service client 查。
 * 查不到或查詢失敗時原樣回傳：標示只是附帶資訊，不影響取得短網址。
 */
async function withApiKeyInfo(
  env: SupabaseEnv,
  row: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (typeof row.api_key_id !== 'string') return row;
  try {
    const { data, error } = await getSupabase(env)
      .from('api_keys')
      .select('name, revoked_at')
      .eq('id', row.api_key_id)
      .single();
    if (error || !data) {
      console.error('Failed to load API key info:', error?.code, error?.message);
      return row;
    }
    return { ...row, api_key_name: data.name, api_key_revoked: data.revoked_at !== null };
  } catch (err) {
    console.error('Failed to load API key info:', err instanceof Error ? err.message : err);
    return row;
  }
}

// ============================================================
// 短網址 CRUD
// ============================================================
//
// 每個 handler 依呼叫者選 client：
// - 服務 API 金鑰：getSupabaseForApiKey（service role，繞過 RLS）→ 對 urls 的查詢／修改／刪除
//   一律經 scopeToCaller（= scopeToApiKey：created_by = 負責同仁且 api_key_id = 這把金鑰），
//   不屬於這把金鑰的一律 404；不呼叫 auth.getUser
// - 使用者：user client（RLS），行為與以前相同

/**
 * 創建短網址（需要登入）
 */
urlCrudRoutes.post('/api/urls', async (c) => {
  const key = getApiKey(c);
  const client = key ? getSupabaseForApiKey(c.env, key.keyId) : getUserClientFromRequest(c);
  if (!client) {
    return sendUnauthorized(c);
  }

  const body = await c.req.json();
  const { original_url, short_code, expires_at } = body;

  // 驗證原始 URL
  if (!original_url) {
    return c.json({ error: 'original_url is required' }, 400);
  }

  // URL 格式與安全性驗證（防止 SSRF 攻擊）
  const urlValidation = validateUrl(original_url);
  if (!urlValidation.valid) {
    return c.json(
      {
        error: 'Invalid URL',
        message: urlValidation.reason,
      },
      400
    );
  }

  // 擁有者：金鑰 → 負責同仁；使用者 → JWT 的使用者。
  // 金鑰的短網址以資料庫為準：guard_url_api_key_id trigger 新增時會把 created_by 覆寫成金鑰「目前」的
  // 負責同仁（驗證與寫入之間金鑰被轉移也不會留在原負責人名下），這裡的 key.ownerId 只是驗證當下的值
  let ownerId: string;
  if (key) {
    ownerId = key.ownerId;
  } else {
    const token = extractToken(c.req.header('Authorization'));
    const supabase = getSupabase(c.env);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token!);

    if (userError || !user) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    ownerId = user.id;
  }

  // 驗證自訂短代碼格式
  if (short_code && !isValidShortCode(short_code)) {
    return c.json({ error: 'Invalid short code format' }, 400);
  }

  // 插入資料庫（使用重試機制處理競爭條件）
  const maxAttempts = 10;
  let attempts = 0;
  let data: Record<string, unknown> | null = null;

  while (attempts < maxAttempts) {
    const currentShortCode =
      short_code || generateShortCode(Number(c.env.SHORT_CODE_LENGTH) || 6);

    const { data: insertedData, error } = await client
      .from('urls')
      .insert({
        short_code: currentShortCode,
        original_url,
        expires_at,
        created_by: ownerId,
        // 金鑰建立的短網址記下是哪把金鑰（只有 service role 能設定，見 guard_url_api_key_id）
        ...(key ? { api_key_id: key.keyId } : {}),
      })
      .select<string, UrlRow>(urlColumnsFor(key))
      .single();

    if (!error) {
      data = insertedData;
      break;
    }

    // 檢查是否為 UNIQUE 違反錯誤
    if (error.code === '23505') {
      if (short_code) {
        return c.json({ error: 'Short code already exists' }, 409);
      }
      attempts++;
      continue;
    }

    console.error('Database error:', error);
    return c.json({ error: 'Failed to create short URL' }, 500);
  }

  if (!data) {
    return c.json({ error: 'Failed to generate unique short code' }, 500);
  }

  // 未設定 BASE_URL 時以請求本身的網域為準（經 Pages 入口轉進來時即為使用者看到的網域）
  const baseUrl = c.env.BASE_URL || new URL(c.req.url).origin;
  const shortUrl = `${baseUrl}/s/${data.short_code}`;

  return c.json(
    {
      ...data,
      short_url: shortUrl,
    },
    201
  );
});

/**
 * 獲取單個短網址詳情（需要登入）
 */
urlCrudRoutes.get('/api/urls/:id', async (c) => {
  const key = getApiKey(c);
  const client = key ? getSupabaseForApiKey(c.env, key.keyId) : getUserClientFromRequest(c);
  if (!client) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');

  // 查不到、不屬於呼叫者，或 id 不是 UUID（PostgREST 22P02）都是 404
  const lookup = client.from('urls').select<string, UrlRow>(urlColumnsFor(key)).eq('id', id);
  const { data, error } = await scopeToCaller(lookup, key).single();

  if (error || !data) {
    return c.json({ error: 'URL not found' }, 404);
  }

  return c.json(await withApiKeyInfo(c.env, data));
});

/**
 * 更新短網址（需要登入）
 */
urlCrudRoutes.put('/api/urls/:id', async (c) => {
  const key = getApiKey(c);
  const client = key ? getSupabaseForApiKey(c.env, key.keyId) : getUserClientFromRequest(c);
  if (!client) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');
  const body = await c.req.json();
  const { password, password_protected } = body;

  // 白名單：其他欄位（qr_code_path、created_by、user_id、password_hash、short_code…）一律忽略
  const updates: Record<string, string | boolean | null | undefined> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  // 型別檢查
  if (
    (updates.original_url !== undefined && typeof updates.original_url !== 'string') ||
    (updates.expires_at !== undefined &&
      updates.expires_at !== null &&
      typeof updates.expires_at !== 'string') ||
    (updates.is_active !== undefined && typeof updates.is_active !== 'boolean') ||
    (password_protected !== undefined && typeof password_protected !== 'boolean') ||
    (password !== undefined && password !== null && typeof password !== 'string')
  ) {
    return c.json({ error: 'Invalid field type' }, 400);
  }

  // 處理密碼保護
  if (password_protected !== undefined) {
    updates.password_protected = password_protected;

    if (password_protected && password) {
      updates.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    } else if (!password_protected) {
      updates.password_hash = null;
    }
  } else if (password) {
    updates.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    updates.password_protected = true;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No updatable fields provided' }, 400);
  }

  // 如果更新 original_url，需要驗證
  if (typeof updates.original_url === 'string') {
    const urlValidation = validateUrl(updates.original_url);
    if (!urlValidation.valid) {
      return c.json(
        {
          error: 'Invalid URL',
          message: urlValidation.reason,
        },
        400
      );
    }
  }

  const { data, error } = await scopeToCaller(client.from('urls').update(updates).eq('id', id), key)
    .select<string, UrlRow>(urlColumnsFor(key))
    .single();

  if (error || !data) {
    return c.json({ error: 'URL not found' }, 404);
  }

  // 目的網址、啟用狀態、到期時間、密碼保護都會影響轉址：清掉轉址快取
  await invalidateUrl(c.env.REDIRECT_CACHE, data.short_code);

  return c.json(data);
});

/**
 * 更新 QR Code 配置（需要登入）
 */
urlCrudRoutes.patch('/api/urls/:id/qr-code', async (c) => {
  const key = getApiKey(c);
  const client = key ? getSupabaseForApiKey(c.env, key.keyId) : getUserClientFromRequest(c);
  if (!client) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');
  const body = await c.req.json();
  // qr_code_data_url（PNG）仍可傳入但不再寫檔：QR 一律在瀏覽器以 qr-code-styling 即時產生
  const { qr_code_options } = body;

  if (!qr_code_options) {
    return c.json({ error: 'qr_code_options is required' }, 400);
  }

  // 只接受網頁實際會送的鍵與格式：讀回時色碼會放進負責同仁編輯頁的 HTML，
  // 金鑰（外部服務）不能藉此對負責同仁注入腳本（spec §4 反目標 1）
  const parsed = parseQrCodeOptions(qr_code_options);
  if (!parsed.ok) {
    return c.json({ error: 'Invalid qr_code_options', message: parsed.message }, 400);
  }

  // 先確認 URL 存在且屬於呼叫者（使用者：RLS；金鑰：scopeToCaller）
  const lookup = client.from('urls').select('short_code, qr_code_path').eq('id', id);
  const { data: urlData, error: fetchError } = await scopeToCaller(lookup, key).single();

  if (fetchError || !urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  // 準備更新資料（只保存 QR 樣式設定）
  const updates: Record<string, unknown> = {
    qr_code_options: parsed.value,
    qr_code_generated: true,
  };

  // 更新資料庫
  const { data, error } = await scopeToCaller(client.from('urls').update(updates).eq('id', id), key)
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to update QR Code config:', error);
    return c.json({ error: 'Failed to update QR Code configuration' }, 500);
  }

  // 回應格式維持相容；不再產生 PNG 檔，qr_code_path 固定為 null
  return c.json({
    success: true,
    qr_code_path: null,
    qr_code_options: parsed.value,
  });
});

/**
 * 刪除短網址（需要登入）
 */
urlCrudRoutes.delete('/api/urls/:id', async (c) => {
  const key = getApiKey(c);
  const client = key ? getSupabaseForApiKey(c.env, key.keyId) : getUserClientFromRequest(c);
  if (!client) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');

  // 先確認 URL 存在且屬於呼叫者（使用者：RLS；金鑰：scopeToCaller）
  const lookup = client.from('urls').select('short_code').eq('id', id);
  const { data: urlData } = await scopeToCaller(lookup, key).single();

  if (!urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  // 從資料庫刪除
  const { error } = await scopeToCaller(client.from('urls').delete().eq('id', id), key);

  if (error) {
    console.error(error);
    return c.json({ error: 'Failed to delete URL' }, 500);
  }

  await invalidateUrl(c.env.REDIRECT_CACHE, urlData.short_code);

  return c.json({ message: 'URL deleted successfully' });
});

// ============================================================
// 密碼驗證路由
// ============================================================

/**
 * 驗證密碼保護的短網址
 */
urlCrudRoutes.post('/api/urls/:shortCode/verify-password', async (c) => {
  const shortCode = c.req.param('shortCode');

  if (!(await allowPasswordAttempt(c, shortCode))) {
    c.header('Retry-After', String(PASSWORD_RATE_LIMIT_PERIOD_SECONDS));
    return c.json(
      {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `嘗試次數過多，請在 ${PASSWORD_RATE_LIMIT_PERIOD_SECONDS} 秒後重試`,
      },
      429
    );
  }

  const body = await c.req.json();
  const { password } = body;

  if (!password) {
    return c.json({ error: 'Password is required' }, 400);
  }

  const supabase = getSupabase(c.env);
  const { data, error } = await supabase
    .from('urls')
    .select('*')
    .eq('short_code', shortCode)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return c.json({ error: 'Short URL not found' }, 404);
  }

  // 檢查過期
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return c.json({ error: 'Short URL has expired' }, 410);
  }

  // 檢查是否設定密碼保護
  if (!data.password_protected || !data.password_hash) {
    return c.json({ error: 'This URL is not password protected' }, 400);
  }

  // 驗證密碼（加入固定延遲防止 Timing Attack）
  const startTime = Date.now();
  const isValid = await bcrypt.compare(password, data.password_hash);
  const elapsed = Date.now() - startTime;

  const minDelay = 500;
  if (elapsed < minDelay) {
    await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
  }

  if (!isValid) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  // 記錄點擊（背景執行，不等待）
  // 不會重複計算：/s/:code、/ad/:code 遇到密碼保護時只回密碼頁、不記點擊；
  // 密碼頁（renderPasswordPage、public/password.html）驗證成功後直接導向 original_url，不會再經過 /s/。
  // 所以這裡是密碼保護連結唯一的點擊記錄。
  const clickTask = supabase
    .from('url_clicks')
    .insert({
      url_id: data.id,
      user_agent: c.req.header('user-agent') || null,
      // 密碼頁會帶上是否由 QR Code 進入（/s/:code?qr=1），與 /s/ 的 event_type 規則一致
      event_type: body.qr === true ? 'qr_scan' : 'link_click',
    })
    .then(({ error: clickError }) => {
      if (clickError) {
        console.error(`[ClickRecord] Failed to record click for ${shortCode}:`, clickError.message);
      }
    });
  runInBackground(c, clickTask);

  return c.json({
    original_url: data.original_url,
    short_code: data.short_code,
  });
});
