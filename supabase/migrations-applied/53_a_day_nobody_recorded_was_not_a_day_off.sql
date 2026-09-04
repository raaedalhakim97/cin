-- Finding 6 of the logic audit: no-shows were invisible.
--
-- An attendance row exists only when somebody punched. Nothing creates one for a day they
-- did not turn up, and 'absent_unauthorized' has to be typed in by HR by hand, per person
-- per day. So every attendance figure in the product was computed over the days people
-- came to work:
--
--   attendance_pct  = attended / (days with a row)   → 100% for anyone who ever punched
--   absence_count   = count of rows marked absent    → 0, always
--
-- Work five days, skip fifteen, and you scored 100% attendance with zero absences. Since
-- migration 47 that number also drives a KPI level, so the scorecard was rewarding the
-- absence of a record.
--
-- ── What "expected" means ──────────────────────────────────────────────
--
-- The fix is not to invent absence rows. A row saying somebody was absent without leave is
-- a disciplinary claim, and generating those from missing data — on a day nobody
-- scheduled, or a public holiday, or a day the company was not tracking — would be the
-- fabrication this schema keeps removing. The denominator is derived instead, per day:
--
--   a day is expected if  a work shift is rostered for it
--                     OR  the country pack says that weekday is a working day
--                         and no 'off' shift is rostered against it
--   minus                 days covered by approved leave
--
-- Two versions of this were wrong before the numbers were looked at, and both are worth
-- recording because both were invisible in the code and obvious in the data.
--
-- The first asked "does this employee have any shifts? then the roster IS the answer".
-- Production has twelve shift rows across a whole quarter — somebody trying the scheduler
-- once, not a published rota — so Aisha came out as expected 5 days having attended 16,
-- and scored 100%. A partial roster is not a statement that the unrostered days were days
-- off. Hence the per-day union above: a rostered day counts even on a weekend, and a
-- calendar working day counts unless it is explicitly rostered off.
--
-- The second produced a number for everybody, including four employees who have no login
-- at all. They cannot clock in, so they read 0% attendance and 67 absences — which is not
-- a measurement, it is an accusation against people the company never gave a way to
-- comply. So the function first asks whether this person was being measured:
--
--   something was recorded for them                                   -> measure
--   the company recorded attendance and they had a login to record it -> measure
--   otherwise                                                         -> NULL, unrated
--
-- The middle case is the whole point of finding 6: a person with an account, at a company
-- running attendance, with no rows for the quarter, is a real no-show and now shows as one.
--
-- weekend_days follows Postgres EXTRACT(DOW) — Sunday 0 through Saturday 6 — which is what
-- the seeded packs use: {5,6} for the Gulf, {6,0} for the UK, Nigeria, India, Kenya and
-- Pakistan. Getting this backwards would move the weekend by a day for half the packs, so
-- it is asserted in the guarantee suite rather than left to a comment.
--
-- ── Public holidays ────────────────────────────────────────────────────────
--
-- There is no holiday table in this schema, so a national holiday inside the period counts
-- as an expected day and reads as an absence for everybody. That is a real limitation and
-- it is deliberately not papered over here: a company that rosters shifts is unaffected
-- (nobody is rostered on Eid), and for one that does not, the fix is a holiday calendar,
-- which is its own piece of work rather than a guess inside this function.

-- ── How many days should this person have worked ───────────────────────────
CREATE OR REPLACE FUNCTION public.employee_expected_days(
  p_employee_id uuid, p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company   uuid;
  v_has_login boolean;
  v_weekend   smallint[];
  v_own_rows  integer;
  v_co_rows   integer;
  v_expected  integer;
BEGIN
  SELECT e.company_id, e.user_id IS NOT NULL INTO v_company, v_has_login
    FROM employees e WHERE e.id = p_employee_id;
  IF v_company IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_own_rows
    FROM attendance a
   WHERE a.employee_id = p_employee_id AND a.date BETWEEN p_from AND p_to;

  SELECT count(*) INTO v_co_rows
    FROM attendance a
   WHERE a.company_id = v_company AND a.date BETWEEN p_from AND p_to;

  -- Was this person's attendance being measured at all in this period? See the header.
  IF v_own_rows = 0 AND NOT (v_has_login AND v_co_rows > 0) THEN
    RETURN NULL;
  END IF;

  SELECT cr.weekend_days INTO v_weekend
    FROM company c JOIN country_rules cr ON cr.code = c.country
   WHERE c.id = v_company;

  SELECT count(*) INTO v_expected
    FROM generate_series(p_from, p_to, interval '1 day') d
   WHERE (
           EXISTS (SELECT 1 FROM shifts s
                    WHERE s.employee_id = p_employee_id
                      AND s.shift_date = d::date
                      AND s.shift_type = 'work'
                      AND s.status <> 'cancelled')
           OR (
             v_weekend IS NOT NULL
             AND NOT (EXTRACT(DOW FROM d)::smallint = ANY (v_weekend))
             AND NOT EXISTS (SELECT 1 FROM shifts s
                              WHERE s.employee_id = p_employee_id
                                AND s.shift_date = d::date
                                AND s.shift_type = 'off'
                                AND s.status <> 'cancelled')
           )
         )
     AND NOT EXISTS (
           SELECT 1 FROM leave_requests l
            WHERE l.employee_id = p_employee_id
              AND l.status = 'approved'
              AND d::date BETWEEN l.start_date AND l.end_date
         );

  -- No country pack and nothing rostered leaves nothing to divide by.
  IF v_expected = 0 THEN RETURN NULL; END IF;

  RETURN v_expected;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.employee_expected_days(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.employee_expected_days(uuid, date, date) TO authenticated;

-- ── The whole picture, for a screen to show ────────────────────────────────
-- A percentage nobody can take apart is a percentage nobody trusts. This is what the
-- number is made of, so the review screen can say "attended 12 of 20 expected days"
-- instead of asking somebody to believe 60%.
--
-- Guarded, unlike the metric function it replaces the guts of: attendance is personal, and
-- a SECURITY DEFINER function whose only argument is an employee id would otherwise report
-- on anybody to anybody who is signed in. Same question the KPI reports ask since
-- migration 45.
CREATE OR REPLACE FUNCTION public.employee_attendance_summary(
  p_employee_id uuid, p_from date, p_to date)
RETURNS TABLE (expected_days integer, attended_days integer, absent_days integer,
               leave_days integer, late_days integer, punctuality_pct numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expected integer;
  v_present  integer;
  v_late     integer;
  v_leave    integer;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND p_employee_id IS DISTINCT FROM get_user_employee_id((SELECT auth.uid()))
     AND NOT public.manages_employee(p_employee_id) THEN
    RETURN;
  END IF;

  v_expected := public.employee_expected_days(p_employee_id, p_from, p_to);

  SELECT count(DISTINCT a.date) FILTER (WHERE a.status = 'present'),
         count(DISTINCT a.date) FILTER (WHERE a.status LIKE 'late\_%')
    INTO v_present, v_late
    FROM attendance a
   WHERE a.employee_id = p_employee_id
     AND a.date BETWEEN p_from AND p_to;

  SELECT count(*) INTO v_leave
    FROM generate_series(p_from, p_to, interval '1 day') d
   WHERE EXISTS (SELECT 1 FROM leave_requests l
                  WHERE l.employee_id = p_employee_id
                    AND l.status = 'approved'
                    AND d::date BETWEEN l.start_date AND l.end_date);

  RETURN QUERY SELECT
    v_expected,
    v_present + v_late,
    CASE WHEN v_expected IS NULL THEN NULL
         ELSE GREATEST(0, v_expected - (v_present + v_late)) END,
    v_leave,
    v_late,
    CASE WHEN v_present + v_late = 0 THEN NULL
         ELSE round(100.0 * v_present / (v_present + v_late), 2) END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.employee_attendance_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.employee_attendance_summary(uuid, date, date) TO authenticated;

-- ── And the metric that feeds a KPI level ──────────────────────────────────
-- attendance_pct and absence_count now measure against expected days. punctuality_pct,
-- late_count and early_leave_count are unchanged: they are about the days somebody did
-- come in, and were never distorted by the missing rows.
--
-- The permission check is new. This function is SECURITY DEFINER, takes an employee id and
-- had no check at all, so any signed-in user could read anybody's attendance percentage.
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
  v_early     integer;
  v_observed  integer;
  v_expected  integer;
  v_attended  integer;
BEGIN
  -- auth.uid() is NULL for the engine calling this from inside a trigger, which has
  -- already been through its own check.
  IF (SELECT auth.uid()) IS NOT NULL
     AND p_employee_id IS DISTINCT FROM get_user_employee_id((SELECT auth.uid()))
     AND NOT public.manages_employee(p_employee_id) THEN
    RETURN NULL;
  END IF;

  SELECT
    count(DISTINCT a.date) FILTER (WHERE a.status = 'present'),
    count(DISTINCT a.date) FILTER (WHERE a.status LIKE 'late\_%'),
    count(DISTINCT a.date) FILTER (WHERE COALESCE(a.early_minutes, 0) > 0),
    count(DISTINCT a.date) FILTER (WHERE a.status <> 'absent_approved')
    INTO v_present, v_late, v_early, v_observed
  FROM attendance a
  WHERE a.employee_id = p_employee_id
    AND a.date BETWEEN p_from AND p_to;

  v_attended := v_present + v_late;
  v_expected := public.employee_expected_days(p_employee_id, p_from, p_to);

  RETURN CASE p_metric
    WHEN 'attendance_pct' THEN
      -- Capped at 100: somebody who worked a weekend has more attended days than expected
      -- ones, and 115% attendance is a number that makes a screen look broken.
      CASE WHEN v_expected IS NULL OR v_expected = 0 THEN NULL
           ELSE LEAST(100, round(100.0 * v_attended / v_expected, 2)) END
    WHEN 'absence_count' THEN
      CASE WHEN v_expected IS NULL THEN NULL
           ELSE GREATEST(0, v_expected - v_attended) END
    WHEN 'punctuality_pct' THEN
      CASE WHEN v_attended = 0 THEN NULL
           ELSE round(100.0 * v_present / v_attended, 2) END
    -- These two count events that were seen. With nothing observed at all the honest
    -- answer is "we did not measure this", not "none happened".
    WHEN 'late_count'        THEN CASE WHEN v_observed = 0 THEN NULL ELSE v_late END
    WHEN 'early_leave_count' THEN CASE WHEN v_observed = 0 THEN NULL ELSE v_early END
    ELSE NULL
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_metric_value(uuid, text, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_metric_value(uuid, text, date, date) TO authenticated;

-- ── Left alone, and tied to a decision Raaed has not made ──────────────────
-- calculate_attendance_score() — the monthly system's version — has the same flaw: it
-- averages per-day points across the rows that exist, so a month with three punches and
-- seventeen no-shows averages whatever those three days scored. It is not fixed here
-- because 129 rows of history hang off it and because finding 7 of the audit asks which
-- performance system survives. Changing the meaning of a number in the system that may be
-- retired is work spent twice; changing it in the one being built is not.

-- ── Measured on production, the same quarter, before and after ─────────────
--
--                       attendance_pct   absences        after
--   Aisha    16 rows        100%             0        23.53%   52
--   Khalid    3 rows        100%             0         5.45%   52  (18 days leave off)
--   Hassan    2 rows        100%             0         2.94%   66
--   Fatima    1 row         100%             0         1.52%   65
--   Omar      0 rows        100%             0         0.00%   66  (was invisible)
--   Eiad      0 rows        100%             0         0.00%   66  (was invisible)
--   Layla     0 rows, no login              null      unrated      (cannot clock in)
--
-- Every one of them read 100% attendance with zero absences before this migration.
