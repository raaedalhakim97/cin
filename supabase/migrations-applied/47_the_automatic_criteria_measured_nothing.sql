-- Two gaps the screens made obvious, both of the same kind: a rule that existed in the
-- design and nowhere in the database.
--
-- ── 1. "Automatic" criteria measured nothing ───────────────────────────────
--
-- kpi_definitions has had source='automated' and kpi_auto_thresholds since migration 40, and
-- kpi_review_lines has an auto_value column whose trigger turns a number into a level. What
-- has never existed is anything that puts a number in that column. An automated criterion
-- therefore sat at NULL forever, contributed nothing, and quietly reduced everybody's
-- coverage — while the screen showed it with a badge saying "automatic".
--
-- Raaed asked for exactly this: "the automated KPI, each action can reflect in the app to
-- give feedback and fix the issues". The measurement has to be real for the feedback to be.
--
-- ── 2. The review stages were a label on the screen ────────────────────────
--
-- kpi_reviews has had a stage guard since the quarterly cycle was built: self_score is
-- writable during self_review and reverted outside it. kpi_review_lines never got one. So
-- the sentence the product tells employees — "a self-assessment you can revise after seeing
-- your manager's score is not a self-assessment" — was true of the old score column and not
-- of the new per-criterion ratings underneath it. An employee could rewrite their rating
-- after the manager rated, and a manager could rate before the employee had said anything.

-- ── The engine flag ────────────────────────────────────────────────────────
-- Migration 46 introduced byond.seeding_review_lines so the column guard could tell the
-- seeder from a person. There are now two system writers, so the flag is renamed to say
-- what it means rather than which function set it.
CREATE OR REPLACE FUNCTION public.kpi_seed_review_lines(p_review_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee  uuid;
  v_scorecard uuid;
  v_total     numeric;
  v_n         integer := 0;
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

  v_total := public.employee_scorecard_weight_total(v_scorecard);
  IF v_total <> 100 THEN
    RAISE EXCEPTION 'This employee''s scorecard weights add up to %, not 100%%. Fix it before opening their review.',
      v_total || '%' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('byond.kpi_engine', 'on', true);

  INSERT INTO kpi_review_lines (review_id, definition_id, weight, definition_name, source)
  SELECT p_review_id, w.definition_id, w.weight, d.name, d.source
    FROM employee_scorecard_weights(v_scorecard) w
    JOIN kpi_definitions d ON d.id = w.definition_id
   WHERE d.active
  ON CONFLICT (review_id, definition_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM set_config('byond.kpi_engine', 'off', true);
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_seed_review_lines(uuid) FROM PUBLIC, anon, authenticated;

-- ── The measurement ────────────────────────────────────────────────────────
-- One function per company-visible metric name, so a criterion can only point at something
-- that is actually computed — the CHECK on kpi_definitions.metric and this CASE are the two
-- halves of the same promise.
--
-- Every metric returns NULL rather than 0 when there is nothing to measure. A quarter with
-- no attendance rows is "we did not measure this", and scoring it as a perfect or a failing
-- quarter would both be inventions. NULL travels all the way through: no level, no
-- contribution to the score, and the coverage figure says so out loud.
CREATE OR REPLACE FUNCTION public.kpi_metric_value(
  p_employee_id uuid, p_metric text, p_from date, p_to date)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_present   integer;
  v_late      integer;
  v_absent    integer;
  v_approved  integer;
  v_early     integer;
  v_counted   integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE a.status = 'present'),
    count(*) FILTER (WHERE a.status LIKE 'late\_%'),
    count(*) FILTER (WHERE a.status = 'absent_unauthorized'),
    count(*) FILTER (WHERE a.status = 'absent_approved'),
    count(*) FILTER (WHERE COALESCE(a.early_minutes, 0) > 0)
    INTO v_present, v_late, v_absent, v_approved, v_early
  FROM attendance a
  WHERE a.employee_id = p_employee_id
    AND a.date BETWEEN p_from AND p_to;

  -- Approved leave is excluded from every denominator. Taking leave you are entitled to
  -- must not move a performance score; that was fixed for the monthly score long ago and
  -- the same rule applies here.
  v_counted := v_present + v_late + v_absent;

  RETURN CASE p_metric
    WHEN 'attendance_pct' THEN
      CASE WHEN v_counted = 0 THEN NULL
           ELSE round(100.0 * (v_present + v_late) / v_counted, 2) END
    WHEN 'punctuality_pct' THEN
      CASE WHEN v_present + v_late = 0 THEN NULL
           ELSE round(100.0 * v_present / (v_present + v_late), 2) END
    -- The three counts are only meaningful if the period was observed at all. With no
    -- attendance rows whatsoever, "zero late arrivals" would be a perfect score awarded for
    -- an absence of data.
    WHEN 'late_count'        THEN CASE WHEN v_counted = 0 THEN NULL ELSE v_late END
    WHEN 'absence_count'     THEN CASE WHEN v_counted = 0 THEN NULL ELSE v_absent END
    WHEN 'early_leave_count' THEN CASE WHEN v_counted = 0 THEN NULL ELSE v_early END
    ELSE NULL
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_metric_value(uuid, text, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_metric_value(uuid, text, date, date) TO authenticated;

-- ── Writing it onto the review ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kpi_refresh_auto_lines(p_review_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee uuid;
  v_from date; v_to date;
  v_year integer; v_quarter integer;
  v_n integer := 0;
  r record;
BEGIN
  SELECT rv.employee_id, c.period_year, c.period_quarter
    INTO v_employee, v_year, v_quarter
    FROM kpi_reviews rv JOIN kpi_review_cycles c ON c.id = rv.cycle_id
   WHERE rv.id = p_review_id;
  IF v_employee IS NULL THEN RETURN 0; END IF;

  v_from := make_date(v_year, (v_quarter - 1) * 3 + 1, 1);
  v_to   := (make_date(v_year, v_quarter * 3, 1) + interval '1 month - 1 day')::date;

  PERFORM set_config('byond.kpi_engine', 'on', true);

  FOR r IN
    SELECT l.id, d.metric
      FROM kpi_review_lines l
      JOIN kpi_definitions d ON d.id = l.definition_id
     WHERE l.review_id = p_review_id
       AND l.source = 'automated'
       AND d.metric IS NOT NULL
  LOOP
    UPDATE kpi_review_lines
       SET auto_value = public.kpi_metric_value(v_employee, r.metric, v_from, v_to)
     WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;

  PERFORM set_config('byond.kpi_engine', 'off', true);
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_refresh_auto_lines(uuid) FROM PUBLIC, anon, authenticated;

-- Refreshed when the quarter moves, not on a timer. Twice on purpose: once entering
-- manager_review so the manager rates alongside the real numbers, and again at calculated
-- so the final figure covers the whole quarter rather than the state it was in when the
-- manager happened to open the screen.
CREATE OR REPLACE FUNCTION public.kpi_cycle_refresh_auto_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('manager_review', 'calculated') THEN
    FOR r IN SELECT id FROM kpi_reviews WHERE cycle_id = NEW.id LOOP
      PERFORM public.kpi_refresh_auto_lines(r.id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS kpi_cycle_auto_lines ON public.kpi_review_cycles;
CREATE TRIGGER kpi_cycle_auto_lines
  AFTER UPDATE OF status ON public.kpi_review_cycles
  FOR EACH ROW EXECUTE FUNCTION public.kpi_cycle_refresh_auto_lines();

-- ── The stage guard ────────────────────────────────────────────────────────
-- aa1_ so it runs after aa0_kpi_review_line_self_guard, which pins the manager columns back
-- for a self-rater. Order matters: an employee whose forbidden write has already been
-- pinned should not then be told off for writing at the wrong time — they did not write it.
CREATE OR REPLACE FUNCTION public.kpi_review_line_stage_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stage text;
  v_self boolean;
  v_mgr  boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR pg_trigger_depth() > 1
     OR current_setting('byond.kpi_engine', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT c.status INTO v_stage
    FROM kpi_reviews r JOIN kpi_review_cycles c ON c.id = r.cycle_id
   WHERE r.id = NEW.review_id;

  v_self := NEW.self_level       IS DISTINCT FROM OLD.self_level
         OR NEW.self_anchor_id   IS DISTINCT FROM OLD.self_anchor_id
         OR NEW.self_anchor_text IS DISTINCT FROM OLD.self_anchor_text
         OR NEW.self_note        IS DISTINCT FROM OLD.self_note;

  v_mgr  := NEW.manager_level       IS DISTINCT FROM OLD.manager_level
         OR NEW.manager_anchor_id   IS DISTINCT FROM OLD.manager_anchor_id
         OR NEW.manager_anchor_text IS DISTINCT FROM OLD.manager_anchor_text
         OR NEW.manager_note        IS DISTINCT FROM OLD.manager_note;

  IF NOT v_self AND NOT v_mgr THEN RETURN NEW; END IF;

  IF v_stage = 'draft' THEN
    RAISE EXCEPTION 'This quarter has not been opened yet.' USING ERRCODE = 'P0001';
  END IF;

  IF v_stage = 'self_review' AND v_mgr THEN
    RAISE EXCEPTION 'Manager ratings open once self-assessment closes. Let them put their own view first.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_stage = 'manager_review' AND v_self THEN
    RAISE EXCEPTION 'Self-assessment is closed for this quarter. A self-assessment you can revise after seeing your manager''s rating is not a self-assessment.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_stage IN ('calculated', 'published') THEN
    RAISE EXCEPTION 'This quarter is finished and its ratings are a record of what was said at the time.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aa1_kpi_review_line_stage ON public.kpi_review_lines;
CREATE TRIGGER aa1_kpi_review_line_stage
  BEFORE UPDATE ON public.kpi_review_lines
  FOR EACH ROW EXECUTE FUNCTION public.kpi_review_line_stage_guard();

-- ── And the column guard reads the renamed flag ────────────────────────────
CREATE OR REPLACE FUNCTION public.kpi_review_line_self_writes_self_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_emp  uuid;
  v_is_self boolean;
BEGIN
  IF v_uid IS NULL
     OR pg_trigger_depth() > 1
     OR current_setting('byond.kpi_engine', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT employee_id INTO v_emp FROM kpi_reviews WHERE id = NEW.review_id;

  IF public.kpi_manages_employee(v_emp) THEN RETURN NEW; END IF;

  SELECT EXISTS (SELECT 1 FROM employees e WHERE e.id = v_emp AND e.user_id = v_uid)
    INTO v_is_self;

  IF NOT v_is_self THEN
    RAISE EXCEPTION 'You can only fill in your own self-review. This employee is not in your team.'
      USING ERRCODE = 'P0001';
  END IF;

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
