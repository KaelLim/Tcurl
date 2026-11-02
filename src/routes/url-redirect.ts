/**
 * 短網址重定向與廣告頁路由
 *
 * @module routes/url-redirect
 */

import { Hono } from 'hono';

import { getSupabase } from '../services/supabase.ts';
import type { AppEnv } from '../types/env.ts';
import { runInBackground } from './_helpers.ts';
import {
  getCachedChannel,
  getCachedUrl,
  putCachedChannel,
  putCachedUrl,
  toCachedChannel,
  toCachedUrl,
  type CachedChannel,
} from '../services/redirect-cache.ts';
import {
  renderPasswordPage,
  renderExpiredPage,
  renderAdPage,
  renderNotFoundPage,
  renderServerErrorPage,
} from '../utils/html-templates.ts';

export const urlRedirectRoutes = new Hono<AppEnv>();

/** 廣告路由需要的欄位（password_hash 只用於判斷，不回傳） */
const AD_URL_COLUMNS = 'id, original_url, is_active, expires_at, password_protected, password_hash';

interface AdUrlRow {
  id: string;
  original_url: string;
  is_active: boolean | null;
  expires_at: string | null;
  password_protected: boolean | null;
  password_hash: string | null;
}

function isExpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt) < new Date();
}

/** 與 /s/:code 相同的密碼保護判斷 */
function requiresPassword(row: AdUrlRow): boolean {
  return !!(row.password_protected && row.password_hash);
}

/**
 * 廣告 API 的存取檢查（比照 /s/:code）：不存在或停用 404、過期 410、有密碼保護 403。
 * 可存取時回傳 null。
 */
function getAdApiDenial(
  row: AdUrlRow | null
): { status: 403 | 404 | 410; error: string } | null {
  if (!row || !row.is_active) return { status: 404, error: 'URL not found' };
  if (isExpired(row.expires_at)) return { status: 410, error: 'Short URL has expired' };
  if (requiresPassword(row)) return { status: 403, error: 'This URL is password protected' };
  return null;
}

// ============================================================
// 短網址重定向路由
// ============================================================

/**
 * 短網址重定向（每次轉址都在 Worker 內記錄點擊）
 *
 * 網址與管道先查 REDIRECT_CACHE（KV，最多 60 秒），未命中才查 Supabase 並在背景寫回快取。
 * 到期時間與密碼保護在命中快取時照樣判斷。
 */
urlRedirectRoutes.get('/s/:shortCode', async (c) => {
  const shortCode = c.req.param('shortCode');
  const qr = c.req.query('qr');
  const isQrScan = qr === '1' || qr === 'true';
  const cache = c.env.REDIRECT_CACHE;

  try {
    const supabase = getSupabase(c.env);

    let data = await getCachedUrl(cache, shortCode);
    if (!data) {
      const { data: row, error } = await supabase
        .from('urls')
        .select('*')
        .eq('short_code', shortCode)
        .eq('is_active', true)
        .single();

      // 找不到（或已停用）不快取
      if (error || !row) {
        return c.html(renderNotFoundPage(shortCode), 404);
      }
      data = toCachedUrl(row);
      runInBackground(c, putCachedUrl(cache, shortCode, data));
    }

    // 檢查過期時間
    if (isExpired(data.expires_at)) {
      return c.html(renderExpiredPage(data.expires_at!));
    }

    // 檢查是否需要密碼保護
    if (data.requires_password) {
      return c.html(renderPasswordPage(shortCode, isQrScan));
    }

    // 查詢管道（如果有 g 參數）；查不到就是 null，當作一般點擊
    const groupKey = c.req.query('g');
    let channel: CachedChannel | null = null;
    if (groupKey) {
      channel = await getCachedChannel(cache, data.id, groupKey);
      if (!channel) {
        const { data: ch } = await supabase
          .from('url_channels')
          .select('*')
          .eq('url_id', data.id)
          .eq('group_key', groupKey)
          .single();
        if (ch) {
          channel = toCachedChannel(ch);
          runInBackground(c, putCachedChannel(cache, data.id, groupKey, channel));
        }
      }
    }

    // 記錄點擊（背景執行：交給 executionCtx.waitUntil，不阻塞 302 回應，但記錄錯誤）
    const clickTask = supabase
      .from('url_clicks')
      .insert({
        url_id: data.id,
        user_agent: c.req.header('user-agent') || null,
        event_type: isQrScan ? 'qr_scan' : 'link_click',
        channel_id: channel?.id || null,
      })
      .then(({ error }) => {
        if (error) {
          console.error(`[ClickRecord] Failed to record click for ${shortCode}:`, error.message);
        } else {
          const chInfo = channel ? ` [channel: ${channel.name}]` : '';
          console.log(
            `[ClickRecord] Recorded click for ${shortCode} (${isQrScan ? 'qr_scan' : 'link_click'})${chInfo}`
          );
        }
      });
    runInBackground(c, clickTask);

    // 組合目標 URL（附加 UTM 參數）
    let targetUrl = data.original_url;
    if (channel) {
      try {
        const url = new URL(targetUrl);
        if (channel.utm_source) url.searchParams.set('utm_source', channel.utm_source);
        if (channel.utm_medium) url.searchParams.set('utm_medium', channel.utm_medium);
        if (channel.utm_campaign) url.searchParams.set('utm_campaign', channel.utm_campaign);
        if (channel.utm_content) url.searchParams.set('utm_content', channel.utm_content);
        if (channel.utm_term) url.searchParams.set('utm_term', channel.utm_term);
        targetUrl = url.toString();
      } catch {
        // URL 解析失敗，使用原始 URL
      }
    }

    console.log(`Redirect: ${shortCode} -> ${targetUrl}`);
    c.header('Cache-Control', 'no-cache');
    return c.redirect(targetUrl, 302);
  } catch (err) {
    console.error('Redirect error:', err);
    return c.html(renderServerErrorPage(), 500);
  }
});

// ============================================================
// 廣告頁路由
// ============================================================

/**
 * 廣告頁面
 */
urlRedirectRoutes.get('/ad/:shortCode', async (c) => {
  const shortCode = c.req.param('shortCode');

  try {
    const supabase = getSupabase(c.env);
    const { data, error } = await supabase
      .from('urls')
      .select(AD_URL_COLUMNS)
      .eq('short_code', shortCode)
      .single<AdUrlRow>();

    if (error || !data || !data.is_active) {
      return c.html(renderNotFoundPage(shortCode), 404);
    }

    if (isExpired(data.expires_at)) {
      return c.html(renderExpiredPage(data.expires_at!));
    }

    // 比照 /s/：有密碼保護時只顯示密碼頁，不嵌入目的網址（驗證成功後由 verify-password 導向）
    if (requiresPassword(data)) {
      return c.html(renderPasswordPage(shortCode));
    }

    return c.html(renderAdPage(shortCode, data.original_url));
  } catch (err) {
    console.error(err);
    return c.html(renderServerErrorPage(), 500);
  }
});

/**
 * 記錄廣告曝光
 */
urlRedirectRoutes.post('/api/ad/:shortCode/view', async (c) => {
  const shortCode = c.req.param('shortCode');

  try {
    const supabase = getSupabase(c.env);
    const { data, error } = await supabase
      .from('urls')
      .select(AD_URL_COLUMNS)
      .eq('short_code', shortCode)
      .single<AdUrlRow>();

    const denial = getAdApiDenial(error ? null : data);
    if (denial || !data) {
      return c.json({ error: denial?.error || 'URL not found' }, denial?.status || 404);
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
urlRedirectRoutes.post('/api/ad/:shortCode/click', async (c) => {
  const shortCode = c.req.param('shortCode');

  try {
    const supabase = getSupabase(c.env);
    const { data, error } = await supabase
      .from('urls')
      .select(AD_URL_COLUMNS)
      .eq('short_code', shortCode)
      .single<AdUrlRow>();

    // 停用、過期、有密碼保護時不記錄、也不回傳目的網址
    const denial = getAdApiDenial(error ? null : data);
    if (denial || !data) {
      return c.json({ error: denial?.error || 'URL not found' }, denial?.status || 404);
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

