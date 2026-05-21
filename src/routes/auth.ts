/**
 * 使用者認證與 Profile 路由
 *
 * @module routes/auth
 */

import { Hono } from '@hono/hono';

import { getSupabase, extractToken, createUserClient } from '../services/supabase.ts';
import { sendUnauthorized } from './_helpers.ts';

export const authRoutes = new Hono();

/**
 * 取得當前使用者資訊
 */
authRoutes.get('/api/auth/me', async (c) => {
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
authRoutes.put('/api/auth/profile', async (c) => {
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
    const updates: Record<string, unknown> = {};

    if (display_name !== undefined) updates.display_name = display_name;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (metadata !== undefined) updates.metadata = metadata;

    const userClient = createUserClient(token);
    const { data: profile, error: updateError } = await userClient
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
