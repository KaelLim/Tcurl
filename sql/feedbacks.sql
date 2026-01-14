-- ============================================================
-- 社群建議功能 - 資料表建立
-- ============================================================

-- 主題/建議表
CREATE TABLE IF NOT EXISTS public.feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'suggestion',  -- suggestion, bug, question, other
  status VARCHAR(20) NOT NULL DEFAULT 'open',          -- open, in_progress, resolved, closed
  vote_count INT DEFAULT 0,
  comment_count INT DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 留言表
CREATE TABLE IF NOT EXISTS public.feedback_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES public.feedbacks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_official BOOLEAN DEFAULT FALSE,  -- 官方回覆標記
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 投票表（避免重複投票）
CREATE TABLE IF NOT EXISTS public.feedback_votes (
  feedback_id UUID NOT NULL REFERENCES public.feedbacks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (feedback_id, user_id)
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON public.feedbacks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_category ON public.feedbacks(category);
CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON public.feedbacks(status);
CREATE INDEX IF NOT EXISTS idx_feedback_comments_feedback_id ON public.feedback_comments(feedback_id);

-- 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_feedbacks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feedbacks_updated_at ON public.feedbacks;
CREATE TRIGGER feedbacks_updated_at
  BEFORE UPDATE ON public.feedbacks
  FOR EACH ROW
  EXECUTE FUNCTION update_feedbacks_updated_at();

-- 自動更新留言數
CREATE OR REPLACE FUNCTION update_feedback_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.feedbacks SET comment_count = comment_count + 1 WHERE id = NEW.feedback_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.feedbacks SET comment_count = comment_count - 1 WHERE id = OLD.feedback_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feedback_comment_count_trigger ON public.feedback_comments;
CREATE TRIGGER feedback_comment_count_trigger
  AFTER INSERT OR DELETE ON public.feedback_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_comment_count();

-- 自動更新投票數
CREATE OR REPLACE FUNCTION update_feedback_vote_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.feedbacks SET vote_count = vote_count + 1 WHERE id = NEW.feedback_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.feedbacks SET vote_count = vote_count - 1 WHERE id = OLD.feedback_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feedback_vote_count_trigger ON public.feedback_votes;
CREATE TRIGGER feedback_vote_count_trigger
  AFTER INSERT OR DELETE ON public.feedback_votes
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_vote_count();

-- RLS 政策（內部使用，登入即可操作）
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_votes ENABLE ROW LEVEL SECURITY;

-- feedbacks 政策
DROP POLICY IF EXISTS "feedbacks_select" ON public.feedbacks;
CREATE POLICY "feedbacks_select" ON public.feedbacks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "feedbacks_insert" ON public.feedbacks;
CREATE POLICY "feedbacks_insert" ON public.feedbacks FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "feedbacks_update" ON public.feedbacks;
CREATE POLICY "feedbacks_update" ON public.feedbacks FOR UPDATE TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "feedbacks_delete" ON public.feedbacks;
CREATE POLICY "feedbacks_delete" ON public.feedbacks FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- feedback_comments 政策
DROP POLICY IF EXISTS "feedback_comments_select" ON public.feedback_comments;
CREATE POLICY "feedback_comments_select" ON public.feedback_comments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "feedback_comments_insert" ON public.feedback_comments;
CREATE POLICY "feedback_comments_insert" ON public.feedback_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "feedback_comments_delete" ON public.feedback_comments;
CREATE POLICY "feedback_comments_delete" ON public.feedback_comments FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- feedback_votes 政策
DROP POLICY IF EXISTS "feedback_votes_select" ON public.feedback_votes;
CREATE POLICY "feedback_votes_select" ON public.feedback_votes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "feedback_votes_insert" ON public.feedback_votes;
CREATE POLICY "feedback_votes_insert" ON public.feedback_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "feedback_votes_delete" ON public.feedback_votes;
CREATE POLICY "feedback_votes_delete" ON public.feedback_votes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 完成
SELECT 'Feedbacks tables created successfully!' as result;
