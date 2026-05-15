/**
 * 短網址重定向與廣告頁路由
 *
 * @module routes/url-redirect
 */

import { Hono } from '@hono/hono';

import { getSupabase } from '../services/supabase.ts';
import {
  renderPasswordPage,
  renderExpiredPage,
  renderAdPage,
  renderNotFoundPage,
  renderServerErrorPage,
} from '../utils/html-templates.ts';

export const urlRedirectRoutes = new Hono();

// ============================================================
// 短網址重定向路由
// ============================================================

/**
 * 短網址重定向（Nginx 快取處理，Deno 只處理 MISS/EXPIRED）
 */
urlRedirectRoutes.get('/s/:shortCode', async (c) => {
  const shortCode = c.req.param('shortCode');
  const qr = c.req.query('qr');
  const isQrScan = qr === '1' || qr === 'true';

  try {
    // 查詢資料庫
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('urls')
      .select('*')
      .eq('short_code', shortCode)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return c.html(renderNotFoundPage(shortCode), 404);
    }

    // 檢查過期時間
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return c.html(renderExpiredPage(data.expires_at));
    }

    // 檢查是否需要密碼保護
    if (data.password_protected && data.password_hash) {
      return c.html(renderPasswordPage(shortCode, isQrScan));
    }

    // 記錄點擊（異步，不阻塞回應，但記錄錯誤）
    supabase
      .from('url_clicks')
      .insert({
        url_id: data.id,
        user_agent: c.req.header('user-agent') || null,
        event_type: isQrScan ? 'qr_scan' : 'link_click',
      })
      .then(({ error }) => {
        if (error) {
          console.error(`[ClickRecord] Failed to record click for ${shortCode}:`, error.message);
        } else {
          console.log(
            `[ClickRecord] Recorded click for ${shortCode} (${isQrScan ? 'qr_scan' : 'link_click'})`
          );
        }
      });

    console.log(`Redirect: ${shortCode} -> ${data.original_url}`);
    c.header('Cache-Control', 'no-cache');
    return c.redirect(data.original_url, 302);
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
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('urls')
      .select('id, original_url, is_active, expires_at')
      .eq('short_code', shortCode)
      .single();

    if (error || !data || !data.is_active) {
      return c.html(renderNotFoundPage(shortCode), 404);
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return c.html(renderExpiredPage(data.expires_at));
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
urlRedirectRoutes.post('/api/ad/:shortCode/click', async (c) => {
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
// 內部追蹤 API
// ============================================================

/**
 * 內部點擊追蹤（供 Nginx post_action 使用）
 */
urlRedirectRoutes.get('/api/internal/track/s/:shortCode', async (c) => {
  const shortCode = c.req.param('shortCode');
  const qr = c.req.query('qr');
  const isQrScan = qr === '1' || qr === 'true';

  try {
    // 從資料庫查詢 URL ID
    const supabase = getSupabase();
    const { data } = await supabase
      .from('urls')
      .select('id')
      .eq('short_code', shortCode)
      .eq('is_active', true)
      .single();

    if (!data) {
      return new Response(null, { status: 204 });
    }

    await supabase.from('url_clicks').insert({
      url_id: data.id,
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
