-- ═══════════════════════════════════════════════════════════════════════════
-- BYOND — database guarantee suite
--
-- Every assertion here corresponds to a rule that has real consequences: pay,
-- discipline, or who can see whose salary. Each one was verified by hand once;
-- this file is what stops a future migration undoing it silently.
--
-- HOW TO RUN
--
--   psql -v ON_ERROR_STOP=1 "$PGURL" -f supabase/tests/guarantees.sql
--
-- or paste it into the Supabase SQL editor — it contains no psql-only
-- meta-commands, so it works over any driver. ON_ERROR_STOP is passed on the
-- command line rather than set in the file so that CI gets a non-zero exit
-- while the editor still accepts the same text. It is wrapped in a transaction that
-- always rolls back, so it is safe against any database including production —
-- it writes probe rows, asserts, and discards everything.
--
-- It exits non-zero if any assertion fails, so CI can gate on it.
--
-- FIXTURES
--
-- The suite resolves its own test subjects by role rather than hardcoding IDs,
-- so it runs against any environment. It needs one company containing an
-- `employee`, an `hr_manager` and a `department_manager`. If those are missing
-- it says so instead of reporting false passes.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE t(n int, area text, name text, expected text, actual text);

CREATE OR REPLACE FUNCTION pg_temp.chk(n int, area text, nm text, e text, a text)
RETURNS void LANGUAGE sql AS $f$ INSERT INTO t VALUES (n, area, nm, e, a); $f$;

-- `SET LOCAL ROLE` is undone by RESET ROLE, but request.jwt.claims is NOT — it
-- is transaction-scoped and survives, so auth.uid() keeps returning the
-- impersonated user and later statements silently run as the wrong person.
-- Every impersonation must clear both. (This cost a debugging cycle to find.)
CREATE OR REPLACE FUNCTION pg_temp.as_nobody() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END $f$;

-- ── Resolve fixtures ────────────────────────────────────────────────────────
CREATE TEMP TABLE fx AS
SELECT
  (SELECT e.company_id FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'employee' AND e.status = 'active' LIMIT 1)          AS company_id,
  (SELECT e.id      FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'employee' AND e.status = 'active' LIMIT 1)          AS emp_id,
  (SELECT e.user_id FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'employee' AND e.status = 'active' LIMIT 1)          AS emp_uid,
  (SELECT e.user_id FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'hr_manager' LIMIT 1)                               AS hr_uid,
  (SELECT e.id      FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'hr_manager' LIMIT 1)                               AS hr_emp_id;

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  IF f.emp_id IS NULL OR f.hr_uid IS NULL THEN
    RAISE EXCEPTION 'FIXTURES MISSING: need one active `employee` and one `hr_manager` in the same database. Suite cannot run.';
  END IF;
END $$;

-- ═══ 1. Privilege surface — migration 09 ═══════════════════════════════════
-- RLS governs SELECT/INSERT/UPDATE/DELETE. It does NOT govern TRUNCATE, so a
-- TRUNCATE grant to a client role is data destruction no policy can stop.

SELECT pg_temp.chk(1,'grants','anon holds no SELECT on any table','0',
  (SELECT count(*)::text FROM information_schema.table_privileges
   WHERE table_schema='public' AND grantee='anon' AND privilege_type='SELECT'));

SELECT pg_temp.chk(2,'grants','anon INSERT limited to demo_requests','demo_requests',
  coalesce((SELECT string_agg(table_name,',' ORDER BY table_name)
    FROM information_schema.table_privileges
    WHERE table_schema='public' AND grantee='anon' AND privilege_type='INSERT'),'(none)'));

SELECT pg_temp.chk(3,'grants','no TRUNCATE for anon or authenticated','0',
  (SELECT count(*)::text FROM information_schema.table_privileges
   WHERE table_schema='public' AND grantee IN ('anon','authenticated')
     AND privilege_type='TRUNCATE'));

SELECT pg_temp.chk(4,'grants','no TRIGGER grant for anon or authenticated','0',
  (SELECT count(*)::text FROM information_schema.table_privileges
   WHERE table_schema='public' AND grantee IN ('anon','authenticated')
     AND privilege_type='TRIGGER'));

SELECT pg_temp.chk(5,'rls','every table has RLS enabled','0 without',
  (SELECT count(*)::text||' without' FROM pg_class c
   JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity));

SELECT pg_temp.chk(6,'rls','every table has at least one policy','0 without',
  (SELECT count(*)::text||' without' FROM (
     SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
     WHERE ns.nspname='public' AND c.relkind='r'
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                       WHERE p.schemaname='public' AND p.tablename=c.relname)) x));

-- ═══ 2. Attendance integrity — migrations 02, 04 ═══════════════════════════
-- attendance.status feeds 30% of the KPI and overtime_hours feeds payroll, so
-- an employee must not be able to move either on their own record.

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  INSERT INTO attendance (company_id, employee_id, date, clock_in, status)
  VALUES (f.company_id, f.emp_id, '2026-03-02', '2026-03-02T06:00:00Z', 'late_major');

  PERFORM pg_temp.as_user(f.emp_uid);
  BEGIN
    UPDATE attendance SET status='present', overtime_hours=8, overtime_approved=true
     WHERE employee_id=f.emp_id AND date='2026-03-02';
  EXCEPTION WHEN others THEN NULL;
  END;
  PERFORM pg_temp.as_nobody();
END $$;

SELECT pg_temp.chk(7,'attendance','employee cannot rewrite own lateness','late_major',
  (SELECT status FROM attendance WHERE employee_id=(SELECT emp_id FROM fx) AND date='2026-03-02'));

-- The guard reverts to the PRIOR value (0.00 from the column default), so the
-- guarantee is that the self-awarded 8 does not stick — not that it becomes NULL.
SELECT pg_temp.chk(8,'attendance','self-awarded overtime of 8 does not stick','0.00|false',
  (SELECT overtime_hours::text||'|'||overtime_approved::text FROM attendance
   WHERE employee_id=(SELECT emp_id FROM fx) AND date='2026-03-02'));

-- The regression that mattered: overtime was once computed as
-- clock_out - scheduled_end, so a four-second punch earned 6.90 hours.
DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  INSERT INTO attendance (company_id, employee_id, date, clock_in, clock_out, status)
  VALUES (f.company_id, f.hr_emp_id, '2026-03-03',
          '2026-03-03T19:54:02Z', '2026-03-03T19:54:06Z', 'present');
END $$;

SELECT pg_temp.chk(9,'attendance','four-second punch earns no overtime','0.00',
  (SELECT overtime_hours::text FROM attendance
   WHERE employee_id=(SELECT hr_emp_id FROM fx) AND date='2026-03-03'));

-- 10:30Z is 14:30 in Asia/Dubai; against a 17:00 finish that is 150 minutes.
DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  INSERT INTO attendance (company_id, employee_id, date, clock_in, clock_out, status)
  VALUES (f.company_id, f.emp_id, '2026-03-04',
          '2026-03-04T04:05:00Z', '2026-03-04T10:30:00Z', 'present');
END $$;

SELECT pg_temp.chk(10,'attendance','early departure measured in minutes','150',
  (SELECT early_minutes::text FROM attendance
   WHERE employee_id=(SELECT emp_id FROM fx) AND date='2026-03-04'));

-- ═══ 3. Leave — migration 03 ═══════════════════════════════════════════════
-- One live balance reached entitled 21 / used 34 because nothing checked, and
-- both clients maintained used_days with a browser read-then-write.

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  INSERT INTO leave_balances (employee_id, company_id, leave_type, year, entitled_days, used_days)
  VALUES (f.emp_id, f.company_id, 'annual', 2026, 21, 0)
  ON CONFLICT DO NOTHING;

  PERFORM pg_temp.as_user(f.emp_uid);
  BEGIN
    INSERT INTO leave_requests (company_id, employee_id, leave_type, start_date, end_date,
                                days_requested, status)
    VALUES (f.company_id, f.emp_id, 'annual', '2026-09-01', '2026-10-02', 32, 'pending');
    PERFORM pg_temp.as_nobody();
    INSERT INTO t VALUES (11,'leave','32 days against a 21-day entitlement refused','refused','ACCEPTED');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.as_nobody();
    INSERT INTO t VALUES (11,'leave','32 days against a 21-day entitlement refused','refused','refused');
  END;
END $$;

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  INSERT INTO leave_requests (id, company_id, employee_id, leave_type, start_date, end_date,
                              days_requested, status)
  VALUES ('22222222-2222-2222-2222-222222222222', f.company_id, f.emp_id,
          'annual', '2026-09-01', '2026-09-05', 5, 'pending');
END $$;

SELECT pg_temp.chk(12,'leave','balance holds days on submit','5',
  (SELECT used_days::text FROM leave_balances
   WHERE employee_id=(SELECT emp_id FROM fx) AND leave_type='annual' AND year=2026));

UPDATE leave_requests SET status='rejected' WHERE id='22222222-2222-2222-2222-222222222222';

SELECT pg_temp.chk(13,'leave','balance releases days on reject','0',
  (SELECT used_days::text FROM leave_balances
   WHERE employee_id=(SELECT emp_id FROM fx) AND leave_type='annual' AND year=2026));

-- ═══ 4. KPI — migrations 01, 06, 07, 08 ════════════════════════════════════
-- apply_kpi_adjustment once wrote rating and bonus_eligible directly, so a
-- single award on an empty month produced bonus eligibility on no evidence.

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  INSERT INTO kpi_adjustments (company_id, employee_id, issued_by, type, reward_type,
         points_adjustment, reason, period_year, period_month)
  VALUES (f.company_id, f.emp_id, f.hr_emp_id, 'reward', 'employee_of_month',
          10, 'guarantee suite probe', 2026, 11);
END $$;

SELECT pg_temp.chk(14,'kpi','award on an unevaluated month earns no rating or bonus','none|false',
  (SELECT coalesce(rating,'none')||'|'||bonus_eligible::text FROM kpi_scores
   WHERE employee_id=(SELECT emp_id FROM fx) AND period_year=2026 AND period_month=11));

SELECT pg_temp.chk(15,'kpi','adjustment leaves behavior_score untouched','null',
  (SELECT coalesce(behavior_score::text,'null') FROM kpi_scores
   WHERE employee_id=(SELECT emp_id FROM fx) AND period_year=2026 AND period_month=11));

-- Approved leave must not move a performance score at all (handbook Art. 5).
SELECT pg_temp.chk(16,'kpi','approved absence not priced in the point table','absent',
  (SELECT CASE WHEN attendance_point_values ? 'absent_approved' THEN 'present' ELSE 'absent' END
   FROM kpi_settings WHERE company_id=(SELECT company_id FROM fx)));

-- A month with nothing to score is "not evaluated", not a hard zero on 30%.
SELECT pg_temp.chk(17,'kpi','month with no attendance scores NULL not 0','null',
  coalesce(public.calculate_attendance_score(
    (SELECT emp_id FROM fx), 2019, 1, (SELECT company_id FROM fx))::text, 'null'));

-- ═══ 5. Review cycle stages — migration 08 ═════════════════════════════════
-- RLS decides which rows; the guard decides which columns and when. Without it
-- "employee rates, then manager rates" is a label on a status field.

DO $$
DECLARE f record; c uuid;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.as_user(f.hr_uid);
  c := ((public.open_kpi_review_cycle(2026, 4))->>'cycle_id')::uuid;
  PERFORM pg_temp.as_nobody();

  PERFORM pg_temp.as_user(f.emp_uid);
  BEGIN
    UPDATE kpi_reviews
       SET self_score=90, manager_score=100, final_score=99,
           rating='Exceptional', bonus_eligible=true
     WHERE employee_id=f.emp_id AND cycle_id=c;
  EXCEPTION WHEN others THEN NULL;
  END;
  PERFORM pg_temp.as_nobody();
EXCEPTION WHEN others THEN
  PERFORM pg_temp.as_nobody();
  INSERT INTO t VALUES (18,'review','self score sticks; manager and result fields do not',
                        '90.00|null|null', 'SETUP FAILED: '||SQLERRM);
END $$;

SELECT pg_temp.chk(18,'review','self score sticks; manager and result fields do not',
  '90.00|null|null',
  coalesce((SELECT self_score::text||'|'||coalesce(manager_score::text,'null')
                   ||'|'||coalesce(rating,'null')
            FROM kpi_reviews WHERE employee_id=(SELECT emp_id FROM fx)
            ORDER BY created_at DESC LIMIT 1), 'no review row'))
WHERE NOT EXISTS (SELECT 1 FROM t WHERE n=18);

-- ═══ 6. Rules automation — migration 10 ════════════════════════════════════
-- evaluate_kpi_rules() resolves the company from auth.uid(). A cron job has no
-- session, so it raised 'Not authenticated' and would have silently done
-- nothing every month.

DO $$
BEGIN
  PERFORM public.evaluate_kpi_rules_all_companies(2026, 6);
  INSERT INTO t VALUES (19,'automation','rules engine runs with no session','works','works');
EXCEPTION WHEN others THEN
  INSERT INTO t VALUES (19,'automation','rules engine runs with no session','works','FAILS: '||SQLERRM);
END $$;

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.as_user(f.emp_uid);
  BEGIN
    PERFORM public.evaluate_kpi_rules_for_company(f.company_id, 2026, 6);
    PERFORM pg_temp.as_nobody();
    INSERT INTO t VALUES (20,'automation','employee cannot call the internal rules function','blocked','ALLOWED');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.as_nobody();
    INSERT INTO t VALUES (20,'automation','employee cannot call the internal rules function','blocked','blocked');
  END;
END $$;

-- Warnings must never be auto-issued; they are proposals for HR to approve.
SELECT pg_temp.chk(21,'automation','no rule issues a warning directly as an adjustment','0',
  (SELECT count(*)::text FROM kpi_adjustments WHERE source='rule' AND type='warning'));

-- The monthly job must actually be scheduled.
SELECT pg_temp.chk(22,'automation','monthly rules job scheduled and active','0 2 1 * *|true',
  coalesce((SELECT schedule||'|'||active::text FROM cron.job WHERE jobname='monthly-kpi-rules'),
           'not scheduled'));

-- ═══ Report ════════════════════════════════════════════════════════════════

SELECT n, area, name,
       CASE WHEN actual = expected THEN 'PASS' ELSE 'FAIL' END AS verdict,
       CASE WHEN actual = expected THEN '' ELSE 'expected ['||expected||'] got ['||actual||']' END AS detail
FROM t ORDER BY n;

DO $$
DECLARE v_fail int; v_total int;
BEGIN
  SELECT count(*) FILTER (WHERE actual <> expected), count(*) INTO v_fail, v_total FROM t;
  RAISE NOTICE '% of % assertions passed', v_total - v_fail, v_total;
  IF v_fail > 0 THEN
    RAISE EXCEPTION '% guarantee(s) FAILED — see the table above', v_fail;
  END IF;
END $$;

-- Nothing this suite wrote is kept.
ROLLBACK;
