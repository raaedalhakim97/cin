-- The custom KPI system, part 2 of 3: which criteria apply to whom, at what weight, and
-- who has to sign it off.
--
-- ── Why templates rather than per-employee weights ─────────────────────────
--
-- Raaed asked for weights and comments to be approved by owner, HR manager and manager.
-- Applied to every employee's weights that is 40 people x 6 criteria = 240 approvals a
-- quarter, and the feature would be abandoned inside a month.
--
-- So the unit of approval is the TEMPLATE — a scorecard for a role or a department.
-- Approve six of those and every assignment that follows is already approved. Only a
-- DEPARTURE from the template needs signing off again, which is exactly where the risk
-- lives: a manager quietly re-weighting one person is the thing approval exists to catch.
-- The rule ends up being "follow the standard freely, deviating needs sign-off".
--
-- ── The chain ──────────────────────────────────────────────────────────────
--
--   draft → pending_hr → pending_owner → approved
--
-- with the same escape hatch validate_leave_transition already uses: a super_admin may
-- approve straight from pending_hr. In a two-person company the owner is also the HR
-- manager, and a chain that forces one person to approve twice is theatre, not control.

-- ── 1. Templates ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_templates (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'draft',
  proposed_by       uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  proposed_at       timestamptz,
  hr_approved_by    uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  hr_approved_at    timestamptz,
  owner_approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  owner_approved_at timestamptz,
  rejected_reason   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_templates_status CHECK (status IN
    ('draft', 'pending_hr', 'pending_owner', 'approved', 'archived')),
  CONSTRAINT kpi_templates_name CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS public.kpi_template_lines (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id   uuid NOT NULL REFERENCES public.kpi_templates(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE RESTRICT,
  weight        numeric(5,2) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, definition_id),
  CONSTRAINT kpi_template_lines_weight CHECK (weight > 0 AND weight <= 100)
);

-- ── 2. Assignment ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_scorecards (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  template_id    uuid NOT NULL REFERENCES public.kpi_templates(id) ON DELETE RESTRICT,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  -- True once any weight departs from the template. An exception has to be approved on
  -- its own; a faithful copy inherits the template's approval.
  is_exception   boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'active',
  assigned_by       uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  hr_approved_by    uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  hr_approved_at    timestamptz,
  owner_approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  owner_approved_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_scorecards_status CHECK (status IN
    ('active', 'pending_hr', 'pending_owner', 'archived')),
  CONSTRAINT employee_scorecards_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Only the weights that differ. No row means "the template's weight", so a template
-- change flows through to everyone who did not deviate — which is the point of having one.
CREATE TABLE IF NOT EXISTS public.employee_scorecard_overrides (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  scorecard_id  uuid NOT NULL REFERENCES public.employee_scorecards(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE RESTRICT,
  weight        numeric(5,2) NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scorecard_id, definition_id),
  CONSTRAINT employee_scorecard_overrides_weight CHECK (weight > 0 AND weight <= 100)
);

-- ── 3. The effective weights ───────────────────────────────────────────────
-- One place that answers "what is this person actually measured on". Everything else —
-- the review screen, the scoring, the recommendations — reads this rather than working
-- out the template-plus-override arithmetic again and getting it subtly different.
CREATE OR REPLACE FUNCTION public.employee_scorecard_weights(p_scorecard_id uuid)
RETURNS TABLE (definition_id uuid, weight numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT tl.definition_id,
         COALESCE(ov.weight, tl.weight) AS weight
    FROM employee_scorecards sc
    JOIN kpi_template_lines tl ON tl.template_id = sc.template_id
    LEFT JOIN employee_scorecard_overrides ov
           ON ov.scorecard_id = sc.id AND ov.definition_id = tl.definition_id
   WHERE sc.id = p_scorecard_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.employee_scorecard_weights(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.employee_scorecard_weights(uuid) TO authenticated;

-- ── 4. Approved means frozen ───────────────────────────────────────────────
-- Without this, approval is decoration: HR signs off a template in April and a manager
-- edits the weights in May. To change an approved template, reopen it to draft — which
-- sends it back through the chain — or clone it.
CREATE OR REPLACE FUNCTION public.kpi_template_lines_locked_when_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM kpi_templates
   WHERE id = COALESCE(NEW.template_id, OLD.template_id);

  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'This scorecard has been approved and its weights are fixed. Reopen it as a draft to change them, or create a new version.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE TRIGGER kpi_template_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON public.kpi_template_lines
  FOR EACH ROW EXECUTE FUNCTION public.kpi_template_lines_locked_when_approved();

-- ── 5. The chain ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_kpi_template_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_role text;
  v_emp  uuid;
  v_total numeric;
BEGIN
  -- Maintenance and trigger-originated writes pass through, same convention as the
  -- attendance and leave guards.
  IF v_uid IS NULL OR NEW.status = OLD.status THEN RETURN NEW; END IF;

  v_role := get_user_role(v_uid);
  SELECT id INTO v_emp FROM employees WHERE user_id = v_uid LIMIT 1;

  -- Sending it back for changes. Anyone in the chain may do this, and it clears the
  -- signatures — a template that was approved and then reopened is not approved.
  IF NEW.status = 'draft' THEN
    IF v_role IN ('department_manager', 'hr_manager', 'super_admin') THEN
      NEW.hr_approved_by := NULL;    NEW.hr_approved_at := NULL;
      NEW.owner_approved_by := NULL; NEW.owner_approved_at := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only a manager, HR or the owner can reopen a scorecard';
  END IF;

  -- Submit for approval. Weights must total 100 before anyone is asked to sign: sending
  -- an arithmetically broken scorecard up the chain wastes two people's attention.
  IF OLD.status = 'draft' AND NEW.status = 'pending_hr' THEN
    IF v_role NOT IN ('department_manager', 'hr_manager', 'super_admin') THEN
      RAISE EXCEPTION 'Only a manager, HR or the owner can submit a scorecard for approval';
    END IF;
    SELECT COALESCE(sum(weight), 0) INTO v_total FROM kpi_template_lines WHERE template_id = NEW.id;
    IF v_total <> 100 THEN
      -- v_total carries its own '%' because plpgsql cannot write a placeholder
      -- immediately followed by a literal percent: '%%%' reads as literal-then-placeholder.
      RAISE EXCEPTION 'Weights must add up to 100%%. This scorecard totals %.', v_total || '%'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.proposed_by := v_emp;
    NEW.proposed_at := now();
    RETURN NEW;
  END IF;

  -- HR's signature.
  IF OLD.status = 'pending_hr' AND NEW.status = 'pending_owner' THEN
    IF v_role IN ('hr_manager', 'super_admin') THEN
      NEW.hr_approved_by := v_emp; NEW.hr_approved_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only HR or the owner can give the second approval';
  END IF;

  -- The owner's signature, and the small-company shortcut. Straight from pending_hr is
  -- allowed because in a two-person company the owner IS the HR manager, and making one
  -- person click approve twice is theatre rather than control. Same escape hatch as
  -- validate_leave_transition.
  IF NEW.status = 'approved' AND OLD.status IN ('pending_hr', 'pending_owner') THEN
    IF v_role = 'super_admin' THEN
      IF NEW.hr_approved_by IS NULL THEN
        NEW.hr_approved_by := v_emp; NEW.hr_approved_at := now();
      END IF;
      NEW.owner_approved_by := v_emp; NEW.owner_approved_at := now();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only the owner can give final approval to a scorecard';
  END IF;

  IF NEW.status = 'archived' THEN
    IF v_role IN ('hr_manager', 'super_admin') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Only HR or the owner can archive a scorecard';
  END IF;

  RAISE EXCEPTION 'Invalid scorecard status change: % → %', OLD.status, NEW.status;
END;
$function$;

CREATE TRIGGER aa_kpi_template_transition
  BEFORE UPDATE ON public.kpi_templates
  FOR EACH ROW EXECUTE FUNCTION public.validate_kpi_template_transition();

-- ── 6. An assignment cannot outrun its template ────────────────────────────
-- Assigning an unapproved template would route around the whole chain.
CREATE OR REPLACE FUNCTION public.employee_scorecard_needs_approved_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM kpi_templates WHERE id = NEW.template_id;
  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'That scorecard has not been approved yet, so it cannot be assigned to anyone.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER aa_employee_scorecard_template_approved
  BEFORE INSERT OR UPDATE OF template_id ON public.employee_scorecards
  FOR EACH ROW EXECUTE FUNCTION public.employee_scorecard_needs_approved_template();

-- An override is a departure from the approved standard, so it flips the scorecard into
-- exception and sends it for its own sign-off. Set by the database rather than trusted
-- from the client: the flag is the only thing making exceptions visible.
CREATE OR REPLACE FUNCTION public.employee_scorecard_override_is_an_exception()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE employee_scorecards
     SET is_exception = true,
         status = CASE WHEN status = 'active' THEN 'pending_hr' ELSE status END,
         hr_approved_by = NULL, hr_approved_at = NULL,
         owner_approved_by = NULL, owner_approved_at = NULL
   WHERE id = COALESCE(NEW.scorecard_id, OLD.scorecard_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE TRIGGER employee_scorecard_override_flags_exception
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_scorecard_overrides
  FOR EACH ROW EXECUTE FUNCTION public.employee_scorecard_override_is_an_exception();

-- ── Timestamps and indexes ─────────────────────────────────────────────────
CREATE TRIGGER kpi_templates_updated_at BEFORE UPDATE ON public.kpi_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER employee_scorecards_updated_at BEFORE UPDATE ON public.employee_scorecards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX IF NOT EXISTS idx_kpi_templates_company_id                ON public.kpi_templates (company_id);
CREATE INDEX IF NOT EXISTS idx_kpi_templates_proposed_by               ON public.kpi_templates (proposed_by);
CREATE INDEX IF NOT EXISTS idx_kpi_templates_hr_approved_by            ON public.kpi_templates (hr_approved_by);
CREATE INDEX IF NOT EXISTS idx_kpi_templates_owner_approved_by         ON public.kpi_templates (owner_approved_by);
CREATE INDEX IF NOT EXISTS idx_kpi_template_lines_template_id          ON public.kpi_template_lines (template_id);
CREATE INDEX IF NOT EXISTS idx_kpi_template_lines_definition_id        ON public.kpi_template_lines (definition_id);
CREATE INDEX IF NOT EXISTS idx_employee_scorecards_company_id          ON public.employee_scorecards (company_id);
CREATE INDEX IF NOT EXISTS idx_employee_scorecards_employee_id         ON public.employee_scorecards (employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_scorecards_template_id         ON public.employee_scorecards (template_id);
CREATE INDEX IF NOT EXISTS idx_employee_scorecards_assigned_by         ON public.employee_scorecards (assigned_by);
CREATE INDEX IF NOT EXISTS idx_employee_scorecards_hr_approved_by      ON public.employee_scorecards (hr_approved_by);
CREATE INDEX IF NOT EXISTS idx_employee_scorecards_owner_approved_by   ON public.employee_scorecards (owner_approved_by);
CREATE INDEX IF NOT EXISTS idx_employee_scorecard_overrides_scorecard_id  ON public.employee_scorecard_overrides (scorecard_id);
CREATE INDEX IF NOT EXISTS idx_employee_scorecard_overrides_definition_id ON public.employee_scorecard_overrides (definition_id);

-- ── Access ─────────────────────────────────────────────────────────────────
ALTER TABLE public.kpi_templates                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_template_lines            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_scorecards           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_scorecard_overrides  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.kpi_templates, public.kpi_template_lines,
              public.employee_scorecards, public.employee_scorecard_overrides FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
   ON public.kpi_templates, public.kpi_template_lines,
      public.employee_scorecards, public.employee_scorecard_overrides TO authenticated;

-- Templates are readable company-wide. An employee is entitled to know the standard they
-- are held to, and the whole design rests on them seeing it before the period rather than
-- at review time.
CREATE POLICY kpi_templates_read ON public.kpi_templates
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid())));

CREATE POLICY kpi_templates_write ON public.kpi_templates
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'department_manager'))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'department_manager'));

CREATE POLICY kpi_template_lines_read ON public.kpi_template_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM kpi_templates t WHERE t.id = template_id
                  AND t.company_id = get_user_company_id((SELECT auth.uid()))));

CREATE POLICY kpi_template_lines_write ON public.kpi_template_lines
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM kpi_templates t WHERE t.id = template_id
                  AND t.company_id = get_user_company_id((SELECT auth.uid()))
                  AND get_user_role((SELECT auth.uid())) IN ('super_admin','hr_manager','department_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM kpi_templates t WHERE t.id = template_id
                       AND t.company_id = get_user_company_id((SELECT auth.uid()))
                       AND get_user_role((SELECT auth.uid())) IN ('super_admin','hr_manager','department_manager')));

-- Your own scorecard, or your team's, or everyone's if you are HR. An employee seeing
-- their own weights is not a nice-to-have — it is the fairness property the whole design
-- depends on.
CREATE POLICY employee_scorecards_read ON public.employee_scorecards
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND (
           get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'department_manager')
           OR employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid()))
         ));

CREATE POLICY employee_scorecards_write ON public.employee_scorecards
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'department_manager'))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager', 'department_manager'));

CREATE POLICY employee_scorecard_overrides_read ON public.employee_scorecard_overrides
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM employee_scorecards sc WHERE sc.id = scorecard_id
                  AND sc.company_id = get_user_company_id((SELECT auth.uid()))
                  AND (get_user_role((SELECT auth.uid())) IN ('super_admin','hr_manager','department_manager')
                       OR sc.employee_id = (SELECT e.id FROM employees e WHERE e.user_id = (SELECT auth.uid())))));

CREATE POLICY employee_scorecard_overrides_write ON public.employee_scorecard_overrides
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employee_scorecards sc WHERE sc.id = scorecard_id
                  AND sc.company_id = get_user_company_id((SELECT auth.uid()))
                  AND get_user_role((SELECT auth.uid())) IN ('super_admin','hr_manager','department_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM employee_scorecards sc WHERE sc.id = scorecard_id
                       AND sc.company_id = get_user_company_id((SELECT auth.uid()))
                       AND get_user_role((SELECT auth.uid())) IN ('super_admin','hr_manager','department_manager')));
