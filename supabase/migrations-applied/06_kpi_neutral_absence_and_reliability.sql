-- KPI: three corrections to what is already measured, and one new measured
-- component. Applied as `kpi_neutral_absence_and_reliability`, followed by
-- `kpi_default_approved_absence_neutral` (07) which makes correction 2 take
-- effect on existing tenants.
--
-- CORRECTIONS to calculate_attendance_score:
--
--  1. An empty month scored 0. `IF v_total_days = 0 THEN RETURN 0` meant an
--     employee with no attendance rows at all — a new joiner, someone on
--     long leave, anyone in a company that has not started clocking —
--     received a hard zero on 30% of their KPI. Since 01 made "not
--     evaluated" expressible, this returns NULL and drops out of the
--     weighting instead of dragging the total down.
--
--  2. Approved absence scored 80. Handbook Art. 5 treats authorised absence
--     as neutral, not as a slightly-bad day: taking approved annual leave
--     should not move a performance score at all. Scoring it 80 pulled
--     anyone who took their entitlement toward 80 and quietly penalised
--     using leave they are owed. Approved-absence days are now excluded
--     from both numerator and denominator. A company that disagrees can
--     still price it via kpi_settings.attendance_point_values; only the
--     default changes.
--
--  3. An unrecognised status scored 100. The COALESCE chain fell back to
--     `present` and then to a literal 100, so any status the point table did
--     not know about became a perfect day. A scoring model must never round
--     an unknown up. Unknown statuses are now excluded.
--
-- NEW COMPONENT — reliability_score:
--
--     attendance_score answers "did they turn up, and on time". Nothing
--     answered "did they work the day". Someone clocking in at 08:00 every
--     morning and leaving at 11:00 scores a perfect 100 on attendance. The
--     early-checkout work in 02 means the data to measure this now exists.
--
--     reliability_score is the mean over measurable days of worked/scheduled,
--     capped at 100 so overtime cannot inflate it (overtime is tracked and
--     paid separately). Approved-absence days are excluded — a day someone
--     was authorised to be away is not a day they failed to work.
--
--     Its weight defaults to 0. Adding a scoring component silently would
--     move every total and, above 75, bonus eligibility. It is measured and
--     displayed immediately; whether it scores is a policy decision.
--
-- Measured effect on live data: only the two employees with real attendance
-- moved. Raaed Al Serva Jul attendance 90.00 -> 100.00, reliability 99.54,
-- total 83.25 -> 90.75. Raaed EMP1002 Jul attendance 90.00 -> 100.00, total
-- 67.50 -> 75.00. No rating changed anywhere; both remain withheld by the
-- coverage floor. The other 108 period rows were untouched.

ALTER TABLE public.kpi_settings
  ADD COLUMN IF NOT EXISTS weight_reliability integer NOT NULL DEFAULT 0
    CHECK (weight_reliability BETWEEN 0 AND 100);

COMMENT ON COLUMN public.kpi_settings.weight_reliability IS
  'Weight of reliability_score in the KPI total. 0 (default) means measured and displayed but not scored.';

ALTER TABLE public.kpi_scores
  ADD COLUMN IF NOT EXISTS reliability_score numeric(5,2);

COMMENT ON COLUMN public.kpi_scores.reliability_score IS
  'Mean of worked/scheduled hours across days with both a clock-in and a clock-out, capped at 100. NULL when no day in the period was measurable.';

-- ── Attendance score ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_attendance_score(
  p_employee_id uuid, p_year integer, p_month integer, p_company_id uuid
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_scored_days INT := 0;
  v_score_sum   NUMERIC := 0;
  v_rec         RECORD;
  v_pv          jsonb;
  v_point       numeric;
BEGIN
  SELECT attendance_point_values INTO v_pv
  FROM kpi_settings WHERE company_id = p_company_id;

  IF v_pv IS NULL THEN
    v_pv := '{"present":100,"late_minor":85,"late_moderate":70,"late_major":50,"absent_unauthorized":0}'::jsonb;
  END IF;

  FOR v_rec IN
    SELECT a.status
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.employee_id = p_employee_id
      AND a.company_id = p_company_id
      AND e.company_id = p_company_id
      AND EXTRACT(YEAR  FROM a.date) = p_year
      AND EXTRACT(MONTH FROM a.date) = p_month
  LOOP
    -- Approved absence is neutral unless the company has priced it explicitly.
    IF v_rec.status = 'absent_approved'
       AND (v_pv ? 'absent_approved') IS NOT TRUE THEN
      CONTINUE;
    END IF;

    v_point := (v_pv ->> v_rec.status)::numeric;

    -- Unknown status: excluded rather than rounded up to a perfect day.
    IF v_point IS NULL THEN
      CONTINUE;
    END IF;

    v_scored_days := v_scored_days + 1;
    v_score_sum   := v_score_sum + v_point;
  END LOOP;

  -- Nothing scoreable this period is "not evaluated", not zero.
  IF v_scored_days = 0 THEN RETURN NULL; END IF;

  RETURN GREATEST(0, LEAST(100, ROUND(v_score_sum / v_scored_days, 2)));
END;
$function$;

-- ── Reliability score ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_reliability_score(
  p_employee_id uuid, p_year integer, p_month integer, p_company_id uuid
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_days      INT := 0;
  v_sum       NUMERIC := 0;
  v_rec       RECORD;
  v_sched_min NUMERIC;
  v_worked    NUMERIC;
  v_company   RECORD;
BEGIN
  SELECT work_start_time, work_end_time INTO v_company FROM company WHERE id = p_company_id;

  FOR v_rec IN
    SELECT a.clock_in, a.clock_out, a.break_start, a.break_end, a.status,
           s.start_at, s.end_at, s.break_minutes
    FROM attendance a
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.employee_id = p_employee_id
      AND a.company_id = p_company_id
      AND a.clock_in IS NOT NULL
      AND a.clock_out IS NOT NULL
      AND a.clock_out > a.clock_in
      AND EXTRACT(YEAR  FROM a.date) = p_year
      AND EXTRACT(MONTH FROM a.date) = p_month
  LOOP
    -- A day the employee was authorised to be away is not a day they failed
    -- to work.
    IF v_rec.status = 'absent_approved' THEN CONTINUE; END IF;

    IF v_rec.start_at IS NOT NULL AND v_rec.end_at IS NOT NULL THEN
      v_sched_min := EXTRACT(epoch FROM (v_rec.end_at - v_rec.start_at)) / 60
                     - COALESCE(v_rec.break_minutes, 0);
    ELSIF v_company.work_start_time IS NOT NULL AND v_company.work_end_time IS NOT NULL THEN
      v_sched_min := EXTRACT(epoch FROM (v_company.work_end_time - v_company.work_start_time)) / 60;
      -- Fixed hours that wrap midnight.
      IF v_sched_min <= 0 THEN v_sched_min := v_sched_min + 1440; END IF;
    ELSE
      CONTINUE;
    END IF;

    IF v_sched_min IS NULL OR v_sched_min <= 0 THEN CONTINUE; END IF;

    v_worked := EXTRACT(epoch FROM (v_rec.clock_out - v_rec.clock_in)) / 60;
    IF v_rec.break_start IS NOT NULL AND v_rec.break_end IS NOT NULL
       AND v_rec.break_end > v_rec.break_start THEN
      v_worked := v_worked - EXTRACT(epoch FROM (v_rec.break_end - v_rec.break_start)) / 60;
    END IF;

    v_days := v_days + 1;
    -- Capped at 100: staying late is overtime, not extra reliability.
    v_sum  := v_sum + LEAST(100, GREATEST(0, 100 * v_worked / v_sched_min));
  END LOOP;

  IF v_days = 0 THEN RETURN NULL; END IF;
  RETURN ROUND(v_sum / v_days, 2);
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_reliability_score(uuid,integer,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_reliability_score(uuid,integer,integer,uuid) TO authenticated;

-- ── Keep both derived components in step with attendance ────────────────────
CREATE OR REPLACE FUNCTION public.sync_attendance_score()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_year INT; v_month INT; v_emp_id UUID; v_company_id UUID;
  v_att NUMERIC(5,2); v_rel NUMERIC(5,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_emp_id     := OLD.employee_id;
    v_year       := EXTRACT(YEAR  FROM OLD.date)::INT;
    v_month      := EXTRACT(MONTH FROM OLD.date)::INT;
    v_company_id := OLD.company_id;
  ELSE
    v_emp_id     := NEW.employee_id;
    v_year       := EXTRACT(YEAR  FROM NEW.date)::INT;
    v_month      := EXTRACT(MONTH FROM NEW.date)::INT;
    v_company_id := NEW.company_id;
  END IF;

  v_att := calculate_attendance_score(v_emp_id, v_year, v_month, v_company_id);
  v_rel := calculate_reliability_score(v_emp_id, v_year, v_month, v_company_id);

  INSERT INTO kpi_scores (
    employee_id, company_id, period_year, period_month,
    attendance_score, reliability_score,
    behavior_score, achievement_score, manager_score, self_score
  ) VALUES (
    v_emp_id, v_company_id, v_year, v_month, v_att, v_rel, NULL, NULL, NULL, NULL
  )
  ON CONFLICT (employee_id, period_year, period_month)
  DO UPDATE SET attendance_score = v_att, reliability_score = v_rel;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_attendance_score() FROM PUBLIC, anon, authenticated;

-- ── Total ───────────────────────────────────────────────────────────────────
-- Unchanged from the previous definition except for w_rel: the reliability
-- weight is read from settings, contributes to the total and to coverage only
-- when it is above 0, and is reported in weights_used either way.
CREATE OR REPLACE FUNCTION public.compute_kpi_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  s               record;
  w_att  integer := 30;
  w_beh  integer := 25;
  w_ach  integer := 20;
  w_mgr  integer := 15;
  w_self integer := 10;
  w_rel  integer := 0;
  v_prev_mgr      numeric;
  v_prev_self     numeric;
  v_num           numeric := 0;
  v_den           integer := 0;
  v_den_not_self  integer := 0;
  v_total_weight  integer;
  v_coverage      numeric;
  c_min_coverage  numeric := 50;
begin
  select * into s from public.kpi_settings where company_id = new.company_id;
  if found then
    w_att  := s.weight_attendance;
    w_beh  := s.weight_behavior;
    w_ach  := s.weight_achievement;
    w_mgr  := s.weight_manager;
    w_self := s.weight_self;
    w_rel  := coalesce(s.weight_reliability, 0);
  end if;
  v_total_weight := w_att + w_beh + w_ach + w_mgr + w_self + w_rel;

  -- Looked up for context only. Deliberately NOT assigned to new.manager_score /
  -- new.self_score, and deliberately excluded from the arithmetic.
  if new.manager_score is null then
    select manager_score into v_prev_mgr
    from public.kpi_scores
    where employee_id = new.employee_id
      and manager_score is not null
      and (period_year, period_month) < (new.period_year, new.period_month)
    order by period_year desc, period_month desc
    limit 1;
  end if;
  if new.self_score is null then
    select self_score into v_prev_self
    from public.kpi_scores
    where employee_id = new.employee_id
      and self_score is not null
      and (period_year, period_month) < (new.period_year, new.period_month)
    order by period_year desc, period_month desc
    limit 1;
  end if;

  -- Only this month's own values are scored. NULL is not evaluated; 0 is a real
  -- score and counts, so a month of unauthorised absence still hurts.
  if new.attendance_score is not null then
    v_num := v_num + new.attendance_score * w_att;
    v_den := v_den + w_att;  v_den_not_self := v_den_not_self + w_att;
  end if;
  if new.behavior_score is not null then
    v_num := v_num + new.behavior_score * w_beh;
    v_den := v_den + w_beh;  v_den_not_self := v_den_not_self + w_beh;
  end if;
  if new.achievement_score is not null then
    v_num := v_num + new.achievement_score * w_ach;
    v_den := v_den + w_ach;  v_den_not_self := v_den_not_self + w_ach;
  end if;
  if new.manager_score is not null then
    v_num := v_num + new.manager_score * w_mgr;
    v_den := v_den + w_mgr;  v_den_not_self := v_den_not_self + w_mgr;
  end if;
  -- Weight 0 contributes nothing to either side, so an unweighted reliability
  -- score cannot change the total or the coverage figure.
  if new.reliability_score is not null and w_rel > 0 then
    v_num := v_num + new.reliability_score * w_rel;
    v_den := v_den + w_rel;  v_den_not_self := v_den_not_self + w_rel;
  end if;
  if new.self_score is not null then
    v_num := v_num + new.self_score * w_self;
    v_den := v_den + w_self;
  end if;

  v_coverage := case when v_total_weight > 0
                     then round(v_den * 100.0 / v_total_weight, 1) else 0 end;

  new.total_score := case when v_den > 0 then round(v_num / v_den, 2) else 0 end;

  -- Enough of this month assessed, and at least one component the employee does
  -- not control. self_score is employee-written, so it can never earn a rating
  -- on its own.
  if v_den > 0 and v_coverage >= c_min_coverage and v_den_not_self > 0 then
    new.rating         := public.kpi_rating_label(new.total_score);
    new.bonus_eligible := new.total_score >= 75;
  else
    new.rating         := null;
    new.bonus_eligible := false;
  end if;

  new.weights_used := jsonb_build_object(
    'attendance',          w_att,
    'behavior',            w_beh,
    'achievement',         w_ach,
    'manager',             w_mgr,
    'self',                w_self,
    'reliability',         w_rel,
    'covered_weight',      v_den,
    'total_weight',        v_total_weight,
    'coverage_pct',        v_coverage,
    'previous_manager_score', v_prev_mgr,
    'previous_self_score',    v_prev_self
  );

  return new;
end;
$function$;
