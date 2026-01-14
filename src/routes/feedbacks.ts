/**
 * 社群建議路由 - Deno/Hono 版本
 *
 * 提供社群建議的 CRUD 操作、留言、投票等功能
 *
 * @module routes/feedbacks
 */

import { Hono, type Context } from '@hono/hono';
import { createUserClient, extractToken, getSupabase } from '../services/supabase.ts';

// 建立路由實例
export const feedbackRoutes = new Hono();

// ============================================================
// 輔助函數
// ============================================================

/**
 * 從請求中取得使用者 Supabase Client
 */
function getUserClientFromRequest(c: Context): ReturnType<typeof createUserClient> | null {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) {
    return null;
  }
  return createUserClient(token);
}

/**
 * 回傳未授權錯誤
 */
function sendUnauthorized(c: Context): Response {
  return c.json(
    {
      error: 'Unauthorized',
      message: '請先登入',
    },
    401
  );
}

/**
 * 取得使用者資訊（用於顯示名稱）
 */
async function getUserInfo(userId: string) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('auth.users')
    .select('id, email, raw_user_meta_data')
    .eq('id', userId)
    .single();

  if (!data) return null;

  const metadata = data.raw_user_meta_data || {};
  return {
    id: data.id,
    email: data.email,
    display_name: metadata.chinese_firstname && metadata.chinese_lastname
      ? `${metadata.chinese_lastname}${metadata.chinese_firstname}`
      : metadata.display_name || metadata.name || data.email?.split('@')[0] || '匿名用戶'
  };
}

// ============================================================
// API 路由 - 建議列表
// ============================================================

/**
 * 取得所有建議（需要登入）
 * GET /api/feedbacks
 * Query: category, status, sort (newest, oldest, most_votes, most_comments)
 */
feedbackRoutes.get('/api/feedbacks', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  try {
    const category = c.req.query('category');
    const status = c.req.query('status');
    const sort = c.req.query('sort') || 'newest';

    let query = userClient
      .from('feedbacks')
      .select('*');

    // 篩選
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // 排序
    switch (sort) {
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'most_votes':
        query = query.order('vote_count', { ascending: false });
        break;
      case 'most_comments':
        query = query.order('comment_count', { ascending: false });
        break;
      default: // newest
        query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching feedbacks:', error);
      return c.json({ error: 'Failed to fetch feedbacks', message: error.message }, 500);
    }

    // 取得發起人資訊
    const supabase = getSupabase();
    const feedbacksWithUsers = await Promise.all(
      (data || []).map(async (feedback) => {
        if (feedback.created_by) {
          const { data: userData } = await supabase.auth.admin.getUserById(feedback.created_by);
          if (userData?.user) {
            const meta = userData.user.user_metadata || {};
            feedback.author = {
              id: userData.user.id,
              display_name: meta.chinese_firstname && meta.chinese_lastname
                ? `${meta.chinese_lastname}${meta.chinese_firstname}`
                : meta.display_name || meta.name || userData.user.email?.split('@')[0] || '匿名用戶'
            };
          }
        }
        return feedback;
      })
    );

    return c.json(feedbacksWithUsers);
  } catch (error) {
    console.error('Error in GET /api/feedbacks:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * 取得單一建議詳情（需要登入）
 * GET /api/feedbacks/:id
 */
feedbackRoutes.get('/api/feedbacks/:id', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');

  try {
    const { data: feedback, error } = await userClient
      .from('feedbacks')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !feedback) {
      return c.json({ error: 'Not found', message: '找不到該建議' }, 404);
    }

    // 取得發起人資訊
    const supabase = getSupabase();
    if (feedback.created_by) {
      const { data: userData } = await supabase.auth.admin.getUserById(feedback.created_by);
      if (userData?.user) {
        const meta = userData.user.user_metadata || {};
        feedback.author = {
          id: userData.user.id,
          display_name: meta.chinese_firstname && meta.chinese_lastname
            ? `${meta.chinese_lastname}${meta.chinese_firstname}`
            : meta.display_name || meta.name || userData.user.email?.split('@')[0] || '匿名用戶'
        };
      }
    }

    // 取得留言
    const { data: comments } = await userClient
      .from('feedback_comments')
      .select('*')
      .eq('feedback_id', id)
      .order('created_at', { ascending: true });

    // 取得留言者資訊
    const commentsWithUsers = await Promise.all(
      (comments || []).map(async (comment) => {
        if (comment.created_by) {
          const { data: userData } = await supabase.auth.admin.getUserById(comment.created_by);
          if (userData?.user) {
            const meta = userData.user.user_metadata || {};
            comment.author = {
              id: userData.user.id,
              display_name: meta.chinese_firstname && meta.chinese_lastname
                ? `${meta.chinese_lastname}${meta.chinese_firstname}`
                : meta.display_name || meta.name || userData.user.email?.split('@')[0] || '匿名用戶'
            };
          }
        }
        return comment;
      })
    );

    feedback.comments = commentsWithUsers;

    // 檢查當前使用者是否已投票
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      const { data: vote } = await userClient
        .from('feedback_votes')
        .select('*')
        .eq('feedback_id', id)
        .eq('user_id', user.id)
        .single();
      feedback.user_voted = !!vote;
    }

    return c.json(feedback);
  } catch (error) {
    console.error('Error in GET /api/feedbacks/:id:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * 建立新建議（需要登入）
 * POST /api/feedbacks
 */
feedbackRoutes.post('/api/feedbacks', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  try {
    const body = await c.req.json();
    const { title, content, category } = body;

    // 驗證
    if (!title || !title.trim()) {
      return c.json({ error: 'Bad Request', message: '標題為必填' }, 400);
    }
    if (!content || !content.trim()) {
      return c.json({ error: 'Bad Request', message: '內容為必填' }, 400);
    }
    if (title.length > 200) {
      return c.json({ error: 'Bad Request', message: '標題不能超過 200 字' }, 400);
    }

    // 取得當前使用者
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return sendUnauthorized(c);
    }

    const { data, error } = await userClient
      .from('feedbacks')
      .insert({
        title: title.trim(),
        content: content.trim(),
        category: category || 'suggestion',
        created_by: user.id
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating feedback:', error);
      return c.json({ error: 'Failed to create feedback', message: error.message }, 500);
    }

    return c.json(data, 201);
  } catch (error) {
    console.error('Error in POST /api/feedbacks:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * 更新建議（只能更新自己的）
 * PUT /api/feedbacks/:id
 */
feedbackRoutes.put('/api/feedbacks/:id', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');

  try {
    const body = await c.req.json();
    const { title, content, category, status } = body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (content !== undefined) updateData.content = content.trim();
    if (category !== undefined) updateData.category = category;
    if (status !== undefined) updateData.status = status;

    const { data, error } = await userClient
      .from('feedbacks')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating feedback:', error);
      return c.json({ error: 'Failed to update feedback', message: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in PUT /api/feedbacks/:id:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * 刪除建議（只能刪除自己的）
 * DELETE /api/feedbacks/:id
 */
feedbackRoutes.delete('/api/feedbacks/:id', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const id = c.req.param('id');

  try {
    const { error } = await userClient
      .from('feedbacks')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting feedback:', error);
      return c.json({ error: 'Failed to delete feedback', message: error.message }, 500);
    }

    return c.json({ message: '已刪除' });
  } catch (error) {
    console.error('Error in DELETE /api/feedbacks/:id:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ============================================================
// API 路由 - 留言
// ============================================================

/**
 * 新增留言（需要登入）
 * POST /api/feedbacks/:id/comments
 */
feedbackRoutes.post('/api/feedbacks/:id/comments', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const feedbackId = c.req.param('id');

  try {
    const body = await c.req.json();
    const { content } = body;

    if (!content || !content.trim()) {
      return c.json({ error: 'Bad Request', message: '留言內容為必填' }, 400);
    }

    // 取得當前使用者
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return sendUnauthorized(c);
    }

    const { data, error } = await userClient
      .from('feedback_comments')
      .insert({
        feedback_id: feedbackId,
        content: content.trim(),
        created_by: user.id
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating comment:', error);
      return c.json({ error: 'Failed to create comment', message: error.message }, 500);
    }

    // 附加作者資訊
    const supabase = getSupabase();
    const { data: userData } = await supabase.auth.admin.getUserById(user.id);
    if (userData?.user) {
      const meta = userData.user.user_metadata || {};
      data.author = {
        id: userData.user.id,
        display_name: meta.chinese_firstname && meta.chinese_lastname
          ? `${meta.chinese_lastname}${meta.chinese_firstname}`
          : meta.display_name || meta.name || userData.user.email?.split('@')[0] || '匿名用戶'
      };
    }

    return c.json(data, 201);
  } catch (error) {
    console.error('Error in POST /api/feedbacks/:id/comments:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * 刪除留言（只能刪除自己的）
 * DELETE /api/feedbacks/:id/comments/:commentId
 */
feedbackRoutes.delete('/api/feedbacks/:id/comments/:commentId', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const commentId = c.req.param('commentId');

  try {
    const { error } = await userClient
      .from('feedback_comments')
      .delete()
      .eq('id', commentId);

    if (error) {
      console.error('Error deleting comment:', error);
      return c.json({ error: 'Failed to delete comment', message: error.message }, 500);
    }

    return c.json({ message: '已刪除' });
  } catch (error) {
    console.error('Error in DELETE /api/feedbacks/:id/comments/:commentId:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ============================================================
// API 路由 - 投票
// ============================================================

/**
 * 投票/取消投票（需要登入）
 * POST /api/feedbacks/:id/vote
 */
feedbackRoutes.post('/api/feedbacks/:id/vote', async (c) => {
  const userClient = getUserClientFromRequest(c);
  if (!userClient) {
    return sendUnauthorized(c);
  }

  const feedbackId = c.req.param('id');

  try {
    // 取得當前使用者
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return sendUnauthorized(c);
    }

    // 檢查是否已投票
    const { data: existingVote } = await userClient
      .from('feedback_votes')
      .select('*')
      .eq('feedback_id', feedbackId)
      .eq('user_id', user.id)
      .single();

    if (existingVote) {
      // 取消投票
      const { error } = await userClient
        .from('feedback_votes')
        .delete()
        .eq('feedback_id', feedbackId)
        .eq('user_id', user.id);

      if (error) {
        return c.json({ error: 'Failed to remove vote', message: error.message }, 500);
      }

      return c.json({ voted: false, message: '已取消投票' });
    } else {
      // 新增投票
      const { error } = await userClient
        .from('feedback_votes')
        .insert({
          feedback_id: feedbackId,
          user_id: user.id
        });

      if (error) {
        return c.json({ error: 'Failed to add vote', message: error.message }, 500);
      }

      return c.json({ voted: true, message: '已投票' });
    }
  } catch (error) {
    console.error('Error in POST /api/feedbacks/:id/vote:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});
