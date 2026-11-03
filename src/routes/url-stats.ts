/**
 * URL 統計路由（使用 RPC 呼叫資料庫函數）
 *
 * @module routes/url-stats
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ApiKeyPrincipal } from '../services/api-keys.ts';
import { getSupabase, getSupabaseForApiKey, extractToken } from '../services/supabase.ts';
import type { AppEnv } from '../types/env.ts';
import {
  getApiKey,
  getUserClientFromRequest,
  scopeToCaller,
  sendUnauthorized,
} from './_helpers.ts';

export const urlStatsRoutes = new Hono<AppEnv>();

/** 統計 RPC 的呼叫者 */
interface StatsCaller {
  supabase: SupabaseClient;
  userId: string;
  /** 金鑰：`{ p_api_key_id }`，只計算這把金鑰的短網址；使用者：`{}`（RPC 參數與以前相同） */
  keyFilter: { p_api_key_id?: string };
}

/**
 * 取得統計 RPC 的呼叫者。
 * - 金鑰：負責同仁 + 這把金鑰，用 getSupabaseForApiKey，不呼叫 auth.getUser
 * - 使用者：以 JWT 向 Supabase Auth 取得使用者；token 無效回 null
 */
async function getStatsCaller(
  c: Context<AppEnv>,
  key: ApiKeyPrincipal | undefined
): Promise<StatsCaller | null> {
  if (key) {
    return {
      supabase: getSupabaseForApiKey(c.env, key.keyId),
      userId: key.ownerId,
      keyFilter: { p_api_key_id: key.keyId },
    };
  }

  const token = extractToken(c.req.header('Authorization'));
  const supabase = getSupabase(c.env);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token!);

  if (userError || !user) {
    return null;
  }
  return { supabase, userId: user.id, keyFilter: {} };
}

// ============================================================
// 統計路由
// ============================================================

/**
 * 獲取所有短網址列表含統計（需要登入）
 * 使用 RPC: get_urls_with_stats
 */
urlStatsRoutes.get('/api/urls', async (c) => {
  const key = getApiKey(c);
  if (!key && !getUserClientFromRequest(c)) {
    return sendUnauthorized(c);
  }

  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '10');

  try {
    const caller = await getStatsCaller(c, key);
    if (!caller) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const { data, error } = await caller.supabase.rpc('get_urls_with_stats', {
      p_user_id: caller.userId,
      p_page: page,
      p_limit: limit,
      ...caller.keyFilter,
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
  const key = getApiKey(c);
  // 金鑰：service role（繞過 RLS），擁有權一律經 scopeToCaller 確認；使用者：user client（RLS）
  const client = key ? getSupabaseForApiKey(c.env, key.keyId) : getUserClientFromRequest(c);
  if (!client) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');
  const days = parseInt(c.req.query('days') || '30');

  try {
    // 確認 URL 屬於呼叫者（get_url_stats 本身不檢查擁有者）；非 UUID 的 id 也是 404
    const lookup = client.from('urls').select('id').eq('id', id);
    const { data: urlData, error: urlError } = await scopeToCaller(lookup, key).single();

    if (urlError || !urlData) {
      return c.json({ error: 'URL not found' }, 404);
    }

    const supabase = key ? client : getSupabase(c.env);
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
  const key = getApiKey(c);
  if (!key && !getUserClientFromRequest(c)) {
    return sendUnauthorized(c);
  }

  try {
    const caller = await getStatsCaller(c, key);
    if (!caller) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const { data, error } = await caller.supabase.rpc('get_stats_summary', {
      p_user_id: caller.userId,
      ...caller.keyFilter,
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
  const key = getApiKey(c);
  if (!key && !getUserClientFromRequest(c)) {
    return sendUnauthorized(c);
  }

  const days = parseInt(c.req.query('days') || '30');

  try {
    const caller = await getStatsCaller(c, key);
    if (!caller) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const { data, error } = await caller.supabase.rpc('get_daily_stats', {
      p_user_id: caller.userId,
      p_days: days,
      ...caller.keyFilter,
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
