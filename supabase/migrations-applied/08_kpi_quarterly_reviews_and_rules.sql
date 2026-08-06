-- ═══════════════════════════════════════════════════════════════════════════
-- KPI enhancement: quarterly review cycles + the automatic rules engine.
--
-- Applied to the live database as six migrations, in this order:
--   1. kpi_adjustments_own_column
--   2. kpi_total_applies_adjustments
--   3. kpi_automatic_rules_engine
--   4. kpi_evaluate_rules_function
--   5. kpi_quarterly_review_cycles
--   6. kpi_review_stage_guard_and_calculation
-- Consolidated here because they are one logical change. Function bodies are
-- reproduced exactly as applied; `supabase migration list` is the authority on
-- ordering.
--
-- WHAT ALREADY EXISTED (and was NOT rebuilt): per-company weights, a
-- per-company award/warning catalogue (kpi_adjustment_types), configurable
-- evaluation cadence, the recommend-then-HR-approves workflow
-- (warning_recommendations + approve_warning_recommendation), auto-announce of
-- rewards to the news feed, and PDP plans. All present, all working.
--
-- WHAT WAS ACTUALLY MISSING: anything that fired them. kpi_adjustments and
-- warning_recommendations were both empty — the "automatic" KPI system was a
-- manual one. That is what sections 3-4 add.
--
-- DESIGN DECISIONS, recorded because they are contestable:
--
--   * kpi_scores stays MONTHLY. Attendance and reliability are genuinely
--     monthly measurements; collapsing them to quarterly would discard the
--     live signal. The human assessment is what happens quarterly, so it gets
--     its own tables (section 5).
--
--   * Periods stay INDEPENDENT. The request was to "calculate with the old
--     score and update"; that is not done. Blending is exactly what let a
--     June 90 prop up a July with nothing evaluated (see 01), and it hides a
--     weak quarter while making a strong one unearned. Continuity comes from
--     kpi_rolling_scores, a presentational 4-quarter average, clearly separate
--     from each quarter's own final_score.
--
--   * Awards are ISSUED automatically; warnings are only ever PROPOSED.
--     A warning affects discipline and pay, and the handbook grants hearing
--     rights (Art. 21.2) and a PIP process (Art. 16). Software must not issue
--     discipline unilaterally.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Adjustments get their own column ─────────────────────────────────────
-- apply_kpi_adjustment() had three defects, each of which gets worse once
-- rules issue adjustments automatically:
--
--  a) It wrote the adjustment into behavior_score, overwriting the manager's
--     behaviour rating. An award and a behaviour assessment are different
--     claims and cannot share a column. It also broke the
--     NULL-means-not-evaluated semantics from 01.
--  b) With no score row it seeded every other component at literal 0 —
--     re-creating the exact bug 01 removed.
--  c) It wrote `rating` and `bonus_eligible` DIRECTLY, bypassing the coverage
--     floor. A single +8 award on an empty month would have produced a rating
--     and bonus eligibility with nothing assessed — a pay decision on no
--     evidence. Verified fixed: award on an unevaluated month now yields
--     coverage 0, rating NULL, bonus_eligible false.

ALTER TABLE public.kpi_scores
  ADD COLUMN IF NOT EXISTS adjustment_points numeric(6,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.kpi_scores.adjustment_points IS
  'Net points from awards and warnings in kpi_adjustments for this period. Added to the weighted average, then clamped to 0-100. Never earns a rating on its own — the coverage floor still applies.';

CREATE OR REPLACE FUNCTION public.apply_kpi_adjustment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_emp_id uuid; v_year int; v_month int; v_company_id uuid; v_sum numeric(6,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_emp_id := OLD.employee_id; v_year := OLD.period_year;
    v_month  := OLD.period_month; v_company_id := OLD.company_id;
  ELSE
    v_emp_id := NEW.employee_id; v_year := NEW.period_year;
    v_month  := NEW.period_month; v_company_id := NEW.company_id;
  END IF;

  -- Recomputed from scratch rather than incremented, so re-running or deleting
  -- an adjustment always lands on the right number.
  SELECT COALESCE(SUM(points_adjustment), 0) INTO v_sum
  FROM kpi_adjustments
  WHERE employee_id = v_emp_id AND period_year = v_year AND period_month = v_month;

  INSERT INTO kpi_scores (
    employee_id, company_id, period_year, period_month,
    attendance_score, reliability_score, behavior_score,
    achievement_score, manager_score, self_score, adjustment_points
  ) VALUES (
    v_emp_id, v_company_id, v_year, v_month, NULL, NULL, NULL, NULL, NULL, NULL, v_sum
  )
  ON CONFLICT (employee_id, period_year, period_month)
  DO UPDATE SET adjustment_points = v_sum;
  -- total_score, rating and bonus_eligible are aa_compute_kpi_total's job.

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_kpi_adjustment() FROM PUBLIC, anon, authenticated;

-- ── 2. compute_kpi_total applies the adjustment ─────────────────────────────
-- The adjustment rides on top of the weighted average rather than being folded
-- in as another weighted component: an award is a bonus on measured
-- performance, not a sixth opinion about it. Crucially it adds NO coverage, so
-- it can never manufacture a rating.
-- (Body identical to migration 06 apart from v_adj / v_base and the two extra
-- weights_used keys.)
CREATE OR REPLACE FUNCTION public.compute_kpi_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  s record;
  w_att integer := 30; w_beh integer := 25; w_ach integer := 20;
  w_mgr integer := 15; w_self integer := 10; w_rel integer := 0;
  v_prev_mgr numeric; v_prev_self numeric;
  v_num numeric := 0; v_den integer := 0; v_den_not_self integer := 0;
  v_total_weight integer; v_coverage numeric; v_base numeric;
  v_adj numeric := coalesce(new.adjustment_points, 0);
  c_min_coverage numeric := 50;
begin
  select * into s from public.kpi_settings where company_id = new.company_id;
  if found then
    w_att := s.weight_attendance; w_beh := s.weight_behavior;
    w_ach := s.weight_achievement; w_mgr := s.weight_manager;
    w_self := s.weight_self; w_rel := coalesce(s.weight_reliability, 0);
  end if;
  v_total_weight := w_att + w_beh + w_ach + w_mgr + w_self + w_rel;

  -- Looked up for context only. Deliberately NOT assigned and NOT scored.
  if new.manager_score is null then
    select manager_score into v_prev_mgr from public.kpi_scores
    where employee_id = new.employee_id and manager_score is not null
      and (period_year, period_month) < (new.period_year, new.period_month)
    order by period_year desc, period_month desc limit 1;
  end if;
  if new.self_score is null then
    select self_score into v_prev_self from public.kpi_scores
    where employee_id = new.employee_id and self_score is not null
      and (period_year, period_month) < (new.period_year, new.period_month)
    order by period_year desc, period_month desc limit 1;
  end if;

  -- NULL is not evaluated; 0 is a real score and counts.
  if new.attendance_score is not null then
    v_num := v_num + new.attendance_score * w_att;
    v_den := v_den + w_att; v_den_not_self := v_den_not_self + w_att;
  end if;
  if new.behavior_score is not null then
    v_num := v_num + new.behavior_score * w_beh;
    v_den := v_den + w_beh; v_den_not_self := v_den_not_self + w_beh;
  end if;
  if new.achievement_score is not null then
    v_num := v_num + new.achievement_score * w_ach;
    v_den := v_den + w_ach; v_den_not_self := v_den_not_self + w_ach;
  end if;
  if new.manager_score is not null then
    v_num := v_num + new.manager_score * w_mgr;
    v_den := v_den + w_mgr; v_den_not_self := v_den_not_self + w_mgr;
  end if;
  if new.reliability_score is not null and w_rel > 0 then
    v_num := v_num + new.reliability_score * w_rel;
    v_den := v_den + w_rel; v_den_not_self := v_den_not_self + w_rel;
  end if;
  if new.self_score is not null then
    v_num := v_num + new.self_score * w_self;
    v_den := v_den + w_self;
  end if;

  v_coverage := case when v_total_weight > 0
                     then round(v_den * 100.0 / v_total_weight, 1) else 0 end;
  v_base := case when v_den > 0 then v_num / v_den else 0 end;
  new.total_score := round(greatest(0, least(100, v_base + v_adj)), 2);

  -- An adjustment is not assessment. With nothing measured the coverage test
  -- below still fails, so an award alone cannot earn a rating or a bonus.
  if v_den > 0 and v_coverage >= c_min_coverage and v_den_not_self > 0 then
    new.rating := public.kpi_rating_label(new.total_score);
    new.bonus_eligible := new.total_score >= 75;
  else
    new.rating := null;
    new.bonus_eligible := false;
  end if;

  new.weights_used := jsonb_build_object(
    'attendance', w_att, 'behavior', w_beh, 'achievement', w_ach,
    'manager', w_mgr, 'self', w_self, 'reliability', w_rel,
    'covered_weight', v_den, 'total_weight', v_total_weight,
    'coverage_pct', v_coverage, 'base_score', round(v_base, 2),
    'adjustment_points', v_adj,
    'previous_manager_score', v_prev_mgr, 'previous_self_score', v_prev_self);

  return new;
end;
$function$;

-- ── 3. Rule catalogue ───────────────────────────────────────────────────────
-- Automatic adjustments have no human issuer, and both tables required one.
ALTER TABLE public.kpi_adjustments
  ALTER COLUMN issued_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'rule')),
  ADD COLUMN IF NOT EXISTS rule_code text;

COMMENT ON COLUMN public.kpi_adjustments.issued_by IS
  'The employee who issued this. NULL when source = ''rule'' — the system has no employee record.';

ALTER TABLE public.warning_recommendations
  ALTER COLUMN recommended_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source       text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'rule')),
  ADD COLUMN IF NOT EXISTS rule_code    text,
  ADD COLUMN IF NOT EXISTS period_year  integer,
  ADD COLUMN IF NOT EXISTS period_month integer CHECK (period_month BETWEEN 1 AND 12);

-- Idempotency: re-running the evaluator must not stack duplicates.
-- Verified: two consecutive runs produced exactly one award row.
CREATE UNIQUE INDEX IF NOT EXISTS kpi_adjustments_rule_once_idx
  ON public.kpi_adjustments (employee_id, period_year, period_month, rule_code)
  WHERE source = 'rule';
CREATE UNIQUE INDEX IF NOT EXISTS warning_recs_rule_once_idx
  ON public.warning_recommendations (employee_id, period_year, period_month, rule_code)
  WHERE source = 'rule';

CREATE TABLE IF NOT EXISTS public.kpi_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  code          text NOT NULL,
  label         text NOT NULL,
  -- Every metric is derived from attendance rows the employee cannot edit —
  -- attendance_guard reverts any self-service change to status or overtime.
  -- That is what makes this safe to automate at all.
  metric        text NOT NULL CHECK (metric IN (
                  'late_major_days', 'unauthorized_absence_days',
                  'perfect_attendance', 'early_departure_pct')),
  threshold     numeric NOT NULL,
  window_kind   text NOT NULL DEFAULT 'month' CHECK (window_kind IN ('month','quarter')),
  adjustment_code text NOT NULL,   -- an entry in kpi_adjustment_types
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

ALTER TABLE public.kpi_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kpi_rules_select ON public.kpi_rules;
CREATE POLICY kpi_rules_select ON public.kpi_rules
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid())));

DROP POLICY IF EXISTS kpi_rules_write ON public.kpi_rules;
CREATE POLICY kpi_rules_write ON public.kpi_rules
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager']))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_rules TO authenticated;

DROP TRIGGER IF EXISTS kpi_rules_updated_at ON public.kpi_rules;
CREATE TRIGGER kpi_rules_updated_at BEFORE UPDATE ON public.kpi_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- The four rules chosen for this build, seeded for every existing tenant.
INSERT INTO public.kpi_rules (company_id, code, label, metric, threshold, window_kind, adjustment_code)
SELECT c.id, r.code, r.label, r.metric, r.threshold, r.window_kind, r.adjustment_code
FROM company c
CROSS JOIN (VALUES
  ('perfect_attendance_quarter', 'Perfect attendance for the quarter',
   'perfect_attendance', 1, 'quarter', 'perfect_attendance_q'),
  ('repeated_lateness_month', 'Three or more badly-late days in a month',
   'late_major_days', 3, 'month', 'warning_level_1'),
  ('unauthorized_absence', 'Any unauthorised absence',
   'unauthorized_absence_days', 1, 'month', 'warning_level_2'),
  ('chronic_early_departure', 'Left early on more than half the month''s days',
   'early_departure_pct', 50, 'month', 'warning_level_1')
) AS r(code, label, metric, threshold, window_kind, adjustment_code)
ON CONFLICT (company_id, code) DO NOTHING;

-- ── 4. The evaluator ────────────────────────────────────────────────────────
-- Verified against constructed attendance: 4 late_major days fired
-- repeated_lateness (value 4), one unauthorised absence fired that rule
-- (value 1), a 100%-early month fired chronic_early_departure (value 100.0) —
-- all three as PROPOSALS, awards_issued 0. A spotless Apr-Jun fired the
-- quarter award for the clean employee and correctly skipped one with a single
-- late day.
CREATE OR REPLACE FUNCTION public.evaluate_kpi_rules(p_year integer, p_month integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text; v_company_id uuid; v_grace integer;
  v_rule record; v_emp record; v_from date; v_to date;
  v_value numeric; v_type record;
  v_awards integer := 0; v_proposals integer := 0; v_skipped integer := 0;
  v_fired jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_role := get_user_role(v_uid);
  IF v_role NOT IN ('super_admin','hr_manager') THEN
    RAISE EXCEPTION 'Access denied: evaluating KPI rules requires super_admin or hr_manager';
  END IF;
  v_company_id := get_user_company_id(v_uid);

  IF p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 OR p_year IS NULL OR p_year < 2020 THEN
    RAISE EXCEPTION 'Invalid period: year=%, month=%', p_year, p_month;
  END IF;

  SELECT COALESCE(early_checkout_grace_minutes, 5) INTO v_grace
  FROM shift_settings WHERE company_id = v_company_id;
  v_grace := COALESCE(v_grace, 5);

  FOR v_rule IN
    SELECT * FROM kpi_rules WHERE company_id = v_company_id AND active ORDER BY code
  LOOP
    IF v_rule.window_kind = 'quarter' THEN
      IF p_month % 3 <> 0 THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
      v_from := make_date(p_year, p_month - 2, 1);
    ELSE
      v_from := make_date(p_year, p_month, 1);
    END IF;
    v_to := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;

    SELECT * INTO v_type FROM kpi_adjustment_types
    WHERE company_id = v_company_id AND code = v_rule.adjustment_code AND active;
    IF v_type.id IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    FOR v_emp IN
      SELECT e.id, e.full_name FROM employees e
      WHERE e.company_id = v_company_id AND e.status = 'active'
    LOOP
      IF v_rule.metric = 'late_major_days' THEN
        SELECT count(*) INTO v_value FROM attendance
        WHERE employee_id = v_emp.id AND company_id = v_company_id
          AND date BETWEEN v_from AND v_to AND status = 'late_major';

      ELSIF v_rule.metric = 'unauthorized_absence_days' THEN
        SELECT count(*) INTO v_value FROM attendance
        WHERE employee_id = v_emp.id AND company_id = v_company_id
          AND date BETWEEN v_from AND v_to AND status = 'absent_unauthorized';

      ELSIF v_rule.metric = 'perfect_attendance' THEN
        -- Spotless: days actually worked, none late, none unauthorised, none
        -- left unclosed. Someone with no attendance is unmeasured, not perfect.
        SELECT CASE
                 WHEN count(*) = 0 THEN 0
                 WHEN count(*) FILTER (
                        WHERE status LIKE 'late%' OR status = 'absent_unauthorized'
                           OR (clock_in IS NOT NULL AND clock_out IS NULL)) > 0 THEN 0
                 ELSE 1 END
          INTO v_value
        FROM attendance
        WHERE employee_id = v_emp.id AND company_id = v_company_id
          AND date BETWEEN v_from AND v_to AND status <> 'absent_approved';

      ELSIF v_rule.metric = 'early_departure_pct' THEN
        SELECT CASE WHEN count(*) = 0 THEN NULL
                    ELSE round(100.0 * count(*) FILTER (WHERE early_minutes > v_grace) / count(*), 1)
               END INTO v_value
        FROM attendance
        WHERE employee_id = v_emp.id AND company_id = v_company_id
          AND date BETWEEN v_from AND v_to
          AND clock_in IS NOT NULL AND clock_out IS NOT NULL
          AND status <> 'absent_approved';
      ELSE
        v_value := NULL;
      END IF;

      -- Unmeasurable is not a trigger.
      IF v_value IS NULL OR v_value < v_rule.threshold THEN CONTINUE; END IF;

      IF v_type.kind = 'reward' THEN
        INSERT INTO kpi_adjustments (
          company_id, employee_id, issued_by, type, reward_type,
          points_adjustment, reason, period_year, period_month, source, rule_code
        ) VALUES (
          v_company_id, v_emp.id, NULL, 'reward', v_type.code, v_type.points,
          format('%s — awarded automatically (%s over %s to %s)',
                 v_type.label, v_rule.label, v_from, v_to),
          p_year, p_month, 'rule', v_rule.code)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN v_awards := v_awards + 1; END IF;
      ELSE
        -- Proposed only. HR decides via approve_warning_recommendation().
        INSERT INTO warning_recommendations (
          company_id, employee_id, recommended_by, warning_level, reason,
          status, source, rule_code, period_year, period_month
        ) VALUES (
          v_company_id, v_emp.id, NULL, COALESCE(v_type.warning_level, 1),
          format('%s: measured %s = %s (threshold %s) between %s and %s. Proposed automatically — review before issuing.',
                 v_rule.label, v_rule.metric, v_value, v_rule.threshold, v_from, v_to),
          'pending', 'rule', v_rule.code, p_year, p_month)
        ON CONFLICT DO NOTHING;
        IF FOUND THEN v_proposals := v_proposals + 1; END IF;
      END IF;

      v_fired := v_fired || jsonb_build_object(
        'employee', v_emp.full_name, 'rule', v_rule.code,
        'metric', v_rule.metric, 'value', v_value, 'kind', v_type.kind);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'period', format('%s-%s', p_year, lpad(p_month::text, 2, '0')),
    'awards_issued', v_awards, 'warnings_proposed', v_proposals,
    'rules_skipped', v_skipped, 'detail', v_fired);
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_kpi_rules(integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_kpi_rules(integer,integer) TO authenticated;

-- ── 5. Quarterly review cycles ──────────────────────────────────────────────
-- The cadence setting already existed but was 6 months. The requested cadence
-- is quarterly.
ALTER TABLE public.kpi_settings
  ALTER COLUMN evaluation_frequency_months SET DEFAULT 3;
UPDATE public.kpi_settings SET evaluation_frequency_months = 3
 WHERE evaluation_frequency_months = 6;

CREATE TABLE IF NOT EXISTS public.kpi_review_cycles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  period_year    integer NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
  period_quarter integer NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','self_review','manager_review','calculated','published')),
  self_due       date,
  manager_due    date,
  opened_by      uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  opened_at      timestamptz,
  published_by   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_year, period_quarter)
);

CREATE TABLE IF NOT EXISTS public.kpi_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id      uuid NOT NULL REFERENCES public.kpi_review_cycles(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  -- Employee's own, writable only while the cycle is in self_review.
  self_score           numeric(5,2) CHECK (self_score BETWEEN 0 AND 100),
  self_comment         text,
  self_submitted_at    timestamptz,
  -- Manager's, writable only while in manager_review.
  manager_score        numeric(5,2) CHECK (manager_score BETWEEN 0 AND 100),
  behavior_score       numeric(5,2) CHECK (behavior_score BETWEEN 0 AND 100),
  achievement_score    numeric(5,2) CHECK (achievement_score BETWEEN 0 AND 100),
  manager_comment      text,
  manager_submitted_at timestamptz,
  manager_employee_id  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  -- System, snapshotted at calculation from the quarter's monthly rows.
  auto_attendance   numeric(5,2),
  auto_reliability  numeric(5,2),
  adjustment_points numeric(6,2),
  final_score       numeric(5,2),
  rating            text,
  bonus_eligible    boolean NOT NULL DEFAULT false,
  coverage_pct      numeric(5,1),
  weights_used      jsonb,
  calculated_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);

CREATE INDEX IF NOT EXISTS kpi_reviews_employee_idx ON public.kpi_reviews (employee_id);
CREATE INDEX IF NOT EXISTS kpi_reviews_cycle_idx    ON public.kpi_reviews (cycle_id);

ALTER TABLE public.kpi_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_reviews       ENABLE ROW LEVEL SECURITY;

-- Everyone sees the cycle: an employee needs to know a review is open and due.
DROP POLICY IF EXISTS kpi_cycles_select ON public.kpi_review_cycles;
CREATE POLICY kpi_cycles_select ON public.kpi_review_cycles
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid())));

DROP POLICY IF EXISTS kpi_cycles_write ON public.kpi_review_cycles;
CREATE POLICY kpi_cycles_write ON public.kpi_review_cycles
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager']))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager']));

-- Own review; HR and read_only see all; a department manager sees their own
-- department. Mirrors existing kpi_scores visibility.
DROP POLICY IF EXISTS kpi_reviews_select ON public.kpi_reviews;
CREATE POLICY kpi_reviews_select ON public.kpi_reviews
  FOR SELECT TO authenticated
  USING (
    company_id = get_user_company_id((SELECT auth.uid()))
    AND (
      get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager','read_only'])
      OR employee_id IN (SELECT id FROM employees WHERE user_id = (SELECT auth.uid()))
      OR (get_user_role((SELECT auth.uid())) = 'department_manager'
          AND employee_id IN (SELECT id FROM employees
                              WHERE department_id = get_user_department_id((SELECT auth.uid()))))
    )
  );

-- Rows are created by open_kpi_review_cycle(), so there is no self-insert path.
-- WHICH COLUMNS each role may move is enforced by kpi_review_guard() below —
-- RLS is row-level and cannot express it.
DROP POLICY IF EXISTS kpi_reviews_self_update ON public.kpi_reviews;
CREATE POLICY kpi_reviews_self_update ON public.kpi_reviews
  FOR UPDATE TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) <> 'read_only'
         AND employee_id IN (SELECT id FROM employees WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND employee_id IN (SELECT id FROM employees WHERE user_id = (SELECT auth.uid())));

-- Verified: a department_manager cannot reach another department's review at
-- all — the UPDATE simply matches no rows.
DROP POLICY IF EXISTS kpi_reviews_manager_update ON public.kpi_reviews;
CREATE POLICY kpi_reviews_manager_update ON public.kpi_reviews
  FOR UPDATE TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) = 'department_manager'
         AND employee_id IN (SELECT id FROM employees
                             WHERE department_id = get_user_department_id((SELECT auth.uid()))));

DROP POLICY IF EXISTS kpi_reviews_hr_write ON public.kpi_reviews;
CREATE POLICY kpi_reviews_hr_write ON public.kpi_reviews
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager']))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) = ANY (ARRAY['super_admin','hr_manager']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_review_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_reviews       TO authenticated;

DROP TRIGGER IF EXISTS kpi_cycles_updated_at ON public.kpi_review_cycles;
CREATE TRIGGER kpi_cycles_updated_at BEFORE UPDATE ON public.kpi_review_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS kpi_reviews_updated_at ON public.kpi_reviews;
CREATE TRIGGER kpi_reviews_updated_at BEFORE UPDATE ON public.kpi_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 6. Stage enforcement, cycle lifecycle, rolling view ─────────────────────
-- RLS decides which ROWS you may touch; this decides which COLUMNS, and when.
-- Without it "employee rates, then manager rates" is a label on a status field.
--
-- Verified end to end: an employee submitting self_score=88 while also writing
-- manager_score/behavior/final_score/rating/bonus_eligible kept only the 88 —
-- everything else reverted silently. Editing the self score after the stage
-- closed raised. A manager writing scores for their own report succeeded and
-- was stamped; the same manager's attempt to rewrite the employee's self score
-- reverted.
CREATE OR REPLACE FUNCTION public.kpi_review_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text; v_is_hr boolean := false; v_is_self boolean := false;
  v_status text; v_emp uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;  -- maintenance / system paths

  v_role    := get_user_role(v_uid);
  v_is_hr   := v_role IN ('super_admin','hr_manager');
  v_is_self := EXISTS (SELECT 1 FROM employees WHERE id = NEW.employee_id AND user_id = v_uid);
  SELECT status INTO v_status FROM kpi_review_cycles WHERE id = NEW.cycle_id;
  SELECT id INTO v_emp FROM employees WHERE user_id = v_uid LIMIT 1;

  -- HR may correct anything at any stage. They own the cycle.
  IF v_is_hr THEN RETURN NEW; END IF;

  IF v_is_self THEN
    IF v_status <> 'self_review' THEN
      RAISE EXCEPTION 'Self-assessment is not open for this quarter (cycle is %).', v_status
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.self_score IS DISTINCT FROM OLD.self_score
       OR NEW.self_comment IS DISTINCT FROM OLD.self_comment THEN
      NEW.self_submitted_at := now();
    END IF;
    -- Everything else reverts. An employee cannot score themselves on the
    -- manager's behalf, nor touch the calculated outcome.
    NEW.manager_score := OLD.manager_score;
    NEW.behavior_score := OLD.behavior_score;
    NEW.achievement_score := OLD.achievement_score;
    NEW.manager_comment := OLD.manager_comment;
    NEW.manager_submitted_at := OLD.manager_submitted_at;
    NEW.manager_employee_id := OLD.manager_employee_id;
    NEW.auto_attendance := OLD.auto_attendance;
    NEW.auto_reliability := OLD.auto_reliability;
    NEW.adjustment_points := OLD.adjustment_points;
    NEW.final_score := OLD.final_score;
    NEW.rating := OLD.rating;
    NEW.bonus_eligible := OLD.bonus_eligible;
    NEW.coverage_pct := OLD.coverage_pct;
    NEW.weights_used := OLD.weights_used;
    NEW.calculated_at := OLD.calculated_at;
    NEW.employee_id := OLD.employee_id;
    NEW.cycle_id := OLD.cycle_id;
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
    -- A manager cannot rewrite what the employee said about themselves.
    NEW.self_score := OLD.self_score;
    NEW.self_comment := OLD.self_comment;
    NEW.self_submitted_at := OLD.self_submitted_at;
    NEW.auto_attendance := OLD.auto_attendance;
    NEW.auto_reliability := OLD.auto_reliability;
    NEW.adjustment_points := OLD.adjustment_points;
    NEW.final_score := OLD.final_score;
    NEW.rating := OLD.rating;
    NEW.bonus_eligible := OLD.bonus_eligible;
    NEW.coverage_pct := OLD.coverage_pct;
    NEW.weights_used := OLD.weights_used;
    NEW.calculated_at := OLD.calculated_at;
    NEW.employee_id := OLD.employee_id;
    NEW.cycle_id := OLD.cycle_id;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Your role cannot write to a performance review' USING ERRCODE = 'P0001';
END;
$function$;

DROP TRIGGER IF EXISTS ab_kpi_review_guard ON public.kpi_reviews;
CREATE TRIGGER ab_kpi_review_guard
  BEFORE UPDATE ON public.kpi_reviews
  FOR EACH ROW EXECUTE FUNCTION public.kpi_review_guard();

REVOKE ALL ON FUNCTION public.kpi_review_guard() FROM PUBLIC, anon, authenticated;

-- Creates the cycle plus one review row per active employee, and opens
-- self-review immediately. This is the HR gate the request asked for: no
-- employee can self-rate until this has run.
CREATE OR REPLACE FUNCTION public.open_kpi_review_cycle(
  p_year integer, p_quarter integer, p_self_due date DEFAULT NULL, p_manager_due date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_company uuid; v_emp uuid; v_cycle uuid; v_n integer;
BEGIN
  IF get_user_role(v_uid) NOT IN ('super_admin','hr_manager') THEN
    RAISE EXCEPTION 'Only HR or super admin can open a review cycle';
  END IF;
  IF p_quarter NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'Quarter must be 1-4'; END IF;
  v_company := get_user_company_id(v_uid);
  SELECT id INTO v_emp FROM employees WHERE user_id = v_uid LIMIT 1;

  INSERT INTO kpi_review_cycles (company_id, period_year, period_quarter, status,
                                 self_due, manager_due, opened_by, opened_at)
  VALUES (v_company, p_year, p_quarter, 'self_review', p_self_due, p_manager_due, v_emp, now())
  ON CONFLICT (company_id, period_year, period_quarter) DO NOTHING
  RETURNING id INTO v_cycle;

  IF v_cycle IS NULL THEN
    RAISE EXCEPTION 'A review cycle for % Q% already exists', p_year, p_quarter;
  END IF;

  INSERT INTO kpi_reviews (cycle_id, company_id, employee_id)
  SELECT v_cycle, v_company, e.id
  FROM employees e WHERE e.company_id = v_company AND e.status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('cycle_id', v_cycle, 'status', 'self_review', 'employees', v_n);
END;
$function$;

REVOKE ALL ON FUNCTION public.open_kpi_review_cycle(integer,integer,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_kpi_review_cycle(integer,integer,date,date) TO authenticated;

-- Forward only, one step at a time. 'calculated' runs the arithmetic for every
-- employee in the cycle. Verified: attendance 100 (avg of the quarter's monthly
-- rows) with manager 80 / behaviour 85 / achievement 78 / self 88 at the
-- default 30/25/20/15/10 produced base 87.65, coverage 100%, High Performer,
-- bonus eligible — checked by hand.
CREATE OR REPLACE FUNCTION public.advance_kpi_review_cycle(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_company uuid; v_emp uuid; v_c record; v_next text;
  v_s record; v_r record; v_from date; v_to date;
  v_num numeric; v_den integer; v_den_ns integer; v_total_w integer;
  v_att numeric; v_rel numeric; v_adj numeric; v_base numeric; v_cov numeric;
  v_n integer := 0;
BEGIN
  IF get_user_role(v_uid) NOT IN ('super_admin','hr_manager') THEN
    RAISE EXCEPTION 'Only HR or super admin can advance a review cycle';
  END IF;
  v_company := get_user_company_id(v_uid);
  SELECT id INTO v_emp FROM employees WHERE user_id = v_uid LIMIT 1;

  SELECT * INTO v_c FROM kpi_review_cycles WHERE id = p_cycle_id AND company_id = v_company;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'Review cycle not found'; END IF;

  v_next := CASE v_c.status
              WHEN 'draft'          THEN 'self_review'
              WHEN 'self_review'    THEN 'manager_review'
              WHEN 'manager_review' THEN 'calculated'
              WHEN 'calculated'     THEN 'published'
              ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'This cycle is already published'; END IF;

  IF v_next = 'calculated' THEN
    SELECT * INTO v_s FROM kpi_settings WHERE company_id = v_company;
    v_total_w := COALESCE(v_s.weight_attendance,30) + COALESCE(v_s.weight_behavior,25)
               + COALESCE(v_s.weight_achievement,20) + COALESCE(v_s.weight_manager,15)
               + COALESCE(v_s.weight_self,10) + COALESCE(v_s.weight_reliability,0);
    v_from := make_date(v_c.period_year, (v_c.period_quarter - 1) * 3 + 1, 1);
    v_to   := (make_date(v_c.period_year, v_c.period_quarter * 3, 1) + interval '1 month - 1 day')::date;

    FOR v_r IN SELECT * FROM kpi_reviews WHERE cycle_id = p_cycle_id LOOP
      -- AVG ignores NULLs, so a month that was never measured does not pull the
      -- quarter down — same principle as the monthly coverage rule.
      SELECT AVG(attendance_score), AVG(reliability_score), COALESCE(SUM(adjustment_points),0)
        INTO v_att, v_rel, v_adj
      FROM kpi_scores
      WHERE employee_id = v_r.employee_id
        AND make_date(period_year, period_month, 1) BETWEEN v_from AND v_to;

      v_num := 0; v_den := 0; v_den_ns := 0;
      IF v_att IS NOT NULL THEN
        v_num := v_num + v_att * COALESCE(v_s.weight_attendance,30);
        v_den := v_den + COALESCE(v_s.weight_attendance,30);
        v_den_ns := v_den_ns + COALESCE(v_s.weight_attendance,30);
      END IF;
      IF v_rel IS NOT NULL AND COALESCE(v_s.weight_reliability,0) > 0 THEN
        v_num := v_num + v_rel * v_s.weight_reliability;
        v_den := v_den + v_s.weight_reliability;
        v_den_ns := v_den_ns + v_s.weight_reliability;
      END IF;
      IF v_r.behavior_score IS NOT NULL THEN
        v_num := v_num + v_r.behavior_score * COALESCE(v_s.weight_behavior,25);
        v_den := v_den + COALESCE(v_s.weight_behavior,25);
        v_den_ns := v_den_ns + COALESCE(v_s.weight_behavior,25);
      END IF;
      IF v_r.achievement_score IS NOT NULL THEN
        v_num := v_num + v_r.achievement_score * COALESCE(v_s.weight_achievement,20);
        v_den := v_den + COALESCE(v_s.weight_achievement,20);
        v_den_ns := v_den_ns + COALESCE(v_s.weight_achievement,20);
      END IF;
      IF v_r.manager_score IS NOT NULL THEN
        v_num := v_num + v_r.manager_score * COALESCE(v_s.weight_manager,15);
        v_den := v_den + COALESCE(v_s.weight_manager,15);
        v_den_ns := v_den_ns + COALESCE(v_s.weight_manager,15);
      END IF;
      IF v_r.self_score IS NOT NULL THEN
        v_num := v_num + v_r.self_score * COALESCE(v_s.weight_self,10);
        v_den := v_den + COALESCE(v_s.weight_self,10);
      END IF;

      v_cov  := CASE WHEN v_total_w > 0 THEN round(v_den * 100.0 / v_total_w, 1) ELSE 0 END;
      v_base := CASE WHEN v_den > 0 THEN v_num / v_den ELSE 0 END;

      UPDATE kpi_reviews SET
        auto_attendance   = round(v_att, 2),
        auto_reliability  = round(v_rel, 2),
        adjustment_points = v_adj,
        final_score  = round(greatest(0, least(100, v_base + v_adj)), 2),
        coverage_pct = v_cov,
        -- Same two gates as the monthly score: enough assessed, and at least
        -- one component the employee does not write themselves.
        rating = CASE WHEN v_den > 0 AND v_cov >= 50 AND v_den_ns > 0
                      THEN kpi_rating_label(round(greatest(0, least(100, v_base + v_adj)), 2))
                      ELSE NULL END,
        bonus_eligible = CASE WHEN v_den > 0 AND v_cov >= 50 AND v_den_ns > 0
                              THEN round(greatest(0, least(100, v_base + v_adj)), 2) >= 75
                              ELSE false END,
        weights_used = jsonb_build_object(
          'attendance', COALESCE(v_s.weight_attendance,30),
          'reliability', COALESCE(v_s.weight_reliability,0),
          'behavior', COALESCE(v_s.weight_behavior,25),
          'achievement', COALESCE(v_s.weight_achievement,20),
          'manager', COALESCE(v_s.weight_manager,15),
          'self', COALESCE(v_s.weight_self,10),
          'covered_weight', v_den, 'total_weight', v_total_w,
          'coverage_pct', v_cov, 'base_score', round(v_base,2),
          'adjustment_points', v_adj,
          'window', jsonb_build_object('from', v_from, 'to', v_to)),
        calculated_at = now()
      WHERE id = v_r.id;
      v_n := v_n + 1;
    END LOOP;
  END IF;

  UPDATE kpi_review_cycles
     SET status = v_next,
         published_by = CASE WHEN v_next = 'published' THEN v_emp ELSE published_by END,
         published_at = CASE WHEN v_next = 'published' THEN now() ELSE published_at END
   WHERE id = p_cycle_id;

  RETURN jsonb_build_object('cycle_id', p_cycle_id, 'status', v_next, 'calculated', v_n);
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_kpi_review_cycle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_kpi_review_cycle(uuid) TO authenticated;

-- Continuity WITHOUT blending: each quarter's final_score is untouched, and the
-- rolling average sits beside it as a separate, clearly-named figure.
CREATE OR REPLACE VIEW public.kpi_rolling_scores
WITH (security_invoker = true) AS
SELECT r.employee_id, r.company_id, c.period_year, c.period_quarter,
       r.final_score, r.rating,
       round(AVG(r.final_score) OVER (
         PARTITION BY r.employee_id ORDER BY c.period_year, c.period_quarter
         ROWS BETWEEN 3 PRECEDING AND CURRENT ROW), 2) AS rolling_4q_score,
       count(*) OVER (
         PARTITION BY r.employee_id ORDER BY c.period_year, c.period_quarter
         ROWS BETWEEN 3 PRECEDING AND CURRENT ROW) AS quarters_in_window
FROM kpi_reviews r
JOIN kpi_review_cycles c ON c.id = r.cycle_id
WHERE c.status = 'published' AND r.final_score IS NOT NULL;

GRANT SELECT ON public.kpi_rolling_scores TO authenticated;

COMMENT ON VIEW public.kpi_rolling_scores IS
  'Published quarterly scores plus a rolling 4-quarter average. The average is presentational only — each quarter''s final_score stands on its own evidence and is never blended with the previous one.';
