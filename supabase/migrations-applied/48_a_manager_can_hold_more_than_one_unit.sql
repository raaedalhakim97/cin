-- Two decisions from Raaed, and they are related.
--
--   "The employee can't rate the manager."
--
--   "We need to make that the HR manager can give access to the managers by department.
--    Aisha Manager. Khalid (Admin) reports to Aisha (Ganache chocolate). Amir (Sales)
--    reports to Aisha (Carpo chocolate). It's like Aisha is a multi-unit manager, if the
--    HR manager allowed her by adding the employees report to specific manager."
--
-- ── Why the department was not enough ──────────────────────────────────────
--
-- Migration 44 made a department_manager responsible for their own department, which is
-- right for a company with one site. It cannot express Aisha: she runs two units, and the
-- people in them sit in different departments — Khalid in Admin, Amir in Sales. Under
-- migration 44 she reaches whichever department she is filed under and neither of her
-- actual teams.
--
-- So reporting becomes something HR states, not something the org chart implies:
--
--   employees.reports_to   the manager this person answers to, set by HR or the owner
--
-- and the rule is EXPLICIT BEATS IMPLICIT. Nobody named a manager → their department's
-- manager has them, exactly as before. Somebody named → only that manager, and the
-- department manager they used to belong to loses them. That last half matters: a rule
-- where naming a manager ADDS a rater and keeps the old one would mean HR could never move
-- anybody, only widen access.
--
-- Only HR and the owner can set it, and that needs no new enforcement — emp_update has been
-- restricted to those two roles since the table was built, so the column inherits it.
--
-- The named manager still has to hold the department_manager role for it to mean anything,
-- because the predicate below asks the CALLER's role first. Pointing reports_to at somebody
-- whose role is 'employee' grants them nothing. The People screen says so where HR sets it,
-- rather than leaving them to find out by an absence.

-- ── Who am I, as an employee ───────────────────────────────────────────────
-- Every policy in the schema has been inlining (SELECT e.id FROM employees e WHERE
-- e.user_id = auth.uid()). This is that, once, and SECURITY DEFINER so a policy on
-- employees can call it without recursing into employees' own RLS.
CREATE OR REPLACE FUNCTION public.get_user_employee_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id FROM employees WHERE user_id = p_user_id LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_employee_id(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_employee_id(uuid) TO authenticated;

-- ── The column ─────────────────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS reports_to uuid REFERENCES public.employees(id) ON DELETE SET NULL;

-- ON DELETE SET NULL rather than RESTRICT: when a manager leaves, their reports fall back
-- to the department rule instead of the company being unable to delete the row.

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_reports_to_not_self;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_reports_to_not_self CHECK (reports_to IS NULL OR reports_to <> id);

CREATE INDEX IF NOT EXISTS idx_employees_reports_to ON public.employees (reports_to);

COMMENT ON COLUMN public.employees.reports_to IS
  'The manager this person answers to for performance, set by HR or the owner. NULL means the department manager has them. Overrides the department entirely — see kpi_manages_employee.';

-- Same company, and no loops. A loop would let two people rate each other, and since only
-- HR can set the column it would be HR's mistake rather than an attack — which is exactly
-- the kind of mistake worth catching at the point it is made.
CREATE OR REPLACE FUNCTION public.employee_reports_to_is_sane()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mgr_company uuid;
  v_cursor uuid;
  v_hops   integer := 0;
BEGIN
  IF NEW.reports_to IS NULL THEN RETURN NEW; END IF;

  -- Its own message. The loop walk below would catch this too, and would explain it as
  -- "two people report to each other", which is not what happened.
  IF NEW.reports_to = NEW.id THEN
    RAISE EXCEPTION 'Somebody cannot report to themselves.' USING ERRCODE = 'P0001';
  END IF;

  SELECT company_id INTO v_mgr_company FROM employees WHERE id = NEW.reports_to;
  IF v_mgr_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'A manager has to be in the same company.' USING ERRCODE = 'P0001';
  END IF;

  -- Walk up from the proposed manager. Arriving back at this row is a loop. The hop limit
  -- is a safety net for a loop that already exists further up the chain.
  v_cursor := NEW.reports_to;
  WHILE v_cursor IS NOT NULL AND v_hops < 20 LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'That would make two people report to each other.' USING ERRCODE = 'P0001';
    END IF;
    SELECT reports_to INTO v_cursor FROM employees WHERE id = v_cursor;
    v_hops := v_hops + 1;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aa_employee_reports_to_sane ON public.employees;
CREATE TRIGGER aa_employee_reports_to_sane
  BEFORE INSERT OR UPDATE OF reports_to, company_id ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.employee_reports_to_is_sane();

-- ── Explicit beats implicit ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kpi_manages_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM employees target
      LEFT JOIN employees me ON me.user_id = (SELECT auth.uid())
     WHERE target.id = p_employee_id
       AND target.company_id = get_user_company_id((SELECT auth.uid()))
       AND CASE get_user_role((SELECT auth.uid()))
             -- The owner answers to nobody, including on their own review.
             WHEN 'super_admin' THEN true
             -- HR covers the whole company but not themselves; the owner does theirs.
             WHEN 'hr_manager'  THEN target.id IS DISTINCT FROM me.id
             WHEN 'department_manager' THEN
                  target.id IS DISTINCT FROM me.id
              AND CASE
                    -- HR has named this person's manager. Only they have them — which is
                    -- what lets one manager hold people across several departments, and
                    -- what stops the department manager they used to sit under keeping
                    -- them by accident.
                    WHEN target.reports_to IS NOT NULL THEN target.reports_to = me.id
                    -- Nobody named: the department rule from migration 44.
                    ELSE target.department_id IS NOT NULL
                     AND (
                           target.department_id = me.department_id
                        OR EXISTS (SELECT 1 FROM departments d
                                    WHERE d.id = target.department_id
                                      AND d.manager_id = me.id)
                         )
                  END
             ELSE false
           END
  );
$function$;

COMMENT ON FUNCTION public.kpi_manages_employee(uuid) IS
  'Who may rate, weight and assign a scorecard for this employee. Owner: anyone. HR: anyone but themselves. Department manager: whoever HR named them for, else their own department — never themselves. Everyone else: nobody.';

-- ── A named manager can see their people ───────────────────────────────────
-- Without this the rule would be half-built: Aisha could rate Amir and could not read his
-- name. emp_select has restricted a department_manager to their own department since
-- migration 42; this adds the one clause and changes nothing else.
DROP POLICY IF EXISTS emp_select ON public.employees;
CREATE POLICY emp_select ON public.employees
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'admin', 'read_only')
      OR user_id = (SELECT auth.uid())
      OR (get_user_role((SELECT auth.uid())) = 'department_manager'
          AND (
            department_id = get_user_department_id((SELECT auth.uid()))
            OR reports_to  = get_user_employee_id((SELECT auth.uid()))
          ))
    )
  );

-- ── "The employee can't rate the manager", said out loud ───────────────────
-- Until now the guard PINNED a forbidden column back to its old value: the write returned
-- success and did nothing. That is safe and it lies to the person — the screen says
-- "Saved" and the rating is not there. Raaed's answer settles it: refuse, and say why.
--
-- The refusal is on CHANGE, not on presence. A client that echoes a whole row back with
-- manager_level unchanged is not attempting anything, and failing that write would break
-- every ordinary save. Only a value that actually differs is an attempt.
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

  IF NEW.manager_level       IS DISTINCT FROM OLD.manager_level
     OR NEW.manager_anchor_id   IS DISTINCT FROM OLD.manager_anchor_id
     OR NEW.manager_anchor_text IS DISTINCT FROM OLD.manager_anchor_text
     OR NEW.manager_note        IS DISTINCT FROM OLD.manager_note THEN
    RAISE EXCEPTION 'Only your manager can write the manager rating. You can fill in your own side of this review.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.weight IS DISTINCT FROM OLD.weight
     OR NEW.definition_id   IS DISTINCT FROM OLD.definition_id
     OR NEW.definition_name IS DISTINCT FROM OLD.definition_name
     OR NEW.source          IS DISTINCT FROM OLD.source
     OR NEW.auto_value      IS DISTINCT FROM OLD.auto_value
     OR NEW.final_level     IS DISTINCT FROM OLD.final_level THEN
    RAISE EXCEPTION 'The criteria and their weights were fixed when this review opened and are not editable here.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- The same answer on the monthly system, which still holds 129 rows of real history. Only
-- the UPDATE path changes. The INSERT path keeps nulling the columns instead of refusing,
-- because creating your own row IS how a self-evaluation starts and a client sending the
-- full shape with nulls is doing nothing wrong.
CREATE OR REPLACE FUNCTION public.kpi_self_write_is_self_score_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_role    text;
  v_is_self boolean;
BEGIN
  IF v_uid IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  v_role := get_user_role(v_uid);

  -- HR and the owner administer scores as their job, and every write they make is audited.
  -- A department_manager is deliberately NOT exempt: managing a team does not include
  -- scoring yourself.
  IF v_role IN ('super_admin', 'hr_manager') THEN
    RETURN NEW;
  END IF;

  v_is_self := EXISTS (
    SELECT 1 FROM employees WHERE id = NEW.employee_id AND user_id = v_uid
  );

  IF NOT v_is_self THEN
    RETURN NEW;   -- someone else's row: RLS already decides whether this is allowed
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.attendance_score  := NULL;
    NEW.reliability_score := NULL;
    NEW.behavior_score    := NULL;
    NEW.achievement_score := NULL;
    NEW.manager_score     := NULL;
    NEW.adjustment_points := 0;
    NEW.evaluated_by      := NULL;
    RETURN NEW;
  END IF;

  IF NEW.manager_score     IS DISTINCT FROM OLD.manager_score
     OR NEW.attendance_score  IS DISTINCT FROM OLD.attendance_score
     OR NEW.reliability_score IS DISTINCT FROM OLD.reliability_score
     OR NEW.behavior_score    IS DISTINCT FROM OLD.behavior_score
     OR NEW.achievement_score IS DISTINCT FROM OLD.achievement_score
     OR NEW.adjustment_points IS DISTINCT FROM OLD.adjustment_points
     OR NEW.evaluated_by      IS DISTINCT FROM OLD.evaluated_by THEN
    RAISE EXCEPTION 'Only your manager or HR can write those scores. You can change your own self-evaluation.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.employee_id  IS DISTINCT FROM OLD.employee_id
     OR NEW.company_id   IS DISTINCT FROM OLD.company_id
     OR NEW.period_year  IS DISTINCT FROM OLD.period_year
     OR NEW.period_month IS DISTINCT FROM OLD.period_month THEN
    RAISE EXCEPTION 'A self-evaluation cannot be moved to another person or another month.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Deliberately NOT changed ───────────────────────────────────────────────
-- Leave approval, attendance and everything else a department_manager touches still follow
-- the department, not reports_to. Extending them would quietly change who can approve paid
-- time off, which has consequences beyond performance and is Raaed's call to make
-- separately rather than a side effect of this migration.
