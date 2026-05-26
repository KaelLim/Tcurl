import { Hono } from '@hono/hono';

import { getSupabase, extractToken } from '../services/supabase.ts';
import { sendUnauthorized } from './_helpers.ts';

export const adminRoutes = new Hono();

function getAdminEmails(): string[] {
  return (Deno.env.get('ADMIN_EMAILS') || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function getDisplayName(meta: Record<string, string>): string {
  if (meta.chinese_firstname && meta.chinese_lastname) {
    return `${meta.chinese_lastname}${meta.chinese_firstname}`;
  }
  return meta.display_name || meta.name || '';
}

async function getAdminUser(
  authHeader: string | undefined
): Promise<{ id: string; email: string } | null> {
  const token = extractToken(authHeader);
  if (!token) return null;

  const supabase = getSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user || !user.email) return null;
  if (!getAdminEmails().includes(user.email.toLowerCase())) return null;

  return { id: user.id, email: user.email };
}

adminRoutes.get('/api/admin/check', async (c) => {
  const admin = await getAdminUser(c.req.header('Authorization'));
  return c.json({ is_admin: !!admin });
});

adminRoutes.get('/api/admin/stats', async (c) => {
  const admin = await getAdminUser(c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const supabase = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  const [urlsResult, activeResult, clicksResult, todayResult, usersResult, feedbacksResult] =
    await Promise.all([
      supabase.from('urls').select('*', { count: 'exact', head: true }),
      supabase.from('urls').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('url_clicks').select('*', { count: 'exact', head: true }),
      supabase
        .from('url_clicks')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today),
      supabase.auth.admin.listUsers(),
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
  const admin = await getAdminUser(c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const page = parseInt(c.req.query('page') || '1');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const search = c.req.query('search') || '';
  const offset = (page - 1) * limit;

  const supabase = getSupabase();

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

  const userIds = [...new Set((urls || []).map((u) => u.created_by).filter(Boolean))];
  const userMap: Record<string, { email: string; display_name: string }> = {};
  await Promise.all(
    userIds.map(async (uid) => {
      const { data: userData } = await supabase.auth.admin.getUserById(uid);
      if (userData?.user) {
        const meta = userData.user.user_metadata || {};
        userMap[uid] = {
          email: userData.user.email || '',
          display_name: getDisplayName(meta) || userData.user.email?.split('@')[0] || '未知',
        };
      }
    })
  );

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
  const admin = await getAdminUser(c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const supabase = getSupabase();
  const {
    data: { users },
    error,
  } = await supabase.auth.admin.listUsers();

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
      const meta = user.user_metadata || {};
      return {
        id: user.id,
        email: user.email,
        display_name: getDisplayName(meta) || user.email?.split('@')[0] || '未知',
        url_count: urlCounts[user.id] || 0,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      };
    })
  );
});

adminRoutes.get('/api/admin/feedbacks', async (c) => {
  const admin = await getAdminUser(c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const supabase = getSupabase();
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
          const meta = userData.user.user_metadata || {};
          feedback.author = {
            id: userData.user.id,
            display_name:
              getDisplayName(meta) || userData.user.email?.split('@')[0] || '匿名用戶',
          };
        }
      }
      return feedback;
    })
  );

  return c.json(feedbacksWithAuthors);
});

adminRoutes.put('/api/admin/feedbacks/:id/status', async (c) => {
  const admin = await getAdminUser(c.req.header('Authorization'));
  if (!admin) return sendUnauthorized(c);

  const id = c.req.param('id');
  const { status } = await c.req.json();
  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];

  if (!validStatuses.includes(status)) {
    return c.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400);
  }

  const supabase = getSupabase();
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
