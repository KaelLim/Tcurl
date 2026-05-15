/**
 * URL 管道追蹤路由
 *
 * 提供管道（channel）的 CRUD 操作，用於 UTM 追蹤與多組 QR Code
 *
 * @module routes/url-channels
 */

import { Hono } from '@hono/hono';

import { getSupabase, extractToken } from '../services/supabase.ts';
import { getUserClientFromRequest, sendUnauthorized } from './_helpers.ts';

export const urlChannelRoutes = new Hono();

const MAX_CHANNELS = 5;
const GROUP_KEY_LENGTH = 6;

/**
 * 產生隨機 group_key（6 位英數字）
 */
function generateGroupKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(GROUP_KEY_LENGTH);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < GROUP_KEY_LENGTH; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * 列出管道
 */
urlChannelRoutes.get('/api/urls/:id/channels', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const urlId = c.req.param('id');

  // 確認 URL 屬於該使用者
  const { data: urlData, error: urlError } = await userClient
    .from('urls')
    .select('id')
    .eq('id', urlId)
    .single();

  if (urlError || !urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('url_channels')
    .select('*')
    .eq('url_id', urlId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch channels:', error);
    return c.json({ error: 'Failed to fetch channels' }, 500);
  }

  return c.json(data || []);
});

/**
 * 新增管道
 */
urlChannelRoutes.post('/api/urls/:id/channels', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const urlId = c.req.param('id');

  // 確認 URL 屬於該使用者
  const { data: urlData, error: urlError } = await userClient
    .from('urls')
    .select('id')
    .eq('id', urlId)
    .single();

  if (urlError || !urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  const supabase = getSupabase();

  // 檢查管道數量上限
  const { count } = await supabase
    .from('url_channels')
    .select('*', { count: 'exact', head: true })
    .eq('url_id', urlId);

  if ((count || 0) >= MAX_CHANNELS) {
    return c.json({ error: `每個短網址最多 ${MAX_CHANNELS} 個管道` }, 409);
  }

  const body = await c.req.json();
  const { name, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = body;

  if (!name || !name.trim()) {
    return c.json({ error: '管道名稱為必填' }, 400);
  }

  // 產生 group_key（重試機制處理碰撞）
  let attempts = 0;
  while (attempts < 5) {
    const groupKey = generateGroupKey();

    const { data, error } = await supabase
      .from('url_channels')
      .insert({
        url_id: urlId,
        group_key: groupKey,
        name: name.trim(),
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        utm_content: utm_content || null,
        utm_term: utm_term || null,
      })
      .select()
      .single();

    if (!error) {
      return c.json(data, 201);
    }

    // UNIQUE 違反 → 重試
    if (error.code === '23505') {
      attempts++;
      continue;
    }

    console.error('Failed to create channel:', error);
    return c.json({ error: 'Failed to create channel' }, 500);
  }

  return c.json({ error: 'Failed to generate unique group key' }, 500);
});

/**
 * 修改管道
 */
urlChannelRoutes.put('/api/urls/:id/channels/:channelId', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const urlId = c.req.param('id');
  const channelId = c.req.param('channelId');

  // 確認 URL 屬於該使用者
  const { data: urlData, error: urlError } = await userClient
    .from('urls')
    .select('id')
    .eq('id', urlId)
    .single();

  if (urlError || !urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  const body = await c.req.json();
  const { name, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = body;

  if (name !== undefined && (!name || !name.trim())) {
    return c.json({ error: '管道名稱不可為空' }, 400);
  }

  // deno-lint-ignore no-explicit-any
  const updates: any = {};
  if (name !== undefined) updates.name = name.trim();
  if (utm_source !== undefined) updates.utm_source = utm_source || null;
  if (utm_medium !== undefined) updates.utm_medium = utm_medium || null;
  if (utm_campaign !== undefined) updates.utm_campaign = utm_campaign || null;
  if (utm_content !== undefined) updates.utm_content = utm_content || null;
  if (utm_term !== undefined) updates.utm_term = utm_term || null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('url_channels')
    .update(updates)
    .eq('id', channelId)
    .eq('url_id', urlId)
    .select()
    .single();

  if (error || !data) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  return c.json(data);
});

/**
 * 刪除管道
 */
urlChannelRoutes.delete('/api/urls/:id/channels/:channelId', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const urlId = c.req.param('id');
  const channelId = c.req.param('channelId');

  // 確認 URL 屬於該使用者
  const { data: urlData, error: urlError } = await userClient
    .from('urls')
    .select('id')
    .eq('id', urlId)
    .single();

  if (urlError || !urlData) {
    return c.json({ error: 'URL not found' }, 404);
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('url_channels')
    .delete()
    .eq('id', channelId)
    .eq('url_id', urlId);

  if (error) {
    console.error('Failed to delete channel:', error);
    return c.json({ error: 'Failed to delete channel' }, 500);
  }

  return c.json({ message: 'Channel deleted successfully' });
});
