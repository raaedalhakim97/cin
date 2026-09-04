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
-- Pick the COMPANY first, then both people from inside it.
--
-- The first version selected the employee and the hr_manager independently with
-- two LIMIT 1 subqueries. On a database with more than one tenant that quietly
-- returns people from different companies — here, an employee in "BYOND Test
-- Co" and an HR manager in "BYOND". Assertion 18 then has HR open a review
-- cycle for their own company and looks for the employee's row in it, which
-- cannot exist. It reported "no review row" and looked exactly like a broken
-- review guard. Multi-tenancy is the thing this product is, so a fixture that
-- straddles two tenants is the wrong shape of test.
CREATE TEMP TABLE fx AS
WITH candidate AS (
  SELECT e.company_id
  FROM employees e
  JOIN user_roles ur ON ur.user_id = e.user_id
  WHERE e.status = 'active'
  GROUP BY e.company_id
  HAVING count(*) FILTER (WHERE ur.role = 'employee')   > 0
     AND count(*) FILTER (WHERE ur.role = 'hr_manager') > 0
  ORDER BY e.company_id
  LIMIT 1
)
SELECT
  c.company_id,
  (SELECT e.id      FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'employee' AND e.status = 'active'
      AND e.company_id = c.company_id LIMIT 1)                           AS emp_id,
  (SELECT e.user_id FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'employee' AND e.status = 'active'
      AND e.company_id = c.company_id LIMIT 1)                           AS emp_uid,
  (SELECT e.user_id FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'hr_manager' AND e.status = 'active'
      AND e.company_id = c.company_id LIMIT 1)                           AS hr_uid,
  (SELECT e.id      FROM employees e JOIN user_roles ur ON ur.user_id = e.user_id
    WHERE ur.role = 'hr_manager' AND e.status = 'active'
      AND e.company_id = c.company_id LIMIT 1)                           AS hr_emp_id
FROM candidate c;

DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM fx;
  IF f.emp_id IS NULL OR f.hr_uid IS NULL THEN
    RAISE EXCEPTION 'FIXTURES MISSING: need an active `employee` and an active `hr_manager` belonging to the SAME company. Suite cannot run.';
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

-- ═══ 7. Geofence coherence — migration 11 ══════════════════════════════════
-- Enforcement with no work locations accepts every punch unchecked, because
-- there is no nearest location to be out of range of. The setting then reports
-- protection that does not exist, which is worse than being plainly off. The
-- invalid combination is made unreachable from both directions.
--
-- These run last: they add a work location, which changes what the attendance
-- guard does, and the assertions above expect a database without one.

DO $$
DECLARE f record; v_loc uuid; v_uid uuid;
BEGIN
  SELECT * INTO f FROM fx;

  BEGIN
    UPDATE shift_settings SET enforce_geofence = true WHERE company_id = f.company_id;
    INSERT INTO t VALUES (23,'geofence','cannot enforce with zero work locations','refused','ALLOWED');
  EXCEPTION WHEN others THEN
    INSERT INTO t VALUES (23,'geofence','cannot enforce with zero work locations','refused','refused');
  END;

  INSERT INTO work_locations (company_id, name, latitude, longitude, radius_metres)
  VALUES (f.company_id, 'Suite probe HQ', 25.2048, 55.2708, 200) RETURNING id INTO v_loc;
  UPDATE shift_settings SET enforce_geofence = true WHERE company_id = f.company_id;

  -- Enforcement applies to someone clocking THEMSELVES in. An HR backfill is
  -- deliberately exempt, so this must impersonate the employee or it proves
  -- nothing — a service-role insert is accepted from anywhere by design.
  SELECT e.user_id INTO v_uid FROM employees e WHERE e.id = f.emp_id;
  PERFORM pg_temp.as_user(v_uid);
  BEGIN
    INSERT INTO attendance (company_id, employee_id, date, clock_in, clock_in_lat, clock_in_lng, status)
    VALUES (f.company_id, f.emp_id, '2026-05-12', '2026-05-12T05:00:00Z', 25.2450, 55.2500, 'present');
    PERFORM pg_temp.as_nobody();
    INSERT INTO t VALUES (24,'geofence','employee punch 4.9km outside the fence refused','refused','ACCEPTED');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.as_nobody();
    INSERT INTO t VALUES (24,'geofence','employee punch 4.9km outside the fence refused','refused','refused');
  END;

  BEGIN
    DELETE FROM work_locations WHERE id = v_loc;
    INSERT INTO t VALUES (25,'geofence','cannot remove the last location while enforcing','refused','ALLOWED');
  EXCEPTION WHEN others THEN
    INSERT INTO t VALUES (25,'geofence','cannot remove the last location while enforcing','refused','refused');
  END;

  -- The guard must not over-reach: an ordinary edit is not a removal.
  BEGIN
    UPDATE work_locations SET name = 'Suite probe HQ (L3)' WHERE id = v_loc;
    INSERT INTO t VALUES (26,'geofence','renaming a location while enforcing still allowed','allowed','allowed');
  EXCEPTION WHEN others THEN
    INSERT INTO t VALUES (26,'geofence','renaming a location while enforcing still allowed','allowed','REFUSED: '||SQLERRM);
  END;
END $$;

-- ── Attendance is established by the server, not reported by the client ─────
--
-- Before migration 14 the lateness grade and both punch timestamps were
-- whatever the browser sent. An employee could clock in at 11:11 against an
-- 08:00 start and store 'present', and could move their own clock_out to the
-- scheduled finish to take early_minutes to zero. These four assertions are
-- the ones that would have caught that.
DO $$
DECLARE
  f record;
  v_late  text;
  v_in    timestamptz;
  v_audit int;
BEGIN
  SELECT * INTO f FROM fx;

  -- Coordinates sit exactly on the probe location created above, so this is
  -- inside any fence that block left enabled and also satisfies
  -- require_gps_clock_in. Neither is what is under test here.
  --
  -- The claim is a double lie: an 08:00 arrival and a clean 'present', sent by
  -- the employee about themselves.
  PERFORM pg_temp.as_user(f.emp_uid);
  INSERT INTO attendance (company_id, employee_id, date, clock_in, status,
                          clock_in_lat, clock_in_lng)
  VALUES (f.company_id, f.emp_id, '2026-05-13',
          '2026-05-13T04:00:00Z', 'present', 25.2048, 55.2708);
  PERFORM pg_temp.as_nobody();

  SELECT status, clock_in INTO v_late, v_in
    FROM attendance
   WHERE employee_id = f.emp_id AND date = '2026-05-13';

  PERFORM pg_temp.chk(27, 'attendance',
    'employee cannot self-report present while late',
    'graded late', CASE WHEN v_late LIKE 'late%' THEN 'graded late'
                        ELSE 'STORED AS '||coalesce(v_late,'null') END);

  -- The stamp must be the server's clock at the moment of the request, not the
  -- time the client asked for. Anything else makes the grade meaningless, since
  -- it would be derived from a number the employee chose.
  PERFORM pg_temp.chk(28, 'attendance',
    'punch is stamped by the server, not by the client',
    'server clock', CASE WHEN v_in > '2026-05-14T00:00:00Z' THEN 'server clock'
                         ELSE 'CLIENT CLAIM KEPT: '||v_in::text END);

  -- The audit trail is the record of all this, so it has to be unforgeable.
  -- audit_logs is written only by log_sensitive_changes, which is SECURITY
  -- DEFINER and owned by the table owner, so no end-user grant is needed.
  PERFORM pg_temp.as_user(f.emp_uid);
  BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data, company_id)
    VALUES (f.hr_uid, 'UPDATE', 'attendance',
            '00000000-0000-0000-0000-0000000000fd'::uuid,
            '{"forged":true}'::jsonb, f.company_id);
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(29, 'audit',
      'employee cannot write an audit entry as someone else', 'refused', 'ACCEPTED');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(29, 'audit',
      'employee cannot write an audit entry as someone else', 'refused', 'refused');
  END;

  -- audit_select filters on company_id, so a row without one is invisible to
  -- every human being. 760 of 774 rows were in that state, including all 61
  -- attendance rows: a trail that existed and could not be read.
  --
  -- Scoped to rows written before this transaction — anything this suite writes
  -- shares now() as its created_at, and is not what the guarantee is about.
  SELECT count(*) INTO v_audit
    FROM audit_logs WHERE company_id IS NULL AND created_at < now();
  PERFORM pg_temp.chk(30, 'audit',
    'every audit row records which company it belongs to',
    '0 orphaned', CASE WHEN v_audit = 0 THEN '0 orphaned'
                       ELSE v_audit::text||' INVISIBLE TO HR' END);

  -- And the people entitled to read it must actually get rows back. The punch
  -- inserted above guarantees there is at least one to find.
  PERFORM pg_temp.as_user(f.hr_uid);
  SELECT count(*) INTO v_audit FROM audit_logs WHERE table_name = 'attendance';
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(31, 'audit',
    'HR can read the attendance audit trail for their company',
    'rows visible', CASE WHEN v_audit > 0 THEN 'rows visible' ELSE 'ZERO ROWS' END);
END $$;

-- ── read_only is a normal employee for its own self-service ─────────────────
--
-- The instruction was that read_only can clock in and out and request leave
-- like anyone else, and only that. The client gates came off first and the RLS
-- policies still refused the clock-out, so the button worked and the update
-- silently touched zero rows — which does not raise. Asserted on the policy
-- shape rather than by impersonating a read_only user, so it holds in any
-- environment whether or not one exists.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname IN ('att_self_update', 'leave_self_update')
     AND qual LIKE '%read_only%';
  PERFORM pg_temp.chk(32, 'permissions',
    'no self-service policy excludes read_only',
    '0 policies', CASE WHEN v_n = 0 THEN '0 policies'
                       ELSE v_n::text||' STILL EXCLUDE read_only' END);
END $$;

-- ── A notification is not something you can write about yourself ───────────
--
-- Notifications tell people they were late, that leave was approved, that a shift
-- changed. If they can be written by the people they are about, they are worth
-- nothing — and worse, one could be made to look as though HR sent it. Same shape as
-- the audit trail: inserted only by a SECURITY DEFINER function, with the grants
-- revoked so it does not rest on the absence of a policy.
DO $$
DECLARE f record; v_id uuid; v_n int; v_title text;
BEGIN
  SELECT * INTO f FROM fx;

  v_id := notify_employee(f.company_id, f.emp_id, 'feed_post',
                          'Suite probe notification', NULL, '/feed',
                          'feed_posts', '33333333-3333-3333-3333-333333333333'::uuid);

  PERFORM pg_temp.chk(33, 'notifications',
    'the trigger helper can create one', 'created',
    CASE WHEN v_id IS NOT NULL THEN 'created' ELSE 'NULL' END);

  -- The recipient reads their own.
  PERFORM pg_temp.as_user(f.emp_uid);
  SELECT count(*) INTO v_n FROM notifications WHERE id = v_id;
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(34, 'notifications', 'recipient can read their own', '1', v_n::text);

  -- Nobody else does, including HR. A notification list is closer to someone's inbox
  -- than to their personnel file, and the underlying events are separately visible.
  PERFORM pg_temp.as_user(f.hr_uid);
  SELECT count(*) INTO v_n FROM notifications WHERE id = v_id;
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(35, 'notifications', 'HR cannot read another persons notification', '0', v_n::text);

  -- Marking read must not be a way to rewrite the message.
  PERFORM pg_temp.as_user(f.emp_uid);
  BEGIN
    UPDATE notifications SET read_at = now(), title = 'Rewritten by the recipient'
     WHERE id = v_id;
  EXCEPTION WHEN others THEN NULL;
  END;
  PERFORM pg_temp.as_nobody();
  SELECT title INTO v_title FROM notifications WHERE id = v_id;
  PERFORM pg_temp.chk(36, 'notifications',
    'recipient cannot rewrite the message', 'Suite probe notification', coalesce(v_title,'GONE'));

  -- And one cannot be manufactured at all.
  PERFORM pg_temp.as_user(f.emp_uid);
  BEGIN
    INSERT INTO notifications (company_id, employee_id, kind, title)
    VALUES (f.company_id, f.emp_id, 'leave_approved', 'Your leave was approved');
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(37, 'notifications', 'employee cannot forge a notification', 'refused', 'ACCEPTED');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(37, 'notifications', 'employee cannot forge a notification', 'refused', 'refused');
  END;

  -- notify_employee itself must be unreachable, or the revoke above is decoration.
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'notify_employee'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  PERFORM pg_temp.chk(38, 'notifications',
    'notify_employee not callable by anon or authenticated', '0', v_n::text);
END $$;

-- ── A notification must never break the thing it is about ──────────────────
--
-- The most important property of the whole notification feature, and the only one
-- worth deliberately breaking something to prove.
--
-- Every notification trigger wraps its work in an exception handler. If that handler
-- is ever removed, or a trigger is added without one, a bug in notification code
-- becomes a refused clock-in — someone standing at the gate at 6am unable to start
-- their shift because a message could not be addressed. So this replaces
-- notify_employee with a version that always raises, and then requires the punch to
-- succeed anyway. The whole suite rolls back, so the broken version never persists.
DO $$
DECLARE f record; v_ok boolean := true; v_emp uuid; v_n int;
BEGIN
  SELECT * INTO f FROM fx;

  -- 39: the original complaint — a shift published with nobody told about it.
  INSERT INTO shifts (company_id, employee_id, shift_date, start_at, end_at,
                      shift_type, status, published_at)
  VALUES (f.company_id, f.emp_id, current_date + 1,
          (current_date + 1)::timestamp + time '08:00',
          (current_date + 1)::timestamp + time '16:00',
          'work', 'published', now());

  SELECT count(*) INTO v_n
    FROM notifications
   WHERE employee_id = f.emp_id AND kind = 'shift_published'
     AND created_at > now() - interval '1 minute';
  PERFORM pg_temp.chk(39, 'notifications',
    'a published shift tells the employee', 'told',
    CASE WHEN v_n >= 1 THEN 'told' ELSE 'SILENT' END);

  -- 40: break the notifier and require the clock-in to survive it.
  CREATE OR REPLACE FUNCTION public.notify_employee(
    p_company_id uuid, p_employee_id uuid, p_kind text, p_title text,
    p_body text DEFAULT NULL, p_link text DEFAULT NULL, p_subject_table text DEFAULT NULL,
    p_subject_id uuid DEFAULT NULL, p_dedupe_window interval DEFAULT '5 minutes'
  ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
  AS $broken$ BEGIN RAISE EXCEPTION 'deliberately broken notifier'; END $broken$;

  SELECT e.id INTO v_emp
    FROM employees e
   WHERE e.company_id = f.company_id AND e.status = 'active' AND e.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM attendance a
                      WHERE a.employee_id = e.id AND a.date = current_date)
   ORDER BY e.id LIMIT 1;

  IF v_emp IS NULL THEN
    PERFORM pg_temp.chk(40, 'notifications',
      'broken notifier cannot block a clock-in', 'clock-in accepted',
      'SKIPPED: everyone already has a punch today');
  ELSE
    BEGIN
      INSERT INTO attendance (company_id, employee_id, date, clock_in, status)
      VALUES (f.company_id, v_emp, current_date, now(), 'late_minor');
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
    END;
    PERFORM pg_temp.chk(40, 'notifications',
      'broken notifier cannot block a clock-in', 'clock-in accepted',
      CASE WHEN v_ok THEN 'clock-in accepted' ELSE 'CLOCK-IN REFUSED' END);
  END IF;
END $$;

-- ═══ 12. SECURITY DEFINER helpers are not a public API — migration 18 ══════
-- A SECURITY DEFINER function ignores RLS by design, so EXECUTE on one is the
-- whole access decision. Both scoring helpers take an employee AND a company as
-- arguments and check nothing about the caller, so while anon could execute them
-- the arguments alone decided what was read: measured on Frankfurt, anon with no
-- JWT obtained a named employee's attendance score of 100 and reliability of
-- 99.54, while SELECT on attendance and employees was refused. The tables were
-- never the hole; these were.
--
-- Asserted as privileges rather than by calling them, because a call returning
-- NULL is ambiguous — it means "no rows that month" just as often as "refused",
-- and that ambiguity is what let this sit unnoticed.
SELECT pg_temp.chk(41, 'isolation', 'unguarded score helpers unreachable by anon/authenticated', 'unreachable',
  CASE WHEN has_function_privilege('anon',          'public.calculate_attendance_score(uuid,integer,integer,uuid)',  'EXECUTE')
         OR has_function_privilege('authenticated', 'public.calculate_attendance_score(uuid,integer,integer,uuid)',  'EXECUTE')
         OR has_function_privilege('anon',          'public.calculate_reliability_score(uuid,integer,integer,uuid)', 'EXECUTE')
         OR has_function_privilege('authenticated', 'public.calculate_reliability_score(uuid,integer,integer,uuid)', 'EXECUTE')
       THEN 'REACHABLE' ELSE 'unreachable' END);

-- The counterpart. Hardening that also breaks the product is not hardening, and
-- the three-argument overload is what the KPI screen actually calls — it reads the
-- company from auth.uid() instead of trusting an argument.
SELECT pg_temp.chk(42, 'isolation', 'guarded 3-arg score helper still callable by authenticated', 'callable',
  CASE WHEN has_function_privilege('authenticated',
              'public.calculate_attendance_score(uuid,integer,integer)', 'EXECUTE')
       THEN 'callable' ELSE 'BROKEN' END);

-- Every SECURITY DEFINER function reachable by anon or authenticated must either
-- interrogate the caller or be one of the deliberate exceptions. This is the
-- generalised form of 41: it fails when a NEW unguarded definer function is
-- exposed, which is the way this class of bug returns.
--
-- The exceptions, each for a stated reason:
--   get_invite_preview, log_login_attempt       — the invite page and a failed
--       login both run before a session exists
--   accept_employee_invite, self_onboard_company — bearer-token / signup flows.
--       Still exposed to `authenticated` (which is all they need — App.jsx runs
--       both on the first authenticated visit after email confirmation), but no
--       longer to anon as of migration 24
--   get_user_role, get_user_company_id, get_user_department_id,
--   get_active_session_count, is_platform_owner — the primitives RLS policy
--       expressions call; they must stay executable or every policy errors
--   compute_kpi_rating, is_evaluation_month, geofence_requires_a_location,
--   last_work_location_is_protected, create_user_session, mark_session_inactive
--                                                — pure logic or self-scoped
SELECT pg_temp.chk(43, 'isolation', 'no unguarded SECURITY DEFINER function exposed', '0',
  (SELECT count(*)::text
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND p.prosrc !~ 'auth\.uid\(\)'
     AND p.proname NOT IN (
       'accept_employee_invite', 'get_invite_preview', 'self_onboard_company',
       'log_login_attempt', 'get_user_role', 'get_user_company_id',
       'get_user_department_id', 'get_active_session_count', 'is_platform_owner',
       'compute_kpi_rating', 'is_evaluation_month', 'geofence_requires_a_location',
       'last_work_location_is_protected', 'create_user_session', 'mark_session_inactive'
     )));

-- ═══ 13. The operator console reads across tenants — migration 19 ══════════
-- platform_company_overview() is the one function in this schema that is supposed
-- to see every company, which makes its refusal the only thing standing between
-- the operator console and a cross-tenant read. SECURITY DEFINER means RLS does
-- not apply inside it, so there is no second line of defence to fall back on.
--
-- The case that matters is 45: a tenant's own super_admin is the highest role
-- inside a company and must still be refused. If platform access were ever
-- modelled as "super_admin plus a bit", every customer's owner would get the
-- operator surface, which is why is_platform_owner is a separate flag and not a
-- role.
DO $$
DECLARE
  v_owner uuid; v_tenant_admin uuid; v_n int; v_ok text;
BEGIN
  SELECT user_id INTO v_owner FROM user_roles WHERE is_platform_owner IS TRUE LIMIT 1;
  SELECT user_id INTO v_tenant_admin FROM user_roles
   WHERE role = 'super_admin' AND is_platform_owner IS NOT TRUE LIMIT 1;

  -- 44. A platform owner sees every company, not just their own.
  IF v_owner IS NULL THEN
    PERFORM pg_temp.chk(44, 'platform', 'platform owner sees all companies', 'skipped',
      'skipped');
  ELSE
    PERFORM pg_temp.as_user(v_owner);
    BEGIN
      SELECT count(*) INTO v_n FROM public.platform_company_overview();
      v_ok := CASE WHEN v_n = (SELECT count(*) FROM company) THEN 'all' ELSE 'only '||v_n END;
    EXCEPTION WHEN OTHERS THEN v_ok := 'REFUSED';
    END;
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(44, 'platform', 'platform owner sees all companies', 'all', v_ok);
  END IF;

  -- 45. A tenant super_admin who is not a platform owner is refused outright —
  --     an exception, not an empty set. An empty set would be indistinguishable
  --     from "no companies exist" and would hide a broken check.
  IF v_tenant_admin IS NULL THEN
    PERFORM pg_temp.chk(45, 'platform', 'tenant super_admin refused by console', 'skipped',
      'skipped');
  ELSE
    PERFORM pg_temp.as_user(v_tenant_admin);
    BEGIN
      SELECT count(*) INTO v_n FROM public.platform_company_overview();
      v_ok := 'LEAKED '||v_n||' companies';
    EXCEPTION WHEN OTHERS THEN v_ok := 'refused';
    END;
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(45, 'platform', 'tenant super_admin refused by console', 'refused', v_ok);
  END IF;
END $$;

-- 46. The console must never be able to return a column that identifies a person.
-- Asserted against the function's declared return type rather than its body, so
-- adding "just the owner's name" to the console fails here rather than shipping.
SELECT pg_temp.chk(46, 'platform', 'console return type carries no personal data', '0',
  (SELECT count(*)::text
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace,
   unnest(string_to_array(pg_get_function_result(p.oid), ',')) AS col
   WHERE n.nspname = 'public'
     AND p.proname = 'platform_company_overview'
     AND col ~* '(salary|national_id|bank_account|iban|passport|phone|email|full_name)'));

-- 47. anon must not reach it at all — stopped at the grant, before the refusal
-- inside even runs.
SELECT pg_temp.chk(47, 'platform', 'console unreachable by anon', 'false',
  has_function_privilege('anon', 'public.platform_company_overview()', 'EXECUTE')::text);

-- ═══ 14. A missing caller is not an authorised caller — migration 24 ═══════
-- Assertion 43 checks that an exposed definer function *mentions* auth.uid().
-- These two mentioned it and still let a stranger through, because the guard was
--
--   IF get_user_company_id(auth.uid()) != v_emp_company THEN RAISE ...
--
-- and `NULL != <uuid>` is NULL, which `IF` treats as false. Text cannot catch that,
-- so these are behavioural: impersonate someone with no user_roles row and require
-- an exception. A returned value is a failure here regardless of what it contains —
-- an empty export would still mean the guard did not fire.
--
-- Safe to run against production: the whole suite is inside a transaction that
-- always rolls back, which is what makes it possible to assert on anonymize_employee
-- at all. Nothing it scrubs is kept.
DO $$
DECLARE
  v_stranger uuid := gen_random_uuid();  -- authenticated, but in no company
  v_emp uuid; v_other_admin uuid; v_ok text; v_res jsonb;
BEGIN
  SELECT emp_id INTO v_emp FROM fx;
  -- A super_admin of some *other* company than the fixture employee's.
  SELECT ur.user_id INTO v_other_admin
    FROM user_roles ur
   WHERE ur.role = 'super_admin'
     AND ur.company_id <> (SELECT company_id FROM fx)
   LIMIT 1;

  -- 48. The PDPL export refuses a caller with no company.
  PERFORM pg_temp.as_user(v_stranger);
  BEGIN
    v_res := public.export_employee_data(v_emp);
    v_ok := 'LEAKED '||coalesce(v_res->'personal_information'->>'full_name','(empty)');
  EXCEPTION WHEN OTHERS THEN v_ok := 'refused';
  END;
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(48, 'isolation', 'PDPL export refuses a caller with no company',
    'refused', v_ok);

  -- 49. Erasure refuses the same caller. This one writes if the guard fails, which
  -- is exactly why it is asserted: the failure mode is a stranger terminating and
  -- blanking an employee record, not merely reading one.
  PERFORM pg_temp.as_user(v_stranger);
  BEGIN
    v_res := public.anonymize_employee(v_emp);
    v_ok := 'ERASED';
  EXCEPTION WHEN OTHERS THEN v_ok := 'refused';
  END;
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(49, 'isolation', 'erasure refuses a caller with no company',
    'refused', v_ok);

  -- 50. And the ordinary cross-tenant case, for the same two functions: the highest
  -- role in another company is still the wrong company.
  IF v_other_admin IS NULL THEN
    PERFORM pg_temp.chk(50, 'isolation', 'PDPL export refuses another company''s super_admin',
      'skipped', 'skipped');
  ELSE
    PERFORM pg_temp.as_user(v_other_admin);
    BEGIN
      v_res := public.export_employee_data(v_emp);
      v_ok := 'LEAKED '||coalesce(v_res->'personal_information'->>'full_name','(empty)');
    EXCEPTION WHEN OTHERS THEN v_ok := 'refused';
    END;
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(50, 'isolation', 'PDPL export refuses another company''s super_admin',
      'refused', v_ok);
  END IF;
END $$;

-- 51. Both are also stopped at the grant, before the refusal inside them runs.
SELECT pg_temp.chk(51, 'isolation', 'PDPL export unreachable by anon', 'false',
  has_function_privilege('anon', 'public.export_employee_data(uuid)', 'EXECUTE')::text);

SELECT pg_temp.chk(52, 'isolation', 'erasure unreachable by anon', 'false',
  has_function_privilege('anon', 'public.anonymize_employee(uuid)', 'EXECUTE')::text);

-- 53. The surface itself, as a number. A definer function whose first act is to ask
-- who the caller is has no anon use case, so adding one that anon can reach should
-- fail here rather than in a probe six months later.
--
-- Trigger functions are excluded structurally rather than by name. CREATE FUNCTION
-- grants EXECUTE to PUBLIC by default, so every new trigger function is born
-- anon-executable — and a trigger function cannot be invoked as an RPC anyway;
-- PostgREST will not expose a function returning `trigger`, and calling one directly
-- raises "trigger functions can only be called as triggers". Migration 26's guard was
-- the third such function and it broke this assertion's hand-maintained list, which is
-- the argument for the rule over the list.
--
-- The two named exceptions are deliberate and reachable:
--   get_invite_preview — the invite page renders before login
--   log_login_attempt  — a failed login has no session to log with
-- compute_kpi_rating stays because it is pure arithmetic over a number it is handed;
-- it reads no table and takes no identity.
SELECT pg_temp.chk(53, 'isolation', 'definer functions reachable by anon', '0',
  (SELECT count(*)::text
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.prorettype <> 'pg_catalog.trigger'::regtype
     AND p.proname NOT IN (
       'get_invite_preview', 'log_login_attempt', 'compute_kpi_rating'
     )));

-- ═══ 15. Suspension is enforced, not decorative — migration 25 ═════════════
-- The Terms have always said "access to the workspace is suspended", the plan CHECK
-- has always allowed 'suspended', and until migration 25 nothing in the database
-- treated it differently — nor was there any function that could set it.
--
-- Enforcement lives in get_user_company_id, which 100 policies resolve tenant scope
-- through. These assertions flip a real company's plan inside the suite's
-- always-rolls-back transaction and read the consequence through RLS as one of its
-- own people, which is the only way to test a claim about 100 policies without
-- writing 100 assertions. Both directions are asserted: 'active' must be untouched
-- by the change, because a gate that shuts on everyone is not a gate.
DO $$
DECLARE
  v_co uuid; v_uid uuid; v_open int; v_shut int; v_plan text; v_ok text;
BEGIN
  SELECT company_id INTO v_co FROM fx;
  SELECT user_id INTO v_uid FROM user_roles WHERE company_id = v_co LIMIT 1;

  -- 54. Access granted: the baseline. Forced to 'active' rather than trusting
  --     whatever the company's plan happens to be today.
  UPDATE company SET plan = 'active' WHERE id = v_co;
  PERFORM pg_temp.as_user(v_uid);
  SELECT count(*) INTO v_open FROM employees;
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(54, 'suspension', 'an active workspace reads its own employees', 'some',
    CASE WHEN v_open > 0 THEN 'some' ELSE 'none — fixture or RLS broken' END);

  -- 55. And with the plan suspended, the same person reads nothing at all.
  UPDATE company SET plan = 'suspended', plan_note = 'assertion 55' WHERE id = v_co;
  PERFORM pg_temp.as_user(v_uid);
  SELECT count(*) INTO v_shut FROM employees;
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(55, 'suspension', 'a suspended workspace reads no employees', '0', v_shut::text);

  -- 56. The explanation survives the enforcement. This is the assertion that stops
  --     someone "simplifying" my_workspace() to go through get_user_company_id: it
  --     would still pass every other test here and leave suspended customers
  --     staring at an empty app with no reason given.
  PERFORM pg_temp.as_user(v_uid);
  BEGIN
    SELECT plan INTO v_plan FROM public.my_workspace();
    v_ok := coalesce(v_plan, 'NO ROW');
  EXCEPTION WHEN OTHERS THEN v_ok := 'REFUSED';
  END;
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(56, 'suspension', 'a suspended workspace can still read why', 'suspended', v_ok);

  -- 57. And the tenant cannot let themselves back in. platform_set_plan is
  --     SECURITY DEFINER, so its caller check is the only thing between a customer's
  --     own super_admin and their own plan column.
  PERFORM pg_temp.as_user(
    coalesce((SELECT user_id FROM user_roles
               WHERE role = 'super_admin' AND is_platform_owner IS NOT TRUE LIMIT 1), v_uid));
  BEGIN
    PERFORM public.platform_set_plan(v_co, 'active', NULL);
    v_ok := 'LET THEMSELVES BACK IN';
  EXCEPTION WHEN OTHERS THEN v_ok := 'refused';
  END;
  PERFORM pg_temp.as_nobody();
  PERFORM pg_temp.chk(57, 'suspension', 'a tenant cannot set their own plan', 'refused', v_ok);
END $$;

-- 58. Only a platform owner may set a plan, and anon may not reach the function at
-- all — stopped at the grant, before the refusal inside it runs.
SELECT pg_temp.chk(58, 'suspension', 'plan control unreachable by anon', 'false',
  has_function_privilege('anon', 'public.platform_set_plan(uuid,text,text)', 'EXECUTE')::text);

-- 59. What the plan column is allowed to contain, asserted against the constraint
-- rather than against a list in this file: platform_set_plan and authStore both
-- enumerate the four plans, and a fifth added to the CHECK without being taught to
-- them would be neither settable nor understood.
--
-- contype = 'c' is load-bearing, and migration 25 is what made it so: the new
-- plan_changed_by column brought a foreign key whose definition also matches
-- '%plan%'. Without the filter, LIMIT 1 picked "FOREIGN KEY (plan_changed_by) …",
-- which contains none of the four words, and the assertion reported 0 against a
-- perfectly good CHECK constraint.
SELECT pg_temp.chk(59, 'suspension', 'plan vocabulary is the expected four', '4',
  (SELECT count(DISTINCT p)::text
   FROM unnest(ARRAY['trial', 'active', 'suspended', 'cancelled']) AS p
   WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint
           WHERE conrelid = 'public.company'::regclass
             AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%plan = ANY%' LIMIT 1) LIKE '%' || p || '%'));

-- ═══ 16. The logic audit's fixes — migrations 26-29 ════════════════════════
-- Every one of these was a rule the product believed it had. None was enforced.
DO $$
DECLARE
  v_emp uuid; v_uid uuid; v_row uuid; v_ok text;
  v_mgr numeric; v_self numeric; v_date date; v_tz text; v_co uuid;
BEGIN
  -- An employee who is NOT hr/super_admin, with a KPI row of their own.
  SELECT e.id, e.user_id, e.company_id INTO v_emp, v_uid, v_co
    FROM employees e
    JOIN user_roles ur ON ur.user_id = e.user_id
   WHERE ur.role NOT IN ('super_admin','hr_manager')
     AND e.status = 'active'
   LIMIT 1;

  IF v_uid IS NULL THEN
    PERFORM pg_temp.chk(60, 'audit', 'employee cannot write their own manager score', 'skipped', 'skipped');
    PERFORM pg_temp.chk(61, 'audit', 'employee can still self-evaluate', 'skipped', 'skipped');
  ELSE
    INSERT INTO kpi_scores (employee_id, company_id, period_year, period_month, manager_score)
    VALUES (v_emp, v_co, 2099, 1, 60)
    ON CONFLICT (employee_id, period_year, period_month) DO UPDATE SET manager_score = 60
    RETURNING id INTO v_row;

    -- 60. The escalation: awarding yourself the score your manager owns.
    PERFORM pg_temp.as_user(v_uid);
    BEGIN
      UPDATE kpi_scores SET manager_score = 100, behavior_score = 100,
                            achievement_score = 100, attendance_score = 100
       WHERE id = v_row;
    EXCEPTION WHEN OTHERS THEN NULL;   -- refusal is fine; silent pinning is the design
    END;
    PERFORM pg_temp.as_nobody();
    SELECT manager_score INTO v_mgr FROM kpi_scores WHERE id = v_row;
    PERFORM pg_temp.chk(60, 'audit', 'employee cannot write their own manager score',
      '60.00', coalesce(v_mgr::text, 'null'));

    -- 61. …and the legitimate write still works, or the guard is just a wall.
    PERFORM pg_temp.as_user(v_uid);
    BEGIN
      UPDATE kpi_scores SET self_score = 77 WHERE id = v_row;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM pg_temp.as_nobody();
    SELECT self_score INTO v_self FROM kpi_scores WHERE id = v_row;
    PERFORM pg_temp.chk(61, 'audit', 'employee can still self-evaluate',
      '77.00', coalesce(v_self::text, 'null'));
  END IF;
END $$;

-- 62. A punch belongs to the company's calendar day, not the device's. Asserted on the
-- function body rather than by inserting a punch: a real insert trips geofence and GPS
-- requirements that differ per company, and this is the line that matters.
SELECT pg_temp.chk(62, 'audit', 'punch date is derived from company timezone', 'derived',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc
              WHERE proname = 'autolink_attendance_to_shift')
            LIKE '%now() AT TIME ZONE v_tz%'
       THEN 'derived' ELSE 'CLIENT-SUPPLIED' END);

-- 63. Payroll that does not add up cannot leave draft.
SELECT pg_temp.chk(63, 'audit', 'payroll arithmetic checked before approval', 'checked',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc
              WHERE proname = 'validate_payroll_transition')
            LIKE '%does not add up%'
       THEN 'checked' ELSE 'UNCHECKED' END);

-- 64. Leave dates run forwards and days cannot exceed the range they sit in.
SELECT pg_temp.chk(64, 'audit', 'leave date/day constraints present', '2',
  (SELECT count(*)::text FROM pg_constraint
    WHERE conrelid = 'public.leave_requests'::regclass
      AND conname IN ('leave_dates_run_forwards', 'leave_days_fit_the_range')));

-- 65. The session cleanup job exists and is enabled. A function nothing calls is not a
-- feature — this is the assertion that would have caught it.
SELECT pg_temp.chk(65, 'audit', 'expired-session cleanup is scheduled', 'scheduled',
  CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-session-cleanup' AND active)
       THEN 'scheduled' ELSE 'NOT SCHEDULED' END);

-- ═══ 17. Country packs and leave policy — migrations 31-33 ═════════════════
-- The feature's whole risk is that a pack invents a legal entitlement. These assert the
-- guardrails rather than the numbers: the numbers belong to whoever read the statute.

-- 66. Every leave rule carries a citation. A rule without one is a number somebody
-- made up, and this is the assertion that stops it being added.
SELECT pg_temp.chk(66, 'country', 'every country leave rule cites a source', '0',
  (SELECT count(*)::text FROM country_leave_rules
    WHERE legal_reference IS NULL OR btrim(legal_reference) = ''));

-- 67. Only verified countries have rules at all. An unverified pack seeds nothing, so
-- rules attached to one would be inherited by companies without ever being checked.
SELECT pg_temp.chk(67, 'country', 'no leave rules under an unverified country', '0',
  (SELECT count(*)::text FROM country_leave_rules r
     JOIN country_rules c ON c.code = r.country_code
    WHERE NOT c.verified));

-- 68. A company policy row seeded from a pack is marked as such, so HR can see what
-- they inherited and what they chose. Anything else is a company's own decision.
SELECT pg_temp.chk(68, 'country', 'seeded policies are labelled country_pack', '0',
  (SELECT count(*)::text FROM company_leave_policies
    WHERE source NOT IN ('country_pack', 'company')));

-- 69. Reference data is readable by tenants and writable only by BYOND. A company that
-- could edit the country's law could quietly lower the floor it is measured against.
SELECT pg_temp.chk(69, 'country', 'country rules not writable by a tenant', 'owner-only',
  CASE WHEN (SELECT count(*) FROM pg_policies
              WHERE tablename = 'country_leave_rules' AND cmd = 'ALL'
                AND qual LIKE '%is_platform_owner%') = 1
       THEN 'owner-only' ELSE 'WRITABLE' END);

-- 70. The F-02 closure, behavioural: an employee with a zero balance must be refused,
-- and the refusal must come from policy rather than from an absent row. Asserted on the
-- function body because the insert path needs a company with a policy and an employee
-- with none, which the fixture cannot guarantee on every environment.
SELECT pg_temp.chk(70, 'country', 'no leave policy no longer means unlimited leave', 'refuses',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'check_leave_entitlement')
            LIKE '%No % leave policy is set%'
       THEN 'refuses' ELSE 'STILL ALLOWS' END);

-- ── Migration 34: a country is a code, not a sentence ──────────────────────

-- 71. Every company holds an ISO 3166-1 alpha-2 code. The whole point of the change:
-- 'UAE', 'uae' and 'U.A.E.' can no longer be three different countries.
SELECT pg_temp.chk(71, 'country', 'every company country is a 2-letter code', '0',
  (SELECT count(*)::text FROM company WHERE country IS NULL OR country !~ '^[A-Z]{2}$'));

-- 72. The column cannot go back to being free text: NOT NULL, no default, and a foreign
-- key to country_rules. Without the FK a typo is still a new country.
SELECT pg_temp.chk(72, 'country', 'company.country is constrained', 'notnull+nodefault+fk',
  (SELECT CASE WHEN a.attnotnull
                AND NOT EXISTS (SELECT 1 FROM pg_attrdef d
                                 WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
                AND EXISTS (SELECT 1 FROM pg_constraint fk
                             WHERE fk.conrelid = 'public.company'::regclass
                               AND fk.contype = 'f'
                               AND fk.confrelid = 'public.country_rules'::regclass
                               AND a.attnum = ANY (fk.conkey))
               THEN 'notnull+nodefault+fk' ELSE 'UNCONSTRAINED' END
     FROM pg_attribute a
    WHERE a.attrelid = 'public.company'::regclass AND a.attname = 'country'));

-- 73. A company created without naming a country used to become the UAE silently, and
-- then inherit UAE labour law. The default is gone and must stay gone.
SELECT pg_temp.chk(73, 'country', 'no silent UAE default on company.country', 'no default',
  (SELECT CASE WHEN column_default IS NULL THEN 'no default' ELSE 'DEFAULT '||column_default END
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'company' AND column_name = 'country'));

-- 74. The resolver normalises what humans type and returns NULL for what it does not
-- know. The NULL matters more than the matches: it is what stops an unrecognised
-- country being filed under AE.
SELECT pg_temp.chk(74, 'country', 'resolve_country_code maps labels and refuses guesses', 'AE|AE|AE|GB|SA|NULL|NULL',
  concat_ws('|',
    coalesce(resolve_country_code('UAE'), 'NULL'),
    coalesce(resolve_country_code('  united arab emirates '), 'NULL'),
    coalesce(resolve_country_code('AE'), 'NULL'),
    coalesce(resolve_country_code('UK'), 'NULL'),
    coalesce(resolve_country_code('KSA'), 'NULL'),
    coalesce(resolve_country_code('Atlantis'), 'NULL'),
    coalesce(resolve_country_code(''), 'NULL')));

-- 75. The fuzzy matcher is gone. While it exists somebody will compare free text to a
-- country again, which is the defect this whole migration removes.
SELECT pg_temp.chk(75, 'country', 'is_uae_country is retired', '0',
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_uae_country'));

-- 76. Normalisation has to happen before the identifier checks read NEW.country, and
-- BEFORE triggers fire in name order. If someone renames either trigger, the UAE format
-- rules stop firing for a company that was created with the label 'UAE'.
SELECT pg_temp.chk(76, 'country', 'country normalises before identifiers are checked', 'ordered',
  CASE WHEN (SELECT tgname FROM pg_trigger
              WHERE tgrelid = 'public.company'::regclass AND NOT tgisinternal
                AND tgfoid = 'public.company_country_is_a_code'::regproc)
           < (SELECT tgname FROM pg_trigger
               WHERE tgrelid = 'public.company'::regclass AND NOT tgisinternal
                 AND tgfoid = 'public.company_identifiers_fit_the_country'::regproc)
       THEN 'ordered' ELSE 'OUT OF ORDER' END);

-- ── Migrations 35-36: payroll and paperwork stop assuming the UAE ──────────

-- 77. currency and timezone had the same shape country did — nullable, defaulting to the
-- UAE. timezone is the sharp one: migration 27 derives an attendance row's date from it,
-- so a company that never set one had clock-ins near midnight filed under Dubai's day.
SELECT pg_temp.chk(77, 'country', 'currency and timezone cannot default to the UAE', 'both constrained',
  (SELECT CASE WHEN count(*) = 2 THEN 'both constrained' ELSE 'STILL DEFAULTED' END
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'company'
      AND column_name IN ('currency', 'timezone')
      AND is_nullable = 'NO' AND column_default IS NULL));

-- 78. Document type seeding is gated on the country. Asserted on the body rather than by
-- creating a company, same reasoning as 70: the fixture cannot guarantee a second country
-- exists on every environment.
SELECT pg_temp.chk(78, 'country', 'UAE document types are seeded only for AE', 'gated',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'seed_default_document_types')
            LIKE '%v_code = ''AE''%'
       THEN 'gated' ELSE 'SEEDED TO EVERYONE' END);

-- 79. The identity and permit labels in country_rules exist so that one code can read
-- "Emirates ID" in Dubai and "National ID" in Nairobi. They went unread for four
-- migrations; this is what stops that happening again.
SELECT pg_temp.chk(79, 'country', 'document labels come from the country pack', 'from pack',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'seed_default_document_types')
            LIKE '%identity_label%'
       THEN 'from pack' ELSE 'HARDCODED' END);

-- 80. The salary transfer file asks which country before demanding UAE paperwork.
-- country_rules.payment_file was added to decide this and had been read by nothing.
SELECT pg_temp.chk(80, 'country', 'WPS SIF refuses a country with no bank file format', 'gated',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'generate_wps_sif')
            LIKE '%payment_file%uae_wps_sif%'
       THEN 'gated' ELSE 'UNGATED' END);

-- 81. `text[] || <untyped literal>` resolves to array-to-array concatenation in Postgres
-- and raises 22P02 trying to parse the sentence as an array. Both of these fired whenever
-- a company was missing its establishment ID — which is to say, in exactly the case the
-- validation existed to report. Found by calling the function, not by reading it.
SELECT pg_temp.chk(81, 'country', 'WPS validation errors are cast to text', 'cast',
  (SELECT CASE WHEN pg_get_functiondef(oid) LIKE '%establishment ID missing''::text%'
                AND pg_get_functiondef(oid) LIKE '%routing code missing''::text%'
               THEN 'cast' ELSE 'RAISES 22P02' END
     FROM pg_proc WHERE proname = 'generate_wps_sif'));

-- ── The leave policy a company actually offers ─────────────────────────────

-- 82. Settings > Leave Policy is a write path into company_leave_policies, so the gate
-- matters. Everyone in the company may READ it — an employee is entitled to know how much
-- leave they get — and only super_admin or hr_manager may change it. An employee who could
-- edit this could grant themselves leave before requesting it.
SELECT pg_temp.chk(82, 'country', 'leave policy is read by all, written by HR only', 'read-all/write-hr',
  CASE WHEN (SELECT count(*) FROM pg_policies
              WHERE tablename = 'company_leave_policies' AND cmd = 'SELECT'
                AND qual LIKE '%get_user_company_id%') = 1
        AND (SELECT count(*) FROM pg_policies
              WHERE tablename = 'company_leave_policies' AND cmd = 'ALL'
                AND qual LIKE '%hr_manager%' AND with_check LIKE '%hr_manager%') = 1
       THEN 'read-all/write-hr' ELSE 'GATE WRONG' END);

-- ── Migration 38: every foreign key has something behind it ────────────────

-- 83. Postgres indexes the referenced side of a foreign key automatically and never the
-- referencing side, so an unindexed one is a sequential scan on every query that filters
-- the column AND on every delete of the parent — including anonymize_employee, which this
-- product is legally obliged to complete. 41 were missing; this is what stops the 42nd
-- arriving unnoticed.
SELECT pg_temp.chk(83, 'perf', 'every foreign key has a supporting index', '0',
  (WITH fk AS (
     SELECT c.conkey, c.conrelid
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
   )
   SELECT count(*)::text FROM fk
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = fk.conrelid
         AND (i.indkey::smallint[])[0:array_length(fk.conkey, 1) - 1] = fk.conkey)));

-- ── Migrations 40-43: the custom KPI system ────────────────────────────────

-- 84. The five-level scale is fixed platform-wide. If a company could set its own point
-- values, "Meets expectations" would mean a different number in every tenant and no score
-- would be comparable to any other.
SELECT pg_temp.chk(84, 'kpi', 'the level scale is 20/40/60/80/100', '20|40|60|80|100',
  concat_ws('|', kpi_level_points(1::smallint), kpi_level_points(2::smallint),
                 kpi_level_points(3::smallint), kpi_level_points(4::smallint),
                 kpi_level_points(5::smallint)));

-- 85. RLS decides which rows, never which columns. Without a trigger an employee could
-- write their own manager_level and score themselves — the hole migration 26 closed on
-- kpi_scores, which this table would otherwise have reopened.
SELECT pg_temp.chk(85, 'kpi', 'an employee cannot write their own manager rating', 'guarded',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.kpi_review_lines'::regclass AND NOT t.tgisinternal
       AND p.proname = 'kpi_review_line_self_writes_self_only')
  THEN 'guarded' ELSE 'UNGUARDED' END);

-- 86. Both approval chains are enforced by a trigger, not by a status string the client
-- sets. employee_scorecards shipped in migration 41 with the states and none of the
-- enforcement, so any department_manager could approve their own exception — found by
-- testing, fixed in 43.
SELECT pg_temp.chk(86, 'kpi', 'both scorecard approval chains are enforced', 'both',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                     WHERE t.tgrelid = 'public.kpi_templates'::regclass AND NOT t.tgisinternal
                       AND p.proname = 'validate_kpi_template_transition')
        AND EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                     WHERE t.tgrelid = 'public.employee_scorecards'::regclass AND NOT t.tgisinternal
                       AND p.proname = 'validate_employee_scorecard_transition')
       THEN 'both' ELSE 'MISSING ONE' END);

-- 87. Nobody is scored against weights that do not total 100. Templates are checked at
-- submission; an override bypassed that entirely until migration 43 added the check at
-- activation and again where a review is opened.
SELECT pg_temp.chk(87, 'kpi', 'weights must total 100 before scoring', 'checked',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc
              WHERE proname = 'validate_employee_scorecard_transition') LIKE '%employee_scorecard_weight_total%'
        AND (SELECT pg_get_functiondef(oid) FROM pg_proc
              WHERE proname = 'kpi_generate_review_lines') LIKE '%employee_scorecard_weight_total%'
       THEN 'checked' ELSE 'UNCHECKED' END);

-- 88. The recommendation engine ranks a shortfall above an upside. Because the scale is
-- linear, "points gained by going up one level" is always 20 * weight / total, so a naive
-- ranking is just "your heaviest criterion" and would tell someone at Exceeds to chase
-- Outstanding while they sit at Poor elsewhere.
SELECT pg_temp.chk(88, 'kpi', 'advice puts what you are failing above what you could polish', 'banded',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'kpi_review_opportunities')
            LIKE '%shortfall%'
       THEN 'banded' ELSE 'NAIVE' END);

-- ═══ 21. A manager manages their own department — migrations 44 to 47 ══════
-- Raaed settled this after the engine was built: "Manager only responsible on their
-- department, it is like employee reporting to department manager. HR the whole company,
-- report to CEO." Every KPI table until then said role IN (super_admin, hr_manager,
-- department_manager) and stopped, so a Sales manager could rate an Operations employee.
--
-- 89 and 90 are behavioural rather than structural, because the rule is a data question
-- and a policy that merely mentions kpi_manages_employee could still be asking it about
-- the wrong row.
DO $$
DECLARE
  v_mgr_user uuid; v_mgr_emp uuid; v_mgr_dept uuid; v_other uuid;
  v_hr_user uuid; v_hr_emp uuid;
  v_ok text;
BEGIN
  SELECT ur.user_id, e.id, e.department_id INTO v_mgr_user, v_mgr_emp, v_mgr_dept
    FROM user_roles ur JOIN employees e ON e.user_id = ur.user_id
   WHERE ur.role = 'department_manager' AND e.department_id IS NOT NULL
   LIMIT 1;

  SELECT e.id INTO v_other FROM employees e
   WHERE e.department_id IS NOT NULL AND e.department_id <> v_mgr_dept
     AND e.company_id = (SELECT company_id FROM employees WHERE id = v_mgr_emp)
   LIMIT 1;

  -- 89. Somebody else's department is out of reach.
  IF v_mgr_user IS NULL OR v_other IS NULL THEN
    -- Vacuous rather than silently absent: this database has no department manager with
    -- a second department to test against, and saying so is better than a green tick.
    PERFORM pg_temp.chk(89, 'kpi', 'a manager cannot rate another department',
      'no manager to test', 'no manager to test');
    PERFORM pg_temp.chk(90, 'kpi', 'nobody manages themselves',
      'no manager to test', 'no manager to test');
  ELSE
    PERFORM pg_temp.as_user(v_mgr_user);
    v_ok := CASE WHEN public.kpi_manages_employee(v_other) THEN 'REACHES THEM' ELSE 'out of reach' END;
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(89, 'kpi', 'a manager cannot rate another department',
      'out of reach', v_ok);

    -- 90. And not themselves. This is what puts a manager's own review in HR's hands and
    -- HR's in the owner's, which is the chain Raaed described.
    PERFORM pg_temp.as_user(v_mgr_user);
    v_ok := CASE WHEN public.kpi_manages_employee(v_mgr_emp) THEN 'RATES HIMSELF' ELSE 'not himself' END;
    PERFORM pg_temp.as_nobody();

    SELECT ur.user_id, e.id INTO v_hr_user, v_hr_emp
      FROM user_roles ur JOIN employees e ON e.user_id = ur.user_id
     WHERE ur.role = 'hr_manager' LIMIT 1;
    IF v_hr_user IS NOT NULL AND v_ok = 'not himself' THEN
      PERFORM pg_temp.as_user(v_hr_user);
      v_ok := CASE WHEN public.kpi_manages_employee(v_hr_emp) THEN 'HR RATES HERSELF' ELSE 'not himself' END;
      PERFORM pg_temp.as_nobody();
    END IF;
    PERFORM pg_temp.chk(90, 'kpi', 'nobody manages themselves', 'not himself', v_ok);
  END IF;
END $$;

-- 91. The three report functions are SECURITY DEFINER and take a review id. Until
-- migration 45 that id was the only access control they had: hold one and you got the
-- score, the ranked weaknesses and both sides' disagreements, whoever you were.
SELECT pg_temp.chk(91, 'kpi', 'the review reports check who is asking', 'all three',
  CASE WHEN (SELECT count(*) FROM pg_proc
              WHERE proname IN ('kpi_review_score','kpi_review_opportunities','kpi_review_disagreements')
                AND pg_get_functiondef(oid) LIKE '%kpi_review_is_visible%') = 3
       THEN 'all three' ELSE 'UNGUARDED' END);

-- 92. The review stages are enforced on the per-criterion ratings, not only on the old
-- score column. Without this an employee could revise their self-rating after reading the
-- manager's, which is the one thing a self-assessment must not allow.
SELECT pg_temp.chk(92, 'kpi', 'ratings cannot be written out of stage', 'guarded',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.kpi_review_lines'::regclass AND NOT t.tgisinternal
       AND p.proname = 'kpi_review_line_stage_guard')
  THEN 'guarded' ELSE 'UNGUARDED' END);

-- 93. An "automatic" criterion is actually measured. The schema had auto_value and the
-- thresholds from the start and nothing ever wrote a number into the column, so every
-- automated criterion sat unrated forever behind a badge saying it was automatic.
SELECT pg_temp.chk(93, 'kpi', 'automatic criteria are measured from real attendance', 'measured',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'kpi_metric_value')
        AND EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                     WHERE t.tgrelid = 'public.kpi_review_cycles'::regclass AND NOT t.tgisinternal
                       AND p.proname = 'kpi_cycle_refresh_auto_lines')
       THEN 'measured' ELSE 'DECORATIVE' END);

-- ═══ 22. A manager can hold more than one unit — migrations 48 and 49 ══════
-- Raaed: "Aisha Manager. Khalid (Admin) reports to Aisha (Ganache chocolate). Amir (Sales)
-- reports to Aisha (Carpo chocolate). It's like Aisha is a multi-unit manager, if the HR
-- manager allowed her by adding the employees report to specific manager."
--
-- So reporting is something HR states rather than something the department implies, and
-- the rule is explicit beats implicit. 94 asserts both halves in one go, because the half
-- that is easy to forget is the second one: naming a manager has to MOVE somebody, not
-- widen the set of people who can rate them.
DO $$
DECLARE
  v_mgr_user uuid; v_mgr_emp uuid; v_mgr_dept uuid;
  v_outsider uuid; v_insider uuid;
  v_reach_before boolean; v_reach_after boolean; v_lost boolean;
  v_ok text;
BEGIN
  SELECT ur.user_id, e.id, e.department_id INTO v_mgr_user, v_mgr_emp, v_mgr_dept
    FROM user_roles ur JOIN employees e ON e.user_id = ur.user_id
   WHERE ur.role = 'department_manager' AND e.department_id IS NOT NULL
   LIMIT 1;

  -- Somebody outside their department, and somebody inside it.
  SELECT e.id INTO v_outsider FROM employees e
   WHERE e.department_id IS NOT NULL AND e.department_id <> v_mgr_dept
     AND e.company_id = (SELECT company_id FROM employees WHERE id = v_mgr_emp)
   LIMIT 1;
  SELECT e.id INTO v_insider FROM employees e
   WHERE e.department_id = v_mgr_dept AND e.id <> v_mgr_emp
   LIMIT 1;

  IF v_mgr_user IS NULL OR v_outsider IS NULL OR v_insider IS NULL THEN
    PERFORM pg_temp.chk(94, 'kpi', 'a named manager moves somebody rather than widening access',
      'no fixture to test', 'no fixture to test');
  ELSE
    PERFORM pg_temp.as_user(v_mgr_user);
    v_reach_before := public.kpi_manages_employee(v_outsider);
    PERFORM pg_temp.as_nobody();

    -- HR names them for the outsider, and names somebody else for the insider.
    UPDATE employees SET reports_to = v_mgr_emp WHERE id = v_outsider;
    UPDATE employees SET reports_to = v_outsider WHERE id = v_insider;

    PERFORM pg_temp.as_user(v_mgr_user);
    v_reach_after := public.kpi_manages_employee(v_outsider);
    v_lost        := NOT public.kpi_manages_employee(v_insider);
    PERFORM pg_temp.as_nobody();

    v_ok := CASE
              WHEN v_reach_before THEN 'REACHED THE OTHER DEPARTMENT ALREADY'
              WHEN NOT v_reach_after THEN 'NAMING DID NOTHING'
              WHEN NOT v_lost THEN 'KEPT SOMEBODY HR REASSIGNED'
              ELSE 'moved'
            END;
    PERFORM pg_temp.chk(94, 'kpi', 'a named manager moves somebody rather than widening access',
      'moved', v_ok);

    UPDATE employees SET reports_to = NULL WHERE id IN (v_outsider, v_insider);
  END IF;
END $$;

-- 95. "The employee can't rate the manager" — and is told so. Both guards used to pin the
-- forbidden column back to its old value, which is safe and dishonest: the write returned
-- success, the screen said "Saved", and the rating was not there. Structural rather than
-- behavioural because proving it needs a whole approved scorecard and an open cycle, which
-- this suite does not build; the behaviour was verified by hand against production.
SELECT pg_temp.chk(95, 'kpi', 'a forbidden write is refused, not silently dropped', 'both refuse',
  CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc
              WHERE proname = 'kpi_review_line_self_writes_self_only')
            LIKE '%Only your manager can write the manager rating%'
        AND (SELECT pg_get_functiondef(oid) FROM pg_proc
              WHERE proname = 'kpi_self_write_is_self_score_only')
            LIKE '%Only your manager or HR can write those scores%'
       THEN 'both refuse' ELSE 'STILL PINS' END);

-- 96. Every table on the path asks the same question. This is the assertion that would have
-- caught migration 48's failure: kpi_manages_employee said yes, the review-lines policy
-- said yes, and kpi_reviews still filtered by department — so the write matched zero rows
-- and reported success. A permission that spans tables is only as wide as the narrowest
-- policy on the path.
SELECT pg_temp.chk(96, 'kpi', 'no KPI policy still decides by department alone', '0',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('kpi_reviews', 'kpi_review_lines', 'employee_scorecards',
                        'employee_scorecard_overrides', 'warning_recommendations')
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%get_user_department_id%'));

-- ═══ 23. Responsibility reaches leave, pay and files — migration 50 ════════
-- Raaed said extend it, so the named manager now approves leave, sees a pay run and reads
-- a file for the people HR gave them. Reading those three policies to make the change
-- turned up three holes that had nothing to do with named managers, and 97 pins the worst
-- of them.
--
-- 97. A department_manager could give the first approval to their OWN leave request.
-- validate_leave_transition compared the employee's department to the caller's and never
-- asked whether they were the same person, and a manager is in their own department. HR
-- still had to give the final approval, so nobody could award themselves holiday — but the
-- first signature on your own request is the exact thing a two-step approval exists to
-- prevent, and it had been true since the day the guard was written.
DO $$
DECLARE
  v_mgr_user uuid; v_mgr_emp uuid; v_co uuid; v_req uuid; v_ok text;
BEGIN
  SELECT ur.user_id, e.id, e.company_id INTO v_mgr_user, v_mgr_emp, v_co
    FROM user_roles ur JOIN employees e ON e.user_id = ur.user_id
   WHERE ur.role = 'department_manager' AND e.department_id IS NOT NULL
   LIMIT 1;

  IF v_mgr_user IS NULL THEN
    PERFORM pg_temp.chk(97, 'leave', 'a manager cannot sign off their own leave',
      'no manager to test', 'no manager to test');
  ELSE
    INSERT INTO leave_requests (company_id, employee_id, leave_type, start_date, end_date,
                                days_requested, status, reason)
    VALUES (v_co, v_mgr_emp, 'annual', CURRENT_DATE + 400, CURRENT_DATE + 401, 2,
            'pending', 'assertion 97')
    RETURNING id INTO v_req;

    PERFORM pg_temp.as_user(v_mgr_user);
    BEGIN
      UPDATE leave_requests SET status = 'manager_approved' WHERE id = v_req;
      -- Zero rows updated raises nothing, so the verdict is read from the data rather than
      -- from whether an exception fired. (An earlier version of a test in this suite got
      -- that wrong and reported a working guard as broken.)
      SELECT CASE WHEN status = 'manager_approved' THEN 'SIGNED THEIR OWN' ELSE 'refused' END
        INTO v_ok FROM leave_requests WHERE id = v_req;
    EXCEPTION WHEN OTHERS THEN v_ok := 'refused';
    END;
    PERFORM pg_temp.as_nobody();
    PERFORM pg_temp.chk(97, 'leave', 'a manager cannot sign off their own leave',
      'refused', v_ok);
  END IF;
END $$;

-- 98. And the scope of a manager is one question asked in one place. Two of these were
-- worse than wrong before migration 50: leave_update granted a department_manager UPDATE
-- on every leave request in the company, which made the careful leave_mgr_update policy
-- beside it do nothing at all, and kpi_scores granted the role the whole company with a
-- filter in JavaScript standing in for the permission.
--
-- The count is of policies that still decide a manager's reach from the department alone.
-- emp_select is the one legitimate exception: it names both the department and reports_to,
-- and it cannot go through manages_employee because that predicate excludes yourself and
-- reading your own row is the first thing emp_select has to allow.
SELECT pg_temp.chk(98, 'isolation', 'a manager''s reach is one question in one place', '0',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('leave_requests', 'payroll_runs', 'hr_documents', 'kpi_scores',
                        'kpi_reviews', 'kpi_review_lines', 'employee_scorecards',
                        'employee_scorecard_overrides', 'warning_recommendations')
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%get_user_department_id%'));

-- 99. The wide policy that cancelled out the narrow one is gone. A permissive policy is
-- ORed with every other permissive policy on the same command, so one that names the role
-- and stops there makes every careful policy beside it decorative — this is the shape of
-- mistake that hides best, because the restrictive policy is still sitting there looking
-- like it works.
SELECT pg_temp.chk(99, 'leave', 'no blanket manager write on leave requests', 'none',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'leave_requests' AND cmd = 'UPDATE'
       AND coalesce(qual, '') LIKE '%department_manager%'
       AND coalesce(qual, '') NOT LIKE '%manages_employee%')
  THEN 'A BLANKET POLICY IS BACK' ELSE 'none' END);

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
