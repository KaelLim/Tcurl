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

    // 查詢管道（如果有 g 參數）
    const groupKey = c.req.query('g');
    let channel: { id: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string; name?: string } | null = null;
    if (groupKey) {
      const { data: ch } = await supabase
        .from('url_channels')
        .select('*')
        .eq('url_id', data.id)
        .eq('group_key', groupKey)
        .single();
      channel = ch; // 查不到就是 null，當作一般點擊
    }

    // 記錄點擊（異步，不阻塞回應，但記錄錯誤）
    supabase
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

