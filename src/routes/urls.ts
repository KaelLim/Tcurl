/**
 * URL 路由 - Deno/Hono 版本
 *
 * 提供短網址的 CRUD 操作、重定向、統計等功能
 *
 * @module routes/urls
 */

import { Hono, type Context } from '@hono/hono';
import * as bcrypt from 'bcrypt';

// 導入服務
import { getSupabase, createUserClient, extractToken } from '../services/supabase.ts';
import { redis, CACHE_KEYS, CACHE_TTL } from '../services/redis.ts';
import { purgeNginxCache } from '../services/nginx-cache.ts';

// 導入工具函數
import { generateShortCode, isValidShortCode } from '../utils/shortcode.ts';
import { validateUrl } from '../utils/url-validator.ts';
import { renderPasswordPage, renderExpiredPage, renderAdPage } from '../utils/html-templates.ts';

// 建立路由實例
export const urlRoutes = new Hono();

// ============================================================
// 輔助函數
// ============================================================

/**
 * 從請求中取得使用者 Supabase Client
 */
function getUserClientFromRequest(c: Context): ReturnType<typeof createUserClient> | null {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) {
    return null;
  }
  return createUserClient(token);
}

/**
 * 回傳未授權錯誤
 */
function sendUnauthorized(c: Context): Response {
  return c.json(
    {
      error: 'Unauthorized',
      message: '請先登入',
    },
    401
  );
}

// ============================================================
// API 路由 - 短網址 CRUD
// ============================================================

/**
 * 創建短網址（需要登入）
 */
urlRoutes.post('/api/urls', async (c) => {
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
  const supabase = getSupabase();
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
  // deno-lint-ignore no-explicit-any
  let data: any = null;

  while (attempts < maxAttempts) {
    const currentShortCode =
      short_code || generateShortCode(Number(Deno.env.get('SHORT_CODE_LENGTH')) || 6);

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

  const baseUrl = Deno.env.get('BASE_URL') || 'http://localhost:3000';
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
 * 獲取所有短網址列表（需要登入）
 */
urlRoutes.get('/api/urls', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '10');
  const offset = (page - 1) * limit;

  // 取得總數
  const { count, error: countError } = await userClient
    .from('urls')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  if (countError) {
    console.error(countError);
    return c.json({ error: 'Failed to count URLs' }, 500);
  }

  // 取得分頁資料
  const { data: urlsData, error: urlsError } = await userClient
    .from('urls')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (urlsError) {
    console.error(urlsError);
    return c.json({ error: 'Failed to fetch URLs' }, 500);
  }

  // 取得點擊統計
  const supabase = getSupabase();
  const urlIds = urlsData?.map((u: { id: string }) => u.id) || [];
  const statsMap = new Map<string, { total: number; link: number; qr: number; last: string | null }>();

  if (urlIds.length > 0) {
    const { data: clicksData } = await supabase
      .from('url_clicks')
      .select('url_id, event_type, clicked_at')
      .in('url_id', urlIds);

    for (const urlId of urlIds) {
      const clicks = clicksData?.filter((c: { url_id: string }) => c.url_id === urlId) || [];
      const linkClicks = clicks.filter(
        (c: { event_type: string }) => c.event_type === 'link_click' || c.event_type === 'ad_click'
      ).length;
      const qrScans = clicks.filter((c: { event_type: string }) => c.event_type === 'qr_scan').length;
      const lastClick =
        clicks.length > 0
          ? clicks.sort(
              (a: { clicked_at: string }, b: { clicked_at: string }) =>
                new Date(b.clicked_at).getTime() - new Date(a.clicked_at).getTime()
            )[0].clicked_at
          : null;

      statsMap.set(urlId, {
        total: clicks.length,
        link: linkClicks,
        qr: qrScans,
        last: lastClick,
      });
    }
  }

  // 合併資料
  // deno-lint-ignore no-explicit-any
  const mergedData = urlsData?.map((url: any) => {
    const stats = statsMap.get(url.id) || { total: 0, link: 0, qr: 0, last: null };
    return {
      id: url.id,
      short_code: url.short_code,
      original_url: url.original_url,
      created_at: url.created_at,
      is_active: url.is_active,
      clicks: stats.total,
      link_clicks: stats.link,
      qr_scans: stats.qr,
      last_clicked_at: stats.last,
      qr_code_generated: url.qr_code_generated || false,
      qr_code_path: url.qr_code_path,
      qr_code_options: url.qr_code_options,
      password_protected: url.password_protected || false,
      expires_at: url.expires_at,
      created_by: url.created_by,
    };
  });

  const totalPages = Math.ceil((count || 0) / limit);

  // 設定防快取 headers
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');

  return c.json({
    data: mergedData,
    pagination: {
      page,
      limit,
      total: count || 0,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
});

/**
 * 獲取單個短網址詳情（需要登入）
 */
urlRoutes.get('/api/urls/:id', async (c) => {
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
urlRoutes.put('/api/urls/:id', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');
  const body = await c.req.json();
  const { password, password_protected, ...otherUpdates } = body;

  // 準備更新資料
  // deno-lint-ignore no-explicit-any
  const updates: any = { ...otherUpdates };

  // 處理密碼保護
  if (password_protected !== undefined) {
    updates.password_protected = password_protected;

    if (password_protected && password) {
      updates.password_hash = await bcrypt.hash(password);
    } else if (!password_protected) {
      updates.password_hash = null;
    }
  } else if (password) {
    updates.password_hash = await bcrypt.hash(password);
    updates.password_protected = true;
  }

  // 如果更新 original_url，需要驗證
  if (updates.original_url) {
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

  // 清除快取
  try {
    const cacheKey = CACHE_KEYS.URL(data.short_code);
    await redis.del(cacheKey);
    await purgeNginxCache(data.short_code);
    console.log(`Cache invalidated for ${data.short_code} after update`);
  } catch (cacheError) {
    console.error('Failed to invalidate cache:', cacheError);
  }

  return c.json(data);
});

/**
 * 更新 QR Code 配置（需要登入）
 */
urlRoutes.patch('/api/urls/:id/qr-code', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');
  const body = await c.req.json();
  const { qr_code_options, qr_code_data_url } = body;

  if (!qr_code_options) {
    return c.json({ error: 'qr_code_options is required' }, 400);
  }

  // 先獲取 URL 資料
  const { data: urlData, error: fetchError } = await userClient
    .from('urls')
    .select('short_code, qr_code_path')
    .eq('id', id)
    .single();

  if (fetchError || !urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  // 準備更新資料
  // deno-lint-ignore no-explicit-any
  const updates: any = {
    qr_code_options: qr_code_options,
    qr_code_generated: true,
  };

  // 如果提供了 PNG data URL，保存為檔案
  if (qr_code_data_url) {
    try {
      // 確保 qrcodes 目錄存在
      const qrcodesDir = `${Deno.cwd()}/public/qrcodes`;
      try {
        await Deno.mkdir(qrcodesDir, { recursive: true });
      } catch {
        // 目錄可能已存在
      }

      // 解析 base64 data URL
      const matches = qr_code_data_url.match(/^data:image\/png;base64,(.+)$/);
      if (!matches) {
        throw new Error('Invalid data URL format');
      }

      const base64Data = matches[1];
      const buffer = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

      // 驗證檔案大小（最大 1MB）
      const maxSize = 1 * 1024 * 1024;
      if (buffer.length > maxSize) {
        return c.json(
          {
            error: 'QR Code 檔案過大',
            message: `檔案大小 ${(buffer.length / 1024).toFixed(1)}KB 超過限制（最大 1MB）`,
          },
          400
        );
      }

      // 驗證 PNG 格式
      const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      if (buffer.length < 8 || !buffer.slice(0, 8).every((v, i) => v === pngSignature[i])) {
        return c.json(
          {
            error: '無效的 PNG 檔案格式',
            message: '上傳的檔案不是有效的 PNG 圖片',
          },
          400
        );
      }

      // 保存檔案
      const fileName = `${urlData.short_code}.png`;
      const filePath = `${qrcodesDir}/${fileName}`;
      await Deno.writeFile(filePath, buffer);

      updates.qr_code_path = `/qrcodes/${fileName}`;
      console.log(`QR Code PNG saved: ${filePath}`);
    } catch (saveError) {
      console.error('Failed to save QR Code PNG:', saveError);
      return c.json({ error: 'Failed to save QR Code image' }, 500);
    }
  }

  // 更新資料庫
  const { data, error } = await userClient.from('urls').update(updates).eq('id', id).select().single();

  if (error || !data) {
    console.error('Failed to update QR Code config:', error);
    return c.json(
      {
        error: 'Failed to update QR Code configuration',
        details: error?.message || 'Unknown error',
      },
      500
    );
  }

  // 清除快取
  try {
    const cacheKey = CACHE_KEYS.URL(urlData.short_code);
    await redis.del(cacheKey);
    await purgeNginxCache(urlData.short_code);
  } catch (cacheError) {
    console.error('Failed to invalidate cache:', cacheError);
  }

  return c.json({
    success: true,
    qr_code_path: updates.qr_code_path,
    qr_code_options: qr_code_options,
  });
});

/**
 * 刪除短網址（需要登入）
 */
urlRoutes.delete('/api/urls/:id', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');

  // 先取得資料以便清除快取
  const { data: urlData } = await userClient
    .from('urls')
    .select('short_code, qr_code_path')
    .eq('id', id)
    .single();

  if (!urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  // 刪除 QR Code 檔案
  if (urlData.qr_code_path) {
    try {
      const filePath = `${Deno.cwd()}/public${urlData.qr_code_path}`;
      await Deno.remove(filePath);
      console.log(`QR code file deleted: ${filePath}`);
    } catch (fileError) {
      console.error('Failed to delete QR code file:', fileError);
    }
  }

  // 從資料庫刪除
  const { error } = await userClient.from('urls').delete().eq('id', id);

  if (error) {
    console.error(error);
    return c.json({ error: 'Failed to delete URL' }, 500);
  }

  // 清除快取
  try {
    const cacheKey = CACHE_KEYS.URL(urlData.short_code);
    await redis.del(cacheKey);
    await purgeNginxCache(urlData.short_code);
  } catch (cacheError) {
    console.error('Failed to invalidate cache:', cacheError);
  }

  return c.json({ message: 'URL deleted successfully' });
});

// ============================================================
// 密碼驗證路由
// ============================================================

/**
 * 驗證密碼保護的短網址
 */
urlRoutes.post('/api/urls/:shortCode/verify-password', async (c) => {
  const shortCode = c.req.param('shortCode');
  const body = await c.req.json();
  const { password } = body;

  if (!password) {
    return c.json({ error: 'Password is required' }, 400);
  }

  const supabase = getSupabase();
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

  // 記錄點擊（異步，不等待）
  void supabase
    .from('url_clicks')
    .insert({
      url_id: data.id,
      user_agent: c.req.header('user-agent') || null,
      event_type: 'link_click',
    });

  return c.json({
    original_url: data.original_url,
    short_code: data.short_code,
  });
});

// ============================================================
// 短網址重定向路由
// ============================================================

/**
 * 短網址重定向（使用 Redis 快取）
 */
urlRoutes.get('/s/:shortCode', async (c) => {
  const shortCode = c.req.param('shortCode');
  const qr = c.req.query('qr');
  const isQrScan = qr === '1' || qr === 'true';

  try {
    // 1. 先查 Redis 快取
    const cacheKey = CACHE_KEYS.URL(shortCode);
    const cached = await redis.get(cacheKey);

    if (cached) {
      const cachedData = JSON.parse(cached);

      // 檢查過期時間
      if (cachedData.expires_at && new Date(cachedData.expires_at) < new Date()) {
        await redis.del(cacheKey);
        return c.html(renderExpiredPage(cachedData.expires_at));
      }

      // 檢查是否需要密碼保護
      if (cachedData.password_protected && cachedData.password_hash) {
        return c.html(renderPasswordPage(shortCode, isQrScan));
      }

      // 異步記錄點擊（不等待）
      const supabase = getSupabase();
      void supabase
        .from('url_clicks')
        .insert({
          url_id: cachedData.id,
          user_agent: c.req.header('user-agent') || null,
          event_type: isQrScan ? 'qr_scan' : 'link_click',
        });

      console.log(`Cache hit for ${shortCode}`);
      return c.redirect(cachedData.original_url, 302);
    }

    // 2. 快取未命中，查詢資料庫
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('urls')
      .select('*')
      .eq('short_code', shortCode)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return c.json({ error: 'Short URL not found' }, 404);
    }

    // 檢查過期時間
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return c.html(renderExpiredPage(data.expires_at));
    }

    // 檢查是否需要密碼保護
    if (data.password_protected && data.password_hash) {
      return c.html(renderPasswordPage(shortCode, isQrScan));
    }

    // 3. 存入 Redis 快取
    await redis.setex(
      cacheKey,
      CACHE_TTL.URL,
      JSON.stringify({
        id: data.id,
        original_url: data.original_url,
        short_code: data.short_code,
        password_protected: data.password_protected,
        password_hash: data.password_hash,
        expires_at: data.expires_at,
      })
    );

    // 4. 記錄點擊
    // Fire-and-forget click recording (async, non-blocking)
    void supabase
      .from('url_clicks')
      .insert({
        url_id: data.id,
        user_agent: c.req.header('user-agent') || null,
        event_type: isQrScan ? 'qr_scan' : 'link_click',
      });

    console.log(`Cache miss for ${shortCode}, cached now`);
    return c.redirect(data.original_url, 302);
  } catch (redisError) {
    // Redis 錯誤，降級為直接查資料庫
    console.error('Redis error, falling back to database:', redisError);

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('urls')
      .select('*')
      .eq('short_code', shortCode)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return c.json({ error: 'Short URL not found' }, 404);
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return c.html(renderExpiredPage(data.expires_at));
    }

    if (data.password_protected && data.password_hash) {
      return c.html(renderPasswordPage(shortCode, isQrScan));
    }

    // Fire-and-forget click recording (async, non-blocking)
    void supabase
      .from('url_clicks')
      .insert({
        url_id: data.id,
        user_agent: c.req.header('user-agent') || null,
        event_type: isQrScan ? 'qr_scan' : 'link_click',
      });

    return c.redirect(data.original_url, 302);
  }
});

// ============================================================
// 廣告頁路由
// ============================================================

/**
 * 廣告頁面
 */
urlRoutes.get('/ad/:shortCode', async (c) => {
  const shortCode = c.req.param('shortCode');

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('urls')
      .select('id, original_url, is_active, expires_at')
      .eq('short_code', shortCode)
      .single();

    if (error || !data) {
      return c.html(
        `<html><body><h1>短網址不存在</h1><p>此短網址可能已被刪除或從未建立</p><a href="/">返回首頁</a></body></html>`,
        404
      );
    }

    if (!data.is_active) {
      return c.html(
        `<html><body><h1>短網址已停用</h1><p>此短網址已被停用</p><a href="/">返回首頁</a></body></html>`,
        410
      );
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return c.html(renderExpiredPage(data.expires_at));
    }

    return c.html(renderAdPage(shortCode, data.original_url));
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * 記錄廣告曝光
 */
urlRoutes.post('/api/ad/:shortCode/view', async (c) => {
  const shortCode = c.req.param('shortCode');

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('urls').select('id').eq('short_code', shortCode).single();

    if (error || !data) {
      return c.json({ error: 'URL not found' }, 404);
    }

    await supabase.from('url_clicks').insert({
      url_id: data.id,
      user_agent: c.req.header('user-agent') || null,
      event_type: 'ad_view',
    });

    return c.json({ success: true });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Failed to record view' }, 500);
  }
});

/**
 * 記錄廣告點擊
 */
urlRoutes.post('/api/ad/:shortCode/click', async (c) => {
  const shortCode = c.req.param('shortCode');

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('urls')
      .select('id, original_url')
      .eq('short_code', shortCode)
      .single();

    if (error || !data) {
      return c.json({ error: 'URL not found' }, 404);
    }

    await supabase.from('url_clicks').insert({
      url_id: data.id,
      user_agent: c.req.header('user-agent') || null,
      event_type: 'ad_click',
    });

    return c.json({
      success: true,
      original_url: data.original_url,
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: 'Failed to record click' }, 500);
  }
});

// ============================================================
// 統計路由
// ============================================================

/**
 * 獲取 URL 統計資料（需要登入）
 */
urlRoutes.get('/api/urls/:id/stats', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');
  const days = parseInt(c.req.query('days') || '30');

  try {
    // 確認 URL 屬於該使用者
    const { data: urlData, error: urlError } = await userClient.from('urls').select('id').eq('id', id).single();

    if (urlError || !urlData) {
      return c.json({ error: 'URL not found' }, 404);
    }

    const supabase = getSupabase();
    const { data: clicksData, error: clicksError } = await supabase
      .from('url_clicks')
      .select('event_type, clicked_at')
      .eq('url_id', id);

    if (clicksError) {
      console.error(clicksError);
      return c.json({ error: 'Failed to fetch stats' }, 500);
    }

    const clicks = clicksData || [];
    const linkClicks = clicks.filter(
      (c: { event_type: string }) => c.event_type === 'link_click' || c.event_type === 'ad_click'
    ).length;
    const qrScans = clicks.filter((c: { event_type: string }) => c.event_type === 'qr_scan').length;
    const adViews = clicks.filter((c: { event_type: string }) => c.event_type === 'ad_view').length;
    const adClicks = clicks.filter((c: { event_type: string }) => c.event_type === 'ad_click').length;
    const lastClickedAt =
      clicks.length > 0
        ? clicks.sort(
            (a: { clicked_at: string }, b: { clicked_at: string }) =>
              new Date(b.clicked_at).getTime() - new Date(a.clicked_at).getTime()
          )[0].clicked_at
        : null;

    // 計算每日統計
    const dailyMap = new Map<string, { total: number; link: number; qr: number; ad_view: number; ad_click: number }>();
    for (const click of clicks) {
      const date = new Date(click.clicked_at).toISOString().split('T')[0];
      const existing = dailyMap.get(date) || { total: 0, link: 0, qr: 0, ad_view: 0, ad_click: 0 };
      existing.total++;
      if (click.event_type === 'link_click') existing.link++;
      if (click.event_type === 'qr_scan') existing.qr++;
      if (click.event_type === 'ad_view') existing.ad_view++;
      if (click.event_type === 'ad_click') existing.ad_click++;
      dailyMap.set(date, existing);
    }

    const dailyStats = Array.from(dailyMap.entries())
      .map(([date, stats]) => ({
        date,
        total_clicks: stats.total,
        link_clicks: stats.link,
        qr_scans: stats.qr,
        ad_views: stats.ad_view,
        ad_clicks: stats.ad_click,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, days);

    return c.json({
      total: {
        total_clicks: clicks.length,
        link_clicks: linkClicks,
        qr_scans: qrScans,
        ad_views: adViews,
        ad_clicks: adClicks,
        last_clicked_at: lastClickedAt,
      },
      daily: dailyStats,
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

/**
 * 取得統計摘要（需要登入）
 */
urlRoutes.get('/api/urls/stats/summary', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  try {
    const { data: urlsData, error } = await userClient.from('urls').select('id, is_active');

    if (error) {
      console.error('Failed to fetch stats summary:', error);
      return c.json({ error: 'Failed to fetch statistics' }, 500);
    }

    const totalLinks = urlsData?.length || 0;
    const activeLinks = urlsData?.filter((u: { is_active: boolean }) => u.is_active).length || 0;

    const urlIds = urlsData?.map((u: { id: string }) => u.id) || [];
    let totalClicks = 0;

    if (urlIds.length > 0) {
      const supabase = getSupabase();
      const { count } = await supabase
        .from('url_clicks')
        .select('*', { count: 'exact', head: true })
        .in('url_id', urlIds);

      totalClicks = count || 0;
    }

    return c.json({
      totalLinks,
      activeLinks,
      totalClicks,
    });
  } catch (error) {
    console.error('Error calculating stats summary:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * 取得每日統計
 */
urlRoutes.get('/api/stats/daily', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const days = parseInt(c.req.query('days') || '30');

  try {
    const { data: urlsData, error: urlsError } = await userClient.from('urls').select('id');

    if (urlsError) {
      console.error(urlsError);
      return c.json({ error: 'Failed to fetch URLs' }, 500);
    }

    const urlIds = urlsData?.map((u: { id: string }) => u.id) || [];

    if (urlIds.length === 0) {
      return c.json([]);
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const supabase = getSupabase();
    const { data: clicksData, error: clicksError } = await supabase
      .from('url_clicks')
      .select('event_type, clicked_at')
      .in('url_id', urlIds)
      .gte('clicked_at', startDate.toISOString())
      .lte('clicked_at', endDate.toISOString());

    if (clicksError) {
      console.error(clicksError);
      return c.json({ error: 'Failed to fetch clicks' }, 500);
    }

    const dailyMap = new Map<string, { link_clicks: number; qr_scans: number; ad_views: number; ad_clicks: number }>();

    // 初始化所有日期
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      dailyMap.set(dateStr, { link_clicks: 0, qr_scans: 0, ad_views: 0, ad_clicks: 0 });
    }

    // 計算每日統計
    for (const click of clicksData || []) {
      const dateStr = new Date(click.clicked_at).toISOString().split('T')[0];
      const existing = dailyMap.get(dateStr) || { link_clicks: 0, qr_scans: 0, ad_views: 0, ad_clicks: 0 };
      if (click.event_type === 'qr_scan') {
        existing.qr_scans++;
      } else if (click.event_type === 'ad_view') {
        existing.ad_views++;
      } else if (click.event_type === 'ad_click') {
        existing.ad_clicks++;
      } else {
        existing.link_clicks++;
      }
      dailyMap.set(dateStr, existing);
    }

    const dailyStats = Array.from(dailyMap.entries())
      .map(([date, stats]) => ({
        date,
        link_clicks: stats.link_clicks,
        qr_scans: stats.qr_scans,
        ad_views: stats.ad_views,
        ad_clicks: stats.ad_clicks,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return c.json(dailyStats);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to fetch daily stats' }, 500);
  }
});

// ============================================================
// 使用者相關 API
// ============================================================

/**
 * 登入
 */
urlRoutes.post('/api/auth/login', async (c) => {
  const body = await c.req.json();
  const { email, password } = body;

  if (!email || !password) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'email 和 password 為必填',
      },
      400
    );
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return c.json(
        {
          error: 'Unauthorized',
          message: error.message,
        },
        401
      );
    }

    return c.json({
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      expires_in: data.session?.expires_in,
      token_type: 'Bearer',
      user: {
        id: data.user?.id,
        email: data.user?.email,
      },
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Login failed' }, 500);
  }
});

/**
 * 註冊
 */
urlRoutes.post('/api/auth/register', async (c) => {
  const body = await c.req.json();
  const { email, password, display_name } = body;

  if (!email || !password) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'email 和 password 為必填',
      },
      400
    );
  }

  if (password.length < 6) {
    return c.json(
      {
        error: 'Bad Request',
        message: '密碼至少需要 6 個字元',
      },
      400
    );
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: display_name || email.split('@')[0],
      },
    });

    if (error) {
      if (error.message.includes('already been registered')) {
        return c.json(
          {
            error: 'Conflict',
            message: '此電子郵件已被註冊',
          },
          409
        );
      }
      return c.json(
        {
          error: 'Bad Request',
          message: error.message,
        },
        400
      );
    }

    return c.json(
      {
        message: '註冊成功',
        user: {
          id: data.user?.id,
          email: data.user?.email,
          display_name: data.user?.user_metadata?.display_name,
        },
      },
      201
    );
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Registration failed' }, 500);
  }
});

/**
 * 取得當前使用者資訊
 */
urlRoutes.get('/api/auth/me', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) {
    return sendUnauthorized(c);
  }

  try {
    const supabase = getSupabase();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Token 無效或已過期',
        },
        401
      );
    }

    const { data: profile } = await supabase.from('user_profiles').select('*').eq('id', user.id).single();

    return c.json({
      id: user.id,
      email: user.email,
      display_name: profile?.display_name || user.email,
      avatar_url: profile?.avatar_url,
      metadata: profile?.metadata || {},
      created_at: user.created_at,
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to get user info' }, 500);
  }
});

/**
 * 更新使用者 profile
 */
urlRoutes.put('/api/auth/profile', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) {
    return sendUnauthorized(c);
  }

  try {
    const supabase = getSupabase();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Token 無效或已過期',
        },
        401
      );
    }

    const body = await c.req.json();
    const { display_name, avatar_url, metadata } = body;
    // deno-lint-ignore no-explicit-any
    const updates: any = {};

    if (display_name !== undefined) updates.display_name = display_name;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (metadata !== undefined) updates.metadata = metadata;

    const { data: profile, error: updateError } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error(updateError);
      return c.json({ error: 'Failed to update profile' }, 500);
    }

    return c.json({
      id: user.id,
      email: user.email,
      display_name: profile?.display_name,
      avatar_url: profile?.avatar_url,
      metadata: profile?.metadata || {},
      updated_at: profile?.updated_at,
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

// ============================================================
// 內部追蹤 API
// ============================================================

/**
 * 內部點擊追蹤（供 Nginx post_action 使用）
 */
urlRoutes.get('/api/internal/track/s/:shortCode', async (c) => {
  const shortCode = c.req.param('shortCode');
  const qr = c.req.query('qr');
  const isQrScan = qr === '1' || qr === 'true';

  try {
    const cacheKey = CACHE_KEYS.URL(shortCode);
    let urlId: string | null = null;

    // 從 Redis 取得
    const cached = await redis.get(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      urlId = cachedData.id;
    } else {
      // 從資料庫查詢
      const supabase = getSupabase();
      const { data } = await supabase
        .from('urls')
        .select('id')
        .eq('short_code', shortCode)
        .eq('is_active', true)
        .single();

      if (data) {
        urlId = data.id;
      }
    }

    if (!urlId) {
      return new Response(null, { status: 204 });
    }

    const supabase = getSupabase();
    await supabase.from('url_clicks').insert({
      url_id: urlId,
      user_agent: c.req.header('user-agent') || null,
      ip_address: c.req.header('x-real-ip') || 'unknown',
      event_type: isQrScan ? 'qr_scan' : 'link_click',
    });

    console.log(`Click tracked via Nginx post_action: ${shortCode}, isQrScan: ${isQrScan}`);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('Failed to track click via post_action:', error);
    return new Response(null, { status: 204 });
  }
});

// ============================================================
// 美化路由 - 直接提供 HTML（不重導向）
// ============================================================

urlRoutes.get('/links', async (c) => {
  const content = await Deno.readTextFile('./public/links.html');
  return c.html(content);
});

urlRoutes.get('/edit/:id', async (c) => {
  // 直接提供 edit.html，JavaScript 會從 URL 路徑讀取 ID
  const content = await Deno.readTextFile('./public/edit.html');
  return c.html(content);
});

urlRoutes.get('/analytics', async (c) => {
  const content = await Deno.readTextFile('./public/analytics.html');
  return c.html(content);
});

urlRoutes.get('/analytics/:id', async (c) => {
  // 支援 /analytics/uuid 格式
  const content = await Deno.readTextFile('./public/analytics.html');
  return c.html(content);
});

urlRoutes.get('/docs', async (c) => {
  const content = await Deno.readTextFile('./public/docs.html');
  return c.html(content);
});
