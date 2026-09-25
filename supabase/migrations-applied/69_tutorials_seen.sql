-- First-visit page tutorials: which ones a person has already seen.
--
-- Stored per account rather than in the browser, so a tutorial seen on the office PC
-- does not greet the same person again on their phone. The key names the page, the
-- audience and a version ("attendance.manager.v1"), so a person who is promoted sees the
-- manager's tutorial once, and rewriting a tutorial can show it again by bumping v1.
--
-- Nothing here is sensitive, but it is still one person's own rows only: there is no
-- reason for anyone — HR included — to read who has dismissed which help card.

CREATE TABLE IF NOT EXISTS public.tutorial_seen (
  user_id      uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  tutorial_key text        NOT NULL CHECK (char_length(tutorial_key) BETWEEN 1 AND 80),
  seen_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tutorial_key)
);

ALTER TABLE public.tutorial_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutorial_seen_select ON public.tutorial_seen
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY tutorial_seen_insert ON public.tutorial_seen
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.tutorial_seen FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.tutorial_seen TO authenticated;
