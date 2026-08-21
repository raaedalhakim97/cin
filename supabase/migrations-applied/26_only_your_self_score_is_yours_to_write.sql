-- F-01 (critical). An employee could award themselves any score, including their
-- manager's.
--
-- Row-level security decides WHICH ROWS a person may write. It has no opinion about
-- which columns. kpi_self_eval_insert and kpi_self_eval_update were written for a true
-- statement — an employee may submit their own self-evaluation — and in doing so
-- permitted writing every column on that row.
--
-- Measured on production, as a real employee account, inside a transaction that rolled
-- back:
--
--   SET LOCAL ROLE authenticated;   -- role 'employee'
--   UPDATE kpi_scores SET manager_score = 100, behavior_score = 100,
--                         achievement_score = 100, attendance_score = 100 ...
--
--    total_score |   rating    | bonus_eligible
--         100.00 | Exceptional | true
--
-- The scoring trigger then did its job perfectly on fabricated inputs. Rating and bonus
-- eligibility are the two fields that feed pay decisions and disciplinary records.
--
-- RLS is not the wrong tool; it was being asked a question it cannot answer. The row
-- gate stays. A trigger answers the column question, exactly as attendance_guard
-- already does for punches: pin what the caller must not control back to its previous
-- value rather than raising, so an honest client is never broken by a field it happened
-- to send.
--
-- pg_trigger_depth() is what separates "the employee's browser is writing" from "the
-- system is writing". sync_attendance_score and apply_kpi_adjustment both write
-- kpi_scores from inside their own triggers, under the employee's session — a plain
-- auth.uid() check would break the attendance sync every time someone clocked in.
-- Depth 1 is a direct write from a client; anything deeper is the schema computing.
-- Verified after applying: a clock-in still moved attendance_score from 0 to 50.

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
  -- No session (migrations, cron, the definer functions that evaluate rules) and
  -- writes originating inside another trigger are the system, not a person.
  IF v_uid IS NULL OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  v_role := get_user_role(v_uid);

  -- HR and the owner administer scores as their job, and every write they make is
  -- audited. A department_manager is deliberately NOT exempt: managing a team does
  -- not include scoring yourself.
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
    -- Creating your own row is legitimate — it is how a self-evaluation starts before
    -- anyone has assessed you. It may carry nothing but your own opinion.
    NEW.attendance_score  := NULL;
    NEW.reliability_score := NULL;
    NEW.behavior_score    := NULL;
    NEW.achievement_score := NULL;
    NEW.manager_score     := NULL;
    NEW.adjustment_points := 0;
    NEW.evaluated_by      := NULL;
  ELSE
    NEW.attendance_score  := OLD.attendance_score;
    NEW.reliability_score := OLD.reliability_score;
    NEW.behavior_score    := OLD.behavior_score;
    NEW.achievement_score := OLD.achievement_score;
    NEW.manager_score     := OLD.manager_score;
    NEW.adjustment_points := OLD.adjustment_points;
    NEW.evaluated_by      := OLD.evaluated_by;
    -- The row's identity is not editable either: without this, an employee could move
    -- their self-evaluation onto another period, or another person.
    NEW.employee_id       := OLD.employee_id;
    NEW.company_id        := OLD.company_id;
    NEW.period_year       := OLD.period_year;
    NEW.period_month      := OLD.period_month;
  END IF;

  RETURN NEW;
END;
$function$;

-- Must fire before aa_compute_kpi_total, which reads these columns to build the total,
-- the rating and bonus eligibility. BEFORE triggers fire in name order.
DROP TRIGGER IF EXISTS aa0_kpi_self_write_guard ON public.kpi_scores;
CREATE TRIGGER aa0_kpi_self_write_guard
  BEFORE INSERT OR UPDATE ON public.kpi_scores
  FOR EACH ROW EXECUTE FUNCTION public.kpi_self_write_is_self_score_only();

-- Verification, run after applying. As the same employee account:
--   the escalation left manager_score at 50.00 and the components untouched;
--   a genuine self-evaluation (self_score 80, notes) still saved and recomputed;
--   a clock-in still drove attendance_score from 0.00 to 50.00 via sync_attendance_score.
