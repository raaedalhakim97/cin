-- The custom KPI system, part 3 of 3: the actual rating, the score, and the advice.
--
--   kpi_review_lines            one row per criterion per review, both sides' ratings
--   kpi_generate_review_lines   snapshots the scorecard into lines when a review opens
--   kpi_review_score            the weighted total and how much of it exists
--   kpi_review_opportunities    what to work on, ranked
--   kpi_review_disagreements    where self and manager are two levels apart
--
-- kpi_reviews already exists and already holds both sides' submissions and timestamps.
-- This adds the per-criterion detail underneath it.

-- ── 1. The lines ───────────────────────────────────────────────────────────
-- Heavily snapshotted on purpose. weight, the criterion's name and the exact anchor
-- sentence are copied in rather than joined at read time, because all three can change
-- and a review is a record of what was said at the time. HR editing a comment in June
-- must not silently rewrite what an employee was told in March.
CREATE TABLE IF NOT EXISTS public.kpi_review_lines (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id     uuid NOT NULL REFERENCES public.kpi_reviews(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE RESTRICT,

  weight           numeric(5,2) NOT NULL,
  definition_name  text NOT NULL,
  source           text NOT NULL DEFAULT 'manual',

  self_level        smallint,
  self_anchor_id    uuid REFERENCES public.kpi_anchors(id) ON DELETE SET NULL,
  self_anchor_text  text,
  self_note         text,

  manager_level       smallint,
  manager_anchor_id   uuid REFERENCES public.kpi_anchors(id) ON DELETE SET NULL,
  manager_anchor_text text,
  manager_note        text,

  -- For automated criteria: the measurement, and the level it resolved to.
  auto_value    numeric,

  -- What actually counts. Set by trigger, never by the client.
  final_level   smallint,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, definition_id),
  CONSTRAINT kpi_review_lines_weight  CHECK (weight > 0 AND weight <= 100),
  CONSTRAINT kpi_review_lines_source  CHECK (source IN ('manual', 'automated')),
  CONSTRAINT kpi_review_lines_levels  CHECK (
    (self_level    IS NULL OR self_level    BETWEEN 1 AND 5) AND
    (manager_level IS NULL OR manager_level BETWEEN 1 AND 5) AND
    (final_level   IS NULL OR final_level   BETWEEN 1 AND 5))
);

-- The manager's rating is the score. The employee's is context — it is what makes the
-- conversation possible and what surfaces a disagreement, but it does not move the number.
-- For an automated criterion nobody rates anything; the measurement decides.
CREATE OR REPLACE FUNCTION public.kpi_review_line_final_level()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.source = 'automated' THEN
    NEW.final_level := CASE WHEN NEW.auto_value IS NULL THEN NULL
                            ELSE public.kpi_level_for_value(NEW.definition_id, NEW.auto_value) END;
    -- Nobody hand-rates an automated criterion. Silently ignoring an attempt would be
    -- worse than clearing it: the rating would appear saved and then not count.
    NEW.self_level := NULL; NEW.manager_level := NULL;
  ELSE
    NEW.final_level := NEW.manager_level;
    NEW.auto_value  := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER kpi_review_line_final BEFORE INSERT OR UPDATE ON public.kpi_review_lines
  FOR EACH ROW EXECUTE FUNCTION public.kpi_review_line_final_level();

CREATE TRIGGER kpi_review_lines_updated_at BEFORE UPDATE ON public.kpi_review_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX IF NOT EXISTS idx_kpi_review_lines_review_id       ON public.kpi_review_lines (review_id);
CREATE INDEX IF NOT EXISTS idx_kpi_review_lines_definition_id   ON public.kpi_review_lines (definition_id);
CREATE INDEX IF NOT EXISTS idx_kpi_review_lines_self_anchor_id  ON public.kpi_review_lines (self_anchor_id);
CREATE INDEX IF NOT EXISTS idx_kpi_review_lines_manager_anchor_id ON public.kpi_review_lines (manager_anchor_id);

-- ── 2. Opening a review ────────────────────────────────────────────────────
-- Copies the employee's approved scorecard into lines. This is the moment the weights
-- freeze. Refuses when there is no approved scorecard rather than inventing one — a
-- person with no agreed criteria has not been given a standard to meet, and scoring them
-- against nothing is the fabrication this product keeps removing.
CREATE OR REPLACE FUNCTION public.kpi_generate_review_lines(p_review_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee uuid;
  v_scorecard uuid;
  v_n integer := 0;
BEGIN
  SELECT employee_id INTO v_employee FROM kpi_reviews WHERE id = p_review_id;
  IF v_employee IS NULL THEN
    RAISE EXCEPTION 'No such review' USING ERRCODE = 'P0001';
  END IF;

  SELECT sc.id INTO v_scorecard
    FROM employee_scorecards sc
   WHERE sc.employee_id = v_employee
     AND sc.status = 'active'
     AND sc.effective_from <= CURRENT_DATE
     AND (sc.effective_to IS NULL OR sc.effective_to >= CURRENT_DATE)
   ORDER BY sc.effective_from DESC
   LIMIT 1;

  IF v_scorecard IS NULL THEN
    RAISE EXCEPTION 'This employee has no approved scorecard in effect, so there is nothing to review them against.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO kpi_review_lines (review_id, definition_id, weight, definition_name, source)
  SELECT p_review_id, w.definition_id, w.weight, d.name, d.source
    FROM employee_scorecard_weights(v_scorecard) w
    JOIN kpi_definitions d ON d.id = w.definition_id
   WHERE d.active
  ON CONFLICT (review_id, definition_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_generate_review_lines(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_generate_review_lines(uuid) TO authenticated;

-- ── 3. The score ───────────────────────────────────────────────────────────
-- Weighted average over the criteria that have been rated. Dividing by the rated weight
-- rather than the total is deliberate: a half-finished review should read "68 so far, 60%
-- complete", not "41" — which is what dividing by the full weight would show, and which
-- would look like a catastrophe rather than an unfinished job.
--
-- coverage_pct is the honesty valve. A score at 40% coverage is not the same claim as one
-- at 100%, and the UI must not render them identically.
CREATE OR REPLACE FUNCTION public.kpi_review_score(p_review_id uuid)
RETURNS TABLE (total numeric, coverage_pct numeric, rated_weight numeric, total_weight numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    CASE WHEN sum(weight) FILTER (WHERE final_level IS NOT NULL) > 0
         THEN round(
                sum(public.kpi_level_points(final_level) * weight)
                  FILTER (WHERE final_level IS NOT NULL)
                / sum(weight) FILTER (WHERE final_level IS NOT NULL), 2)
         END,
    CASE WHEN sum(weight) > 0
         THEN round(100 * COALESCE(sum(weight) FILTER (WHERE final_level IS NOT NULL), 0)
                    / sum(weight), 1)
         ELSE 0 END,
    COALESCE(sum(weight) FILTER (WHERE final_level IS NOT NULL), 0),
    COALESCE(sum(weight), 0)
  FROM kpi_review_lines
  WHERE review_id = p_review_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_review_score(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_review_score(uuid) TO authenticated;

-- ── 4. What to work on ─────────────────────────────────────────────────────
-- The recommendation engine, and the one place where the arithmetic needed an opinion.
--
-- The obvious ranking is "points you would gain by moving up one level". It is wrong.
-- Because the scale is linear and every step is worth 20, that gain is 20 * weight /
-- total_weight for every criterion — so the ranking collapses to "your heaviest criterion,
-- always", regardless of how you are doing on it. It would tell someone sitting at Exceeds
-- on a heavy criterion to push for Outstanding while they are at Below expectations on a
-- lighter one. That is not advice, it is arithmetic with a straight face.
--
-- So the ranking is in two bands, and 'Meets expectations' (level 3) is the hinge:
--
--   shortfall   how many points you are LOSING by sitting below the standard. Anything
--               below level 3 has one. This is what to fix, and it comes first.
--   upside      what you would gain by going up one level from level 3 or above.
--
-- Sort by band first, then by size. Everything below standard outranks everything above
-- it, however heavily weighted — because "you are failing this" is a different kind of
-- sentence from "you could be better at this", and a tool that mixes them is not helping
-- anybody manage.
CREATE OR REPLACE FUNCTION public.kpi_review_opportunities(p_review_id uuid)
RETURNS TABLE (
  definition_id   uuid,
  definition_name text,
  weight          numeric,
  current_level   smallint,
  target_level    smallint,
  band            text,
  points_at_stake numeric,
  target_anchor   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH total AS (
    SELECT NULLIF(sum(weight), 0) AS w FROM kpi_review_lines WHERE review_id = p_review_id
  ),
  scored AS (
    SELECT l.definition_id,
           l.definition_name,
           l.weight,
           l.final_level,
           -- Below standard: aim at level 3. At or above: aim one level up. Already at 5:
           -- nothing to aim at, and the row drops out below.
           CASE WHEN l.final_level < 3 THEN 3
                WHEN l.final_level < 5 THEN (l.final_level + 1)
                END::smallint AS target_level,
           CASE WHEN l.final_level < 3 THEN 'shortfall' ELSE 'upside' END AS band
      FROM kpi_review_lines l
     WHERE l.review_id = p_review_id
       AND l.final_level IS NOT NULL
  )
  SELECT s.definition_id,
         s.definition_name,
         s.weight,
         s.final_level,
         s.target_level,
         s.band,
         round((public.kpi_level_points(s.target_level) - public.kpi_level_points(s.final_level))
               * s.weight / t.w, 2) AS points_at_stake,
         -- One representative sentence for the level being aimed at, so the advice is in
         -- the company's own words rather than the product's.
         (SELECT a.comment FROM kpi_anchors a
           WHERE a.definition_id = s.definition_id AND a.level = s.target_level AND a.active
           ORDER BY a.sort_order, a.created_at LIMIT 1) AS target_anchor
    FROM scored s CROSS JOIN total t
   WHERE s.target_level IS NOT NULL
   ORDER BY CASE s.band WHEN 'shortfall' THEN 0 ELSE 1 END,
            points_at_stake DESC,
            s.definition_name;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_review_opportunities(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_review_opportunities(uuid) TO authenticated;

-- ── 5. Where the two sides disagree ────────────────────────────────────────
-- Two levels apart is the threshold. One level is normal — people calibrate differently.
-- Two is a different account of the same quarter, and finalising it without a conversation
-- is how an employee first learns their manager disagrees by reading a number.
--
-- Returns the rows, not a boolean, so the screen can name them.
CREATE OR REPLACE FUNCTION public.kpi_review_disagreements(p_review_id uuid)
RETURNS TABLE (
  definition_id   uuid,
  definition_name text,
  self_level      smallint,
  manager_level   smallint,
  gap             smallint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.definition_id, l.definition_name, l.self_level, l.manager_level,
         abs(l.self_level - l.manager_level)::smallint
    FROM kpi_review_lines l
   WHERE l.review_id = p_review_id
     AND l.self_level IS NOT NULL
     AND l.manager_level IS NOT NULL
     AND abs(l.self_level - l.manager_level) >= 2
   ORDER BY abs(l.self_level - l.manager_level) DESC, l.definition_name;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_review_disagreements(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_review_disagreements(uuid) TO authenticated;

-- ── Access ─────────────────────────────────────────────────────────────────
ALTER TABLE public.kpi_review_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kpi_review_lines FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_review_lines TO authenticated;

-- Read: your own review, your team's, or all of them if you are HR. An employee reading
-- their own lines — including the manager's rating and the anchor sentence behind it — is
-- the entire point. A score without the sentence is a grade with no feedback.
CREATE POLICY kpi_review_lines_read ON public.kpi_review_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM kpi_reviews r
     WHERE r.id = review_id
       AND r.company_id = get_user_company_id((SELECT auth.uid()))
       AND (get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'department_manager')
            OR r.employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid())))));

-- Write is the same set. Which COLUMNS each may write is not expressible in RLS — an
-- employee must set self_* and never manager_* — so that is enforced by the column guard
-- below, the same way migration 26 handles self-scoring on kpi_scores.
CREATE POLICY kpi_review_lines_write ON public.kpi_review_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM kpi_reviews r
     WHERE r.id = review_id
       AND r.company_id = get_user_company_id((SELECT auth.uid()))
       AND (get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'department_manager')
            OR r.employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid())))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM kpi_reviews r
     WHERE r.id = review_id
       AND r.company_id = get_user_company_id((SELECT auth.uid()))
       AND (get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'department_manager')
            OR r.employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid())))));

-- ── The column guard ───────────────────────────────────────────────────────
-- RLS decides which ROWS you may touch and never which COLUMNS. Without this an employee
-- could write their own manager_level and score themselves — exactly the hole migration 26
-- closed on kpi_scores, in a new table.
CREATE OR REPLACE FUNCTION public.kpi_review_line_self_writes_self_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_role text;
  v_is_self boolean;
BEGIN
  -- The schema computing, not a client writing. pg_trigger_depth distinguishes them.
  IF v_uid IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  v_role := get_user_role(v_uid);
  IF v_role IN ('super_admin', 'hr_manager', 'department_manager') THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM kpi_reviews r JOIN employees e ON e.id = r.employee_id
     WHERE r.id = NEW.review_id AND e.user_id = v_uid
  ) INTO v_is_self;

  IF NOT v_is_self THEN
    RAISE EXCEPTION 'You can only fill in your own self-review.' USING ERRCODE = 'P0001';
  END IF;

  -- Pin everything except the three self columns to what was already there.
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Review lines are created when the cycle opens, not by hand.'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.weight              := OLD.weight;
  NEW.definition_id       := OLD.definition_id;
  NEW.definition_name     := OLD.definition_name;
  NEW.source              := OLD.source;
  NEW.manager_level       := OLD.manager_level;
  NEW.manager_anchor_id   := OLD.manager_anchor_id;
  NEW.manager_anchor_text := OLD.manager_anchor_text;
  NEW.manager_note        := OLD.manager_note;
  NEW.auto_value          := OLD.auto_value;
  NEW.final_level         := OLD.final_level;

  RETURN NEW;
END;
$function$;

-- aa0_ so it runs before kpi_review_line_final, which recomputes final_level from the
-- values this guard has just pinned. BEFORE triggers fire in name order.
CREATE TRIGGER aa0_kpi_review_line_self_guard
  BEFORE INSERT OR UPDATE ON public.kpi_review_lines
  FOR EACH ROW EXECUTE FUNCTION public.kpi_review_line_self_writes_self_only();
