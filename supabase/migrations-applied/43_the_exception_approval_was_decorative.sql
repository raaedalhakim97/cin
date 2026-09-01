-- Two holes in migration 41's exception handling, found by testing the engine rather
-- than by reading it.
--
-- ── Hole 1: the exception approval was not enforced ────────────────────────
--
-- Adding a weight override flips a scorecard to is_exception and sets status to
-- 'pending_hr'. Migration 41 wrote that trigger and then never guarded the column, so
-- there was nothing stopping the next statement being:
--
--     UPDATE employee_scorecards SET status = 'active' WHERE id = ...;
--
-- Any department_manager could do it, because the RLS write policy lets them touch the
-- row. The whole "a departure from the standard needs sign-off" design was a status
-- string anybody could edit. kpi_templates had a transition validator from the start;
-- employee_scorecards was given the same states and none of the enforcement.
--
-- ── Hole 2: weights stopped totalling 100 ──────────────────────────────────
--
-- A template must total exactly 100 before it can be submitted. An override is not
-- checked at all, so overriding one line from 70 to 50 leaves that employee's effective
-- weights totalling 80 — measured in testing, no complaint from anything.
--
-- This never produced a wrong score: kpi_review_score divides by the actual summed
-- weight, so 80 normalises the same way 100 does. It broke the promise instead. "Weights
-- must add up to 100" stopped being true for precisely the scorecards that departed from
-- the approved standard — the ones that were supposed to attract the most scrutiny.

-- ── The check both paths share ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employee_scorecard_weight_total(p_scorecard_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(weight), 0) FROM public.employee_scorecard_weights(p_scorecard_id);
$function$;

REVOKE EXECUTE ON FUNCTION public.employee_scorecard_weight_total(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.employee_scorecard_weight_total(uuid) TO authenticated;

-- ── The chain, mirroring kpi_templates ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_employee_scorecard_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_role  text;
  v_emp   uuid;
  v_total numeric;
BEGIN
  IF v_uid IS NULL OR NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- The schema moving the row, not a person: employee_scorecard_override_is_an_exception
  -- sets status to pending_hr from inside a trigger, and that is the mechanism working
  -- rather than something to police. pg_trigger_depth tells them apart, same test the
  -- KPI self-write guard uses.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  v_role := get_user_role(v_uid);
  SELECT id INTO v_emp FROM employees WHERE user_id = v_uid LIMIT 1;

  -- HR's signature.
  IF OLD.status = 'pending_hr' AND NEW.status = 'pending_owner' THEN
    IF v_role IN ('hr_manager', 'super_admin') THEN
      NEW.hr_approved_by := v_emp; NEW.hr_approved_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only HR or the owner can give the second approval to a scorecard exception';
  END IF;

  -- Activating it. Owner only, with the same shortcut from pending_hr that the template
  -- chain and validate_leave_transition both allow, because in a small company the owner
  -- is also the HR manager.
  IF NEW.status = 'active' AND OLD.status IN ('pending_hr', 'pending_owner') THEN
    IF v_role <> 'super_admin' THEN
      RAISE EXCEPTION 'Only the owner can approve a scorecard that departs from the agreed standard';
    END IF;

    -- Hole 2. Checked here rather than on the override itself, because a manager
    -- rebalancing three lines passes through invalid totals on the way to a valid one,
    -- and refusing the first edit would make the screen unusable. The gate is activation.
    v_total := public.employee_scorecard_weight_total(NEW.id);
    IF v_total <> 100 THEN
      RAISE EXCEPTION 'This scorecard''s weights add up to %, not 100%%. Fix the weights before approving it.',
        v_total || '%' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.hr_approved_by IS NULL THEN
      NEW.hr_approved_by := v_emp; NEW.hr_approved_at := now();
    END IF;
    NEW.owner_approved_by := v_emp; NEW.owner_approved_at := now();
    RETURN NEW;
  END IF;

  IF NEW.status = 'archived' THEN
    IF v_role IN ('hr_manager', 'super_admin') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Only HR or the owner can archive a scorecard';
  END IF;

  RAISE EXCEPTION 'Invalid scorecard status change: % → %', OLD.status, NEW.status;
END;
$function$;

CREATE TRIGGER aa_employee_scorecard_transition
  BEFORE UPDATE ON public.employee_scorecards
  FOR EACH ROW EXECUTE FUNCTION public.validate_employee_scorecard_transition();

-- ── And the same gate where reviews are opened ─────────────────────────────
-- kpi_generate_review_lines already refuses an employee with no active scorecard. It did
-- not check the arithmetic, so a scorecard that reached 'active' before this migration —
-- or through some path nobody has thought of — could still seed a review whose weights
-- total 80. Belt and braces, on the one function that turns a scorecard into a score.
CREATE OR REPLACE FUNCTION public.kpi_generate_review_lines(p_review_id uuid)
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

-- Findings 4 and 5 from the same testing round are deliberately NOT here, because both
-- are product decisions rather than defects and Raaed has not made them yet:
--
--   4  The self-write guard PINS a forbidden column back rather than raising. An employee
--      setting manager_level gets success and no effect. Consistent with migration 26's
--      handling of kpi_scores, but a client could believe it saved.
--
--   5  A department_manager can rate anyone in the company, not only their own
--      department. validate_leave_transition restricts by department; this does not.
--      Some companies want cross-functional review, so it is a choice, not a bug.
