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

import { getSupabase, extractToken } from '../services/supabase.ts';
import { invalidateUrl } from '../services/redirect-cache.ts';
import type { AppEnv } from '../types/env.ts';
import { generateShortCode, isValidShortCode } from '../utils/shortcode.ts';
import { validateUrl } from '../utils/url-validator.ts';
import { getUserClientFromRequest, runInBackground, sendUnauthorized } from './_helpers.ts';

export const urlCrudRoutes = new Hono<AppEnv>();

/** bcrypt cost（與舊版 deno.land/x/bcrypt 預設值相同） */
const BCRYPT_ROUNDS = 10;

/** PUT /api/urls/:id 可由請求直接更新的欄位（password / password_protected 另外處理） */
const UPDATABLE_FIELDS = ['original_url', 'expires_at', 'is_active'] as const;

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

// ============================================================
// 短網址 CRUD
// ============================================================

/**
 * 創建短網址（需要登入）
 */
urlCrudRoutes.post('/api/urls', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
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

  // 取得使用者 ID
  const token = extractToken(c.req.header('Authorization'));
  const supabase = getSupabase(c.env);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token!);

  if (userError || !user) {
    return c.json({ error: 'Invalid token' }, 401);
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

    const { data: insertedData, error } = await userClient
      .from('urls')
      .insert({
        short_code: currentShortCode,
        original_url,
        expires_at,
        created_by: user.id,
      })
      .select()
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
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');

  const { data, error } = await userClient.from('urls').select('*').eq('id', id).single();

  if (error || !data) {
    return c.json({ error: 'URL not found' }, 404);
  }

  return c.json(data);
});

/**
 * 更新短網址（需要登入）
 */
urlCrudRoutes.put('/api/urls/:id', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
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

  const { data, error } = await userClient.from('urls').update(updates).eq('id', id).select().single();

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
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');
  const body = await c.req.json();
  // qr_code_data_url（PNG）仍可傳入但不再寫檔：QR 一律在瀏覽器以 qr-code-styling 即時產生
  const { qr_code_options } = body;

  if (!qr_code_options) {
    return c.json({ error: 'qr_code_options is required' }, 400);
  }

  // 先確認 URL 存在且屬於該使用者（RLS）
  const { data: urlData, error: fetchError } = await userClient
    .from('urls')
    .select('short_code, qr_code_path')
    .eq('id', id)
    .single();

  if (fetchError || !urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  // 準備更新資料（只保存 QR 樣式設定）
  const updates: Record<string, unknown> = {
    qr_code_options: qr_code_options,
    qr_code_generated: true,
  };

  // 更新資料庫
  const { data, error } = await userClient.from('urls').update(updates).eq('id', id).select().single();

  if (error || !data) {
    console.error('Failed to update QR Code config:', error);
    return c.json({ error: 'Failed to update QR Code configuration' }, 500);
  }

  // 回應格式維持相容；不再產生 PNG 檔，qr_code_path 固定為 null
  return c.json({
    success: true,
    qr_code_path: null,
    qr_code_options: qr_code_options,
  });
});

/**
 * 刪除短網址（需要登入）
 */
urlCrudRoutes.delete('/api/urls/:id', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');

  // 先確認 URL 存在且屬於該使用者（RLS）
  const { data: urlData } = await userClient
    .from('urls')
    .select('short_code')
    .eq('id', id)
    .single();

  if (!urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  // 從資料庫刪除
  const { error } = await userClient.from('urls').delete().eq('id', id);

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
