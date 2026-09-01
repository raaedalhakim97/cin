-- Measured, not reasoned about: HR opened a quarter for twelve people and eleven had a
-- scorecard, but only ten got review lines. The one that did not was HR's own.
--
--   Aisha Rahman: 2 lines          Layla Nasser: no approved scorecard  (expected)
--   Khalid Mansour: 2 lines        Mariam Saleh: "Review lines are created when the
--   ... nine more with 2 lines                     cycle opens, not by hand."
--
-- That message is the column guard on kpi_review_lines refusing an INSERT. It was right
-- about the rule and wrong about who was breaking it: the lines were being created when
-- the cycle opened. It could not tell.
--
-- Why only HR's own row. The guard's first question is "do you manage this employee".
-- Migration 44 made that false for yourself — that is the whole point, it is what puts a
-- manager's review in HR's hands and HR's in the owner's. So when Mariam opened the cycle,
-- every review passed the guard except the one for Mariam, which fell through to the
-- self path, where INSERT is refused because an employee may not invent their own criteria.
--
-- pg_trigger_depth() already distinguishes "the schema is computing" from "the client is
-- writing", but only for writes that arrive from another trigger. This one arrives from a
-- SECURITY DEFINER function called directly, where the depth is still 1. So the seeder
-- says so out loud, on a transaction-local setting, and clears it on the way out.

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

  -- Transaction-local, set immediately before the one INSERT it covers and cleared
  -- immediately after. Both callers have already asked their own permission question:
  -- kpi_generate_review_lines checks that you manage the employee, open_kpi_review_cycle
  -- that you are HR or the owner. Nothing else may execute this function — it carries no
  -- grant to authenticated at all.
  PERFORM set_config('byond.seeding_review_lines', 'on', true);

  INSERT INTO kpi_review_lines (review_id, definition_id, weight, definition_name, source)
  SELECT p_review_id, w.definition_id, w.weight, d.name, d.source
    FROM employee_scorecard_weights(v_scorecard) w
    JOIN kpi_definitions d ON d.id = w.definition_id
   WHERE d.active
  ON CONFLICT (review_id, definition_id) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM set_config('byond.seeding_review_lines', 'off', true);
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_seed_review_lines(uuid) FROM PUBLIC, anon, authenticated;

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
  -- The schema computing, not a client writing. pg_trigger_depth covers writes arriving
  -- from another trigger; the setting covers the one SECURITY DEFINER function that
  -- creates these rows, which arrives at depth 1 and is otherwise indistinguishable from
  -- a person typing into the table.
  IF v_uid IS NULL
     OR pg_trigger_depth() > 1
     OR current_setting('byond.seeding_review_lines', true) = 'on' THEN
    RETURN NEW;
  END IF;

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
