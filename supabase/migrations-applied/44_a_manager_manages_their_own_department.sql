-- Finding 5 from the last testing round, now decided: a department_manager is responsible
-- for their own department and nobody else.
--
-- Raaed: "Manager only responsible on their department, it's like employee reporting to
-- department manager. Employee Khalid is reporting to manager Aisha as example. HR the
-- whole company, report to CEO."
--
-- So the chain is:
--
--   employee            → their department manager
--   department manager  → HR
--   HR                  → the owner/CEO
--
-- Until now every KPI table said `role IN ('super_admin','hr_manager','department_manager')`
-- and stopped there. Measured before this migration: the Sales manager could open the
-- Operations employees' scorecards, override their weights, and write their manager
-- ratings. kpi_reviews was the one table that already had the department clause (from
-- migration 42's leave-shaped work); everything the custom KPI system added since did not.
--
-- ── The self problem ───────────────────────────────────────────────────────
--
-- "Own department" on its own hands a manager their own review, because a manager belongs
-- to the department they run. Scoring yourself is the one thing this whole design exists
-- to prevent, so the predicate excludes self — which puts a manager's own review in HR's
-- hands and HR's in the owner's, exactly the chain above.
--
-- The owner is the exception, and deliberately: nobody sits above them. If a super_admin
-- has a review, blocking them from it would mean it can never be completed by anyone.

-- ── The one predicate everything else asks ─────────────────────────────────
-- SECURITY DEFINER so it can read employees without tripping that table's own RLS, and so
-- an RLS policy calling it cannot recurse.
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
              AND target.department_id IS NOT NULL
              AND (
                    -- Their own department...
                    target.department_id = me.department_id
                    -- ...or one they are named the manager of. departments.manager_id is
                    -- NULL on all ten departments in production today, so this branch is
                    -- inert until somebody fills it; it is here because a manager who runs
                    -- a department without being filed under it is a real arrangement and
                    -- the column already exists to say so.
                 OR EXISTS (SELECT 1 FROM departments d
                             WHERE d.id = target.department_id
                               AND d.manager_id = me.id)
                  )
             ELSE false
           END
  );
$function$;

COMMENT ON FUNCTION public.kpi_manages_employee(uuid) IS
  'Who may rate, weight and assign a scorecard for this employee. Owner: anyone. HR: anyone but themselves. Department manager: their own department, not themselves. Everyone else: nobody.';

REVOKE EXECUTE ON FUNCTION public.kpi_manages_employee(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_manages_employee(uuid) TO authenticated;

-- ── 1. Assignment and weights ──────────────────────────────────────────────
DROP POLICY IF EXISTS employee_scorecards_read  ON public.employee_scorecards;
DROP POLICY IF EXISTS employee_scorecards_write ON public.employee_scorecards;

-- Read is deliberately wider than write: the employee themselves, plus anyone who manages
-- them. A manager reading their own scorecard is how they see the standard they are held
-- to, and kpi_manages_employee says no to that — so it is ORed with "it is mine".
CREATE POLICY employee_scorecards_read ON public.employee_scorecards
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND (
           employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid()))
           OR public.kpi_manages_employee(employee_id)
         ));

CREATE POLICY employee_scorecards_write ON public.employee_scorecards
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND public.kpi_manages_employee(employee_id))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND public.kpi_manages_employee(employee_id));

DROP POLICY IF EXISTS employee_scorecard_overrides_read  ON public.employee_scorecard_overrides;
DROP POLICY IF EXISTS employee_scorecard_overrides_write ON public.employee_scorecard_overrides;

CREATE POLICY employee_scorecard_overrides_read ON public.employee_scorecard_overrides
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM employee_scorecards sc
                  WHERE sc.id = scorecard_id
                    AND sc.company_id = get_user_company_id((SELECT auth.uid()))
                    AND (sc.employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid()))
                         OR public.kpi_manages_employee(sc.employee_id))));

CREATE POLICY employee_scorecard_overrides_write ON public.employee_scorecard_overrides
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employee_scorecards sc
                  WHERE sc.id = scorecard_id
                    AND sc.company_id = get_user_company_id((SELECT auth.uid()))
                    AND public.kpi_manages_employee(sc.employee_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM employee_scorecards sc
                       WHERE sc.id = scorecard_id
                         AND sc.company_id = get_user_company_id((SELECT auth.uid()))
                         AND public.kpi_manages_employee(sc.employee_id)));

-- ── 2. The review lines ────────────────────────────────────────────────────
-- kpi_reviews_select already restricts a department_manager to their department, and this
-- policy's EXISTS on kpi_reviews inherits that. Inheriting a rule is not the same as
-- stating it: the role list here reads as company-wide, and the next person to touch
-- either policy has no way to know one was holding the other up. State it.
DROP POLICY IF EXISTS kpi_review_lines_read  ON public.kpi_review_lines;
DROP POLICY IF EXISTS kpi_review_lines_write ON public.kpi_review_lines;

CREATE POLICY kpi_review_lines_read ON public.kpi_review_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM kpi_reviews r
     WHERE r.id = review_id
       AND r.company_id = get_user_company_id((SELECT auth.uid()))
       AND (r.employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid()))
            OR public.kpi_manages_employee(r.employee_id))));

CREATE POLICY kpi_review_lines_write ON public.kpi_review_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM kpi_reviews r
     WHERE r.id = review_id
       AND r.company_id = get_user_company_id((SELECT auth.uid()))
       AND (r.employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid()))
            OR public.kpi_manages_employee(r.employee_id))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM kpi_reviews r
     WHERE r.id = review_id
       AND r.company_id = get_user_company_id((SELECT auth.uid()))
       AND (r.employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid()))
            OR public.kpi_manages_employee(r.employee_id))));

-- ── 3. The column guard ────────────────────────────────────────────────────
-- Previously: role IN ('super_admin','hr_manager','department_manager') → write anything.
-- That exemption is what let a Sales manager write manager_level on an Operations
-- employee's line, and what let anyone in those three roles write their own manager_level.
--
-- Now the question is not "what is your role" but "do you manage this person". Whoever
-- does may write the manager columns. Everyone else falls to the self path, which pins
-- every non-self column back to what was already there — including a manager on their own
-- review, who is now an ordinary self-rater like everybody else.
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
  -- The schema computing, not a client writing. pg_trigger_depth distinguishes them.
  IF v_uid IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

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

  -- Pin everything except the three self columns to what was already there.
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

-- ── 4. Templates ───────────────────────────────────────────────────────────
-- A template is a company-wide standard, not a per-employee row, so the department
-- predicate does not apply to it. What does apply: a manager may work on drafts, and once
-- something has gone up the chain it stops being theirs to edit. kpi_template_lines_locked
-- already froze the lines at 'approved'; this closes the two states in between, where a
-- manager could still rename a template HR was in the middle of reviewing, and stops them
-- editing an approved one's name and description.
DROP POLICY IF EXISTS kpi_templates_write      ON public.kpi_templates;
DROP POLICY IF EXISTS kpi_template_lines_write ON public.kpi_template_lines;

CREATE POLICY kpi_templates_write ON public.kpi_templates
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND (get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
              OR (get_user_role((SELECT auth.uid())) = 'department_manager'
                  AND status = 'draft')))
  -- WITH CHECK reads NEW, so a manager submitting a draft for approval would fail it: the
  -- new status is pending_hr, which is not 'draft'. Submitting is the one transition they
  -- are supposed to make, and validate_kpi_template_transition already polices which
  -- transitions are legal and by whom. So the check is on the role only.
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) IN
                  ('super_admin', 'hr_manager', 'department_manager'));

CREATE POLICY kpi_template_lines_write ON public.kpi_template_lines
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM kpi_templates t
                  WHERE t.id = template_id
                    AND t.company_id = get_user_company_id((SELECT auth.uid()))
                    AND (get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
                         OR (get_user_role((SELECT auth.uid())) = 'department_manager'
                             AND t.status = 'draft'))))
  WITH CHECK (EXISTS (SELECT 1 FROM kpi_templates t
                       WHERE t.id = template_id
                         AND t.company_id = get_user_company_id((SELECT auth.uid()))
                         AND (get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')
                              OR (get_user_role((SELECT auth.uid())) = 'department_manager'
                                  AND t.status = 'draft'))));
