-- Before HR moves a quarterly review on, say who has not finished — by name.
--
-- Every stage transition closes the one before it for good: advancing out of self-review
-- locks everyone's self-assessment, advancing out of manager review calculates the
-- quarter with whatever is there. The Review Cycles screen showed a count ("3 employee(s)
-- have no manager score yet") and nothing else, so HR could not tell whether that was one
-- manager on holiday or three people nobody manages — the two need different answers.
--
-- review_cycle_readiness() answers it for the confirmation dialog: who has not
-- self-assessed (and which of them cannot, having no login), each manager with their
-- unfinished people, the people no manager covers (HR's to rate), and at the calculated
-- stage who is about to be published without a rating. remind_review_stragglers() sends
-- a nudge to exactly those people from the same dialog.
--
-- Both are HR-only and company-scoped, and both check that inside the function — they are
-- SECURITY DEFINER because "which manager covers whom" is manager_covers(), which HR's own
-- row access does not express.

CREATE OR REPLACE FUNCTION public.review_cycle_readiness(p_cycle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_company uuid;
  v_c       record;
  v_out     jsonb;
BEGIN
  IF get_user_role(v_uid) NOT IN ('super_admin', 'hr_manager') THEN
    RAISE EXCEPTION 'Only HR or super admin can check a review cycle';
  END IF;
  v_company := get_user_company_id(v_uid);
  SELECT * INTO v_c FROM kpi_review_cycles WHERE id = p_cycle_id AND company_id = v_company;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'Review cycle not found'; END IF;

  WITH r AS (
    SELECT rv.id, rv.employee_id, e.full_name,
           (e.user_id IS NOT NULL AND e.status = 'active') AS can_login,
           rv.self_submitted_at IS NOT NULL AS self_done,
           rv.manager_submitted_at IS NOT NULL AS mgr_done,
           rv.rating, rv.coverage_pct
      FROM kpi_reviews rv JOIN employees e ON e.id = rv.employee_id
     WHERE rv.cycle_id = p_cycle_id
  ),
  mgrs AS (
    SELECT m.id, m.full_name
      FROM employees m
      JOIN user_roles ur ON ur.user_id = m.user_id AND ur.role = 'department_manager'
     WHERE m.company_id = v_company AND m.status = 'active'
  ),
  cover AS (
    SELECT r.id AS review_id, mg.id AS mgr_id, mg.full_name AS mgr_name
      FROM r JOIN mgrs mg ON public.manager_covers(mg.id, r.employee_id)
  ),
  per_mgr AS (
    SELECT c.mgr_name,
           count(*) AS total,
           count(*) FILTER (WHERE NOT r.mgr_done) AS pending,
           jsonb_agg(r.full_name ORDER BY r.full_name) FILTER (WHERE NOT r.mgr_done) AS pending_names
      FROM cover c JOIN r ON r.id = c.review_id
     GROUP BY c.mgr_id, c.mgr_name
  )
  SELECT jsonb_build_object(
    'status',       v_c.status,
    'period',       format('%s Q%s', v_c.period_year, v_c.period_quarter),
    'self_due',     v_c.self_due,
    'manager_due',  v_c.manager_due,
    'total',        (SELECT count(*) FROM r),
    'self_missing', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', full_name, 'can_login', can_login)
                                               ORDER BY can_login DESC, full_name), '[]'::jsonb)
                       FROM r WHERE NOT self_done),
    'managers',     (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', mgr_name, 'total', total,
                                                                  'pending', pending, 'names', pending_names)
                                               ORDER BY pending DESC, mgr_name), '[]'::jsonb)
                       FROM per_mgr WHERE pending > 0),
    'no_manager',   (SELECT COALESCE(jsonb_agg(full_name ORDER BY full_name), '[]'::jsonb)
                       FROM r WHERE NOT mgr_done
                        AND NOT EXISTS (SELECT 1 FROM cover c WHERE c.review_id = r.id)),
    'unrated',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', full_name, 'coverage', coverage_pct)
                                               ORDER BY full_name), '[]'::jsonb)
                       FROM r WHERE rating IS NULL)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

-- A nudge from HR, now, to exactly the people holding the current step up.
CREATE OR REPLACE FUNCTION public.remind_review_stragglers(p_cycle_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_company uuid;
  v_c       record;
  v_p       text;
  v_n       integer := 0;
  r         record;
BEGIN
  IF get_user_role(v_uid) NOT IN ('super_admin', 'hr_manager') THEN
    RAISE EXCEPTION 'Only HR or super admin can send review reminders';
  END IF;
  v_company := get_user_company_id(v_uid);
  SELECT * INTO v_c FROM kpi_review_cycles WHERE id = p_cycle_id AND company_id = v_company;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'Review cycle not found'; END IF;
  v_p := format('%s Q%s', v_c.period_year, v_c.period_quarter);

  IF v_c.status = 'self_review' THEN
    FOR r IN SELECT rv.employee_id FROM kpi_reviews rv
              WHERE rv.cycle_id = p_cycle_id AND rv.self_submitted_at IS NULL LOOP
      IF notify_employee(v_company, r.employee_id, 'review_self_due',
           format('HR is waiting on your %s self-assessment', v_p),
           'Self-assessment is about to close. After that you can''t rate yourself until next quarter.',
           '/kpi', 'kpi_review_cycles', p_cycle_id, '12 hours') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    END LOOP;

  ELSIF v_c.status = 'manager_review' THEN
    FOR r IN
      SELECT mgr.id AS mgr_emp, count(*) AS n,
             string_agg(e.full_name, ', ' ORDER BY e.full_name) AS names
        FROM kpi_reviews rv
        JOIN employees e ON e.id = rv.employee_id
        JOIN employees mgr ON mgr.company_id = v_company AND mgr.status = 'active' AND mgr.user_id IS NOT NULL
        JOIN user_roles ur ON ur.user_id = mgr.user_id AND ur.role = 'department_manager'
       WHERE rv.cycle_id = p_cycle_id AND rv.manager_submitted_at IS NULL
         AND public.manager_covers(mgr.id, rv.employee_id)
       GROUP BY mgr.id
    LOOP
      IF notify_employee(v_company, r.mgr_emp, 'review_manager_due',
           format('HR is waiting on %s %s review%s', r.n, v_p, CASE WHEN r.n = 1 THEN '' ELSE 's' END),
           format('Still to rate: %s. The quarter is about to be calculated — anyone left blank is scored on less of their work.', r.names),
           '/kpi', 'kpi_review_cycles', p_cycle_id, '12 hours') IS NOT NULL THEN
        v_n := v_n + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_cycle_readiness(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remind_review_stragglers(uuid)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_cycle_readiness(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.remind_review_stragglers(uuid) TO authenticated;
