import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';

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
