/**
 * URL 統計路由（使用 RPC 呼叫資料庫函數）
 *
 * @module routes/url-stats
 */

import { Hono } from '@hono/hono';

import { getSupabase, extractToken } from '../services/supabase.ts';
import { getUserClientFromRequest, sendUnauthorized } from './_helpers.ts';

export const urlStatsRoutes = new Hono();

// ============================================================
// 統計路由
// ============================================================

/**
 * 獲取所有短網址列表含統計（需要登入）
 * 使用 RPC: get_urls_with_stats
 */
urlStatsRoutes.get('/api/urls', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '10');

  try {
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

    const { data, error } = await supabase.rpc('get_urls_with_stats', {
      p_user_id: user.id,
      p_page: page,
      p_limit: limit,
    });

    if (error) {
      console.error('RPC get_urls_with_stats error:', error);
      return c.json({ error: 'Failed to fetch URLs' }, 500);
    }

    // 設定防快取 headers
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');

    return c.json(data);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to fetch URLs' }, 500);
  }
});

/**
 * 獲取 URL 統計資料（需要登入）
 * 使用 RPC: get_url_stats
 */
urlStatsRoutes.get('/api/urls/:id/stats', async (c) => {
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
    const { data, error } = await supabase.rpc('get_url_stats', {
      p_url_id: id,
      p_days: days,
    });

    if (error) {
      console.error('RPC get_url_stats error:', error);
      return c.json({ error: 'Failed to fetch stats' }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

/**
 * 取得統計摘要（需要登入）
 * 使用 RPC: get_stats_summary
 */
urlStatsRoutes.get('/api/urls/stats/summary', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  try {
    const token = extractToken(c.req.header('Authorization'));
    const supabase = getSupabase();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token!);

    if (userError || !user) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const { data, error } = await supabase.rpc('get_stats_summary', {
      p_user_id: user.id,
    });

    if (error) {
      console.error('RPC get_stats_summary error:', error);
      return c.json({ error: 'Failed to fetch statistics' }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error calculating stats summary:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * 取得每日統計
 * 使用 RPC: get_daily_stats
 */
urlStatsRoutes.get('/api/stats/daily', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const days = parseInt(c.req.query('days') || '30');

  try {
    const token = extractToken(c.req.header('Authorization'));
    const supabase = getSupabase();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token!);

    if (userError || !user) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const { data, error } = await supabase.rpc('get_daily_stats', {
      p_user_id: user.id,
      p_days: days,
    });

    if (error) {
      console.error('RPC get_daily_stats error:', error);
      return c.json({ error: 'Failed to fetch daily stats' }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Failed to fetch daily stats' }, 500);
  }
});
