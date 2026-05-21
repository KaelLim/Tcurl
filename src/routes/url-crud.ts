/**
 * URL CRUD 路由
 *
 * 提供短網址的建立、讀取、更新、刪除操作
 *
 * @module routes/url-crud
 */

import { Hono } from '@hono/hono';
import * as bcrypt from 'bcrypt';

import { getSupabase, extractToken } from '../services/supabase.ts';
import { purgeNginxCache } from '../services/nginx-cache.ts';
import { generateShortCode, isValidShortCode } from '../utils/shortcode.ts';
import { validateUrl } from '../utils/url-validator.ts';
import { getUserClientFromRequest, sendUnauthorized } from './_helpers.ts';

export const urlCrudRoutes = new Hono();

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
  let data: Record<string, unknown> | null = null;

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
  const { password, password_protected, ...otherUpdates } = body;

  const updates: Record<string, string | boolean | null | undefined> = { ...otherUpdates };

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
  if (updates.original_url && typeof updates.original_url === 'string') {
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

  // 清除 Nginx 快取
  try {
    await purgeNginxCache(data.short_code);
    console.log(`Nginx cache invalidated for ${data.short_code} after update`);
  } catch (cacheError) {
    console.error('Failed to invalidate Nginx cache:', cacheError);
  }

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
  const updates: Record<string, unknown> = {
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

  // 清除 Nginx 快取
  try {
    await purgeNginxCache(urlData.short_code);
  } catch (cacheError) {
    console.error('Failed to invalidate Nginx cache:', cacheError);
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
urlCrudRoutes.delete('/api/urls/:id', async (c) => {
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

  // 清除 Nginx 快取
  try {
    await purgeNginxCache(urlData.short_code);
  } catch (cacheError) {
    console.error('Failed to invalidate Nginx cache:', cacheError);
  }

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
