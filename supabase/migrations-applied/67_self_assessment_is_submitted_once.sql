-- A quarterly self-assessment is submitted once.
--
-- Before this, an employee could resubmit their self-score as many times as they
-- liked while the cycle sat in 'self_review'. The product rule is simpler: rate
-- yourself once a quarter, then it is locked until the next quarter opens.
--
-- The lock is kpi_reviews.self_submitted_at, which kpi_review_guard already sets
-- on the first self write. Two guards now refuse a second write by the employee:
--   1. kpi_review_guard      — the overall self_score / self_comment
--   2. kpi_review_line_stage_guard — the per-criterion self ratings, so the
--      Evaluation tab cannot be used to revise a submitted self-assessment
-- HR is untouched: it still returns early from kpi_review_guard and can correct
-- a mistaken submission (clear self_submitted_at) if an employee asks.

CREATE OR REPLACE FUNCTION public.kpi_review_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_role   text;
  v_is_hr  boolean := false;
  v_is_self boolean := false;
  v_status text;
  v_emp    uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;  -- maintenance / system paths

  v_role    := get_user_role(v_uid);
  v_is_hr   := v_role IN ('super_admin','hr_manager');
  v_is_self := EXISTS (SELECT 1 FROM employees WHERE id = NEW.employee_id AND user_id = v_uid);
  SELECT status INTO v_status FROM kpi_review_cycles WHERE id = NEW.cycle_id;
  SELECT id INTO v_emp FROM employees WHERE user_id = v_uid LIMIT 1;

  -- HR may correct anything, at any stage. They own the cycle.
  IF v_is_hr THEN RETURN NEW; END IF;

  IF v_is_self THEN
    -- The employee owns exactly two fields, and only while self-review is open.
    IF v_status <> 'self_review' THEN
      RAISE EXCEPTION 'Self-assessment is not open for this quarter (cycle is %).', v_status
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.self_score IS DISTINCT FROM OLD.self_score
       OR NEW.self_comment IS DISTINCT FROM OLD.self_comment THEN
      -- Once a quarter. A second write is refused, not silently reverted, so the
      -- form can say why.
      IF OLD.self_submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'You already submitted your self-assessment for this quarter. The next one opens next quarter.'
          USING ERRCODE = 'P0001';
      END IF;
      NEW.self_submitted_at := now();
    ELSE
      -- The timestamp is the lock, so the employee cannot write it directly —
      -- clearing it would reopen their own submission.
      NEW.self_submitted_at := OLD.self_submitted_at;
    END IF;
    -- Everything else reverts, silently. An employee cannot score themselves
    -- on the manager's behalf or touch the calculated result.
    NEW.manager_score       := OLD.manager_score;
    NEW.behavior_score       := OLD.behavior_score;
    NEW.achievement_score    := OLD.achievement_score;
    NEW.manager_comment      := OLD.manager_comment;
    NEW.manager_submitted_at := OLD.manager_submitted_at;
    NEW.manager_employee_id  := OLD.manager_employee_id;
    NEW.auto_attendance      := OLD.auto_attendance;
    NEW.auto_reliability     := OLD.auto_reliability;
    NEW.adjustment_points    := OLD.adjustment_points;
    NEW.final_score          := OLD.final_score;
    NEW.rating               := OLD.rating;
    NEW.bonus_eligible       := OLD.bonus_eligible;
    NEW.coverage_pct         := OLD.coverage_pct;
    NEW.weights_used         := OLD.weights_used;
    NEW.calculated_at        := OLD.calculated_at;
    NEW.employee_id          := OLD.employee_id;
    NEW.cycle_id             := OLD.cycle_id;
    RETURN NEW;
  END IF;

  IF v_role = 'department_manager' THEN
    IF v_status <> 'manager_review' THEN
      RAISE EXCEPTION 'Manager review is not open for this quarter (cycle is %).', v_status
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.manager_score IS DISTINCT FROM OLD.manager_score
       OR NEW.behavior_score IS DISTINCT FROM OLD.behavior_score
       OR NEW.achievement_score IS DISTINCT FROM OLD.achievement_score
       OR NEW.manager_comment IS DISTINCT FROM OLD.manager_comment THEN
      NEW.manager_submitted_at := now();
      NEW.manager_employee_id  := v_emp;
    END IF;
    -- A manager cannot rewrite what the employee said about themselves, nor
    -- the computed outcome.
    NEW.self_score        := OLD.self_score;
    NEW.self_comment      := OLD.self_comment;
    NEW.self_submitted_at := OLD.self_submitted_at;
    NEW.auto_attendance   := OLD.auto_attendance;
    NEW.auto_reliability  := OLD.auto_reliability;
    NEW.adjustment_points := OLD.adjustment_points;
    NEW.final_score       := OLD.final_score;
    NEW.rating            := OLD.rating;
    NEW.bonus_eligible    := OLD.bonus_eligible;
    NEW.coverage_pct      := OLD.coverage_pct;
    NEW.weights_used      := OLD.weights_used;
    NEW.calculated_at     := OLD.calculated_at;
    NEW.employee_id       := OLD.employee_id;
    NEW.cycle_id          := OLD.cycle_id;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Your role cannot write to a performance review' USING ERRCODE = 'P0001';
END;
$function$;

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
  v_submitted timestamptz;
  v_is_subject boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR pg_trigger_depth() > 1
     OR current_setting('byond.kpi_engine', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT c.status, r.self_submitted_at,
         EXISTS (SELECT 1 FROM employees e
                  WHERE e.id = r.employee_id AND e.user_id = (SELECT auth.uid()))
    INTO v_stage, v_submitted, v_is_subject
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

  IF v_stage = 'self_review' AND v_self AND v_is_subject AND v_submitted IS NOT NULL THEN
    RAISE EXCEPTION 'You already submitted your self-assessment for this quarter. The next one opens next quarter.'
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
