-- Two things testing the department boundary turned up.
--
-- ── 1. Five SECURITY DEFINER functions took a review id and asked nothing else ──
--
-- kpi_review_score, kpi_review_opportunities, kpi_review_disagreements and
-- kpi_generate_review_lines are all SECURITY DEFINER — they have to be, because they read
-- across tables whose RLS would otherwise hide half the working set from the person the
-- answer is for. What none of them did was check that the caller is entitled to the review
-- they named. Any authenticated user holding a review id got the score, the ranked
-- weaknesses and the two sides' disagreements for it.
--
-- A review id is a uuid and not guessable, and the only way to obtain one is through
-- kpi_reviews, which is RLS'd. So this is not "anyone can read anyone's review" today. It
-- is a function whose only access control is that its argument is hard to guess, which is
-- the same shape as the unguarded definers migration 33 went through the schema removing.
-- The fix is the one the rest of the system already uses: ask the same question RLS asks.
--
-- ── 2. Opening a cycle did not create any scorecard lines ──────────────────
--
-- open_kpi_review_cycle creates one kpi_review per active employee and stops. The custom
-- scorecard lines underneath it were only ever created by calling kpi_generate_review_lines
-- by hand, so in practice a freshly opened quarter had no criteria in it and the new review
-- screen would have been empty for everybody. Seeding is now part of opening.
--
-- Employees with no approved scorecard are skipped rather than blocking the cycle: on the
-- day a company turns this on, most people will not have one yet, and a quarter that cannot
-- open until every scorecard is signed off is a quarter that never opens. The return value
-- says how many got lines so HR can see the gap instead of discovering it later.

-- ── May I see this review? ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kpi_review_is_visible(p_review_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM kpi_reviews r
     WHERE r.id = p_review_id
       AND r.company_id = get_user_company_id((SELECT auth.uid()))
       AND (
         -- The person being reviewed.
         EXISTS (SELECT 1 FROM employees e
                  WHERE e.id = r.employee_id AND e.user_id = (SELECT auth.uid()))
         -- Whoever manages them, by the rule migration 44 settled.
         OR public.kpi_manages_employee(r.employee_id)
         -- read_only exists so an auditor or accountant can see the company without
         -- touching it, and kpi_reviews_select already grants them the row.
         OR get_user_role((SELECT auth.uid())) = 'read_only'
       )
  );
$function$;

COMMENT ON FUNCTION public.kpi_review_is_visible(uuid) IS
  'The same question kpi_reviews_select asks, in a form the SECURITY DEFINER report functions can call.';

REVOKE EXECUTE ON FUNCTION public.kpi_review_is_visible(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_review_is_visible(uuid) TO authenticated;

-- ── The three report functions ─────────────────────────────────────────────
-- Each gains one predicate. An unauthorised caller now gets an empty answer rather than
-- somebody else's: no rows from the two list functions, and nulls from the score.
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
  WHERE review_id = p_review_id
    AND public.kpi_review_is_visible(p_review_id);
$function$;

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
           CASE WHEN l.final_level < 3 THEN 3
                WHEN l.final_level < 5 THEN (l.final_level + 1)
                END::smallint AS target_level,
           CASE WHEN l.final_level < 3 THEN 'shortfall' ELSE 'upside' END AS band
      FROM kpi_review_lines l
     WHERE l.review_id = p_review_id
       AND l.final_level IS NOT NULL
       AND public.kpi_review_is_visible(p_review_id)
  )
  SELECT s.definition_id,
         s.definition_name,
         s.weight,
         s.final_level,
         s.target_level,
         s.band,
         round((public.kpi_level_points(s.target_level) - public.kpi_level_points(s.final_level))
               * s.weight / t.w, 2) AS points_at_stake,
         (SELECT a.comment FROM kpi_anchors a
           WHERE a.definition_id = s.definition_id AND a.level = s.target_level AND a.active
           ORDER BY a.sort_order, a.created_at LIMIT 1) AS target_anchor
    FROM scored s CROSS JOIN total t
   WHERE s.target_level IS NOT NULL
   ORDER BY CASE s.band WHEN 'shortfall' THEN 0 ELSE 1 END,
            points_at_stake DESC,
            s.definition_name;
$function$;

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
     AND public.kpi_review_is_visible(p_review_id)
   ORDER BY abs(l.self_level - l.manager_level) DESC, l.definition_name;
$function$;

-- ── Generating lines is a write, so it asks the stronger question ──────────
-- Seeing a review is not the same as opening one: an employee may read their own lines,
-- but creating them is the manager's or HR's act.
--
-- Split in two, because the permission check has one legitimate exception. When HR opens a
-- quarter they are acting as the system, not as anybody's rater — and HR does not manage
-- themselves (migration 44), so a single checked function would silently skip the HR
-- manager's own scorecard every time they opened a cycle. The seeder below carries no
-- grant to authenticated at all; the only ways in are the checked wrapper and the cycle
-- opener, both of which have already asked their own question.
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

REVOKE EXECUTE ON FUNCTION public.kpi_seed_review_lines(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kpi_generate_review_lines(p_review_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_employee uuid;
BEGIN
  SELECT employee_id INTO v_employee FROM kpi_reviews WHERE id = p_review_id;
  IF v_employee IS NULL THEN
    RAISE EXCEPTION 'No such review' USING ERRCODE = 'P0001';
  END IF;

  -- auth.uid() is NULL only for maintenance running as the schema itself.
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.kpi_manages_employee(v_employee) THEN
    RAISE EXCEPTION 'You can only open a review for someone you manage.' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.kpi_seed_review_lines(p_review_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_generate_review_lines(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_generate_review_lines(uuid) TO authenticated;

-- ── Opening a quarter seeds the scorecards it can ──────────────────────────
CREATE OR REPLACE FUNCTION public.open_kpi_review_cycle(
  p_year integer, p_quarter integer,
  p_self_due date DEFAULT NULL, p_manager_due date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_company uuid; v_emp uuid; v_cycle uuid; v_n integer;
  v_with_scorecard integer := 0;
  r record;
BEGIN
  IF get_user_role(v_uid) NOT IN ('super_admin','hr_manager') THEN
    RAISE EXCEPTION 'Only HR or super admin can open a review cycle';
  END IF;
  IF p_quarter NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Quarter must be 1-4';
  END IF;
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

  -- One review at a time, because the ones that fail are the point: an employee with no
  -- approved scorecard, or one whose weights no longer total 100, is skipped and the rest
  -- of the company still opens.
  FOR r IN SELECT id FROM kpi_reviews WHERE cycle_id = v_cycle LOOP
    BEGIN
      IF kpi_seed_review_lines(r.id) > 0 THEN
        v_with_scorecard := v_with_scorecard + 1;
      END IF;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;

  RETURN jsonb_build_object('cycle_id', v_cycle, 'status', 'self_review',
                            'employees', v_n, 'scorecards', v_with_scorecard);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.open_kpi_review_cycle(integer, integer, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.open_kpi_review_cycle(integer, integer, date, date) TO authenticated;
