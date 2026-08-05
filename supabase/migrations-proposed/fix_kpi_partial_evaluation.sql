-- PROPOSED — not applied. Review before running.
--
-- Fixes the KPI model's treatment of missing data, per docs/kpi-math-audit.md.
--
-- Problem: compute_kpi_total wraps every component in COALESCE(x, 0) while
-- keeping the divisor at 100%, so "not yet evaluated" scores the same as
-- "scored zero". Measured effect on live data: one employee moved from 90.90
-- Exceptional to 31.61 Unsatisfactory between consecutive months purely because
-- three of five components had not been entered. Art. 14 makes Unsatisfactory a
-- termination-risk rating and Art. 16 starts a 30-day PIP below 60, so an
-- unentered evaluation could begin a disciplinary process.
--
-- The three parts below must go together, in this order, in one transaction:
--   1. Replace the trigger function to renormalise over populated weight.
--   2. Stop defaulting component columns to 0, so future rows can say "unknown".
--   3. Backfill legacy zeros that mean "unentered" to NULL.
--
-- Measured dry run over all 123 existing rows: 121 are fully evaluated and are
-- mathematically unaffected (with all five components present the denominator is
-- already 100, so the formula is identical). 2 rows change, both from a false
-- Unsatisfactory to no rating. 0 rows become newly bonus-eligible.

begin;

-- ── 1. Renormalising total ──────────────────────────────────────────────────

create or replace function public.compute_kpi_total()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  s               record;
  w_att  integer := 30;
  w_beh  integer := 25;
  w_ach  integer := 20;
  w_mgr  integer := 15;
  w_self integer := 10;
  v_mgr           numeric;
  v_self          numeric;
  v_num           numeric := 0;  -- sum of score x weight, populated only
  v_den           integer := 0;  -- sum of weight, populated only
  v_den_not_self   integer := 0; -- populated weight excluding the self component
  v_total_weight  integer;
  v_coverage      numeric;
  -- Minimum share of the assessment that must exist before a rating is issued.
  -- Below this the score is informational only. Could move to kpi_settings if a
  -- tenant ever needs to vary it.
  c_min_coverage  numeric := 50;
begin
  select * into s from public.kpi_settings where company_id = new.company_id;
  if found then
    w_att  := s.weight_attendance;
    w_beh  := s.weight_behavior;
    w_ach  := s.weight_achievement;
    w_mgr  := s.weight_manager;
    w_self := s.weight_self;
  end if;
  v_total_weight := w_att + w_beh + w_ach + w_mgr + w_self;

  -- Carry a previous manager/self score forward when one exists, but leave NULL
  -- when there is no history. The previous version coalesced to 0, which made
  -- "never evaluated" permanently indistinguishable from "scored zero".
  v_mgr := new.manager_score;
  if v_mgr is null then
    select manager_score into v_mgr
    from public.kpi_scores
    where employee_id = new.employee_id
      and manager_score is not null
      and (period_year, period_month) < (new.period_year, new.period_month)
    order by period_year desc, period_month desc
    limit 1;
  end if;

  v_self := new.self_score;
  if v_self is null then
    select self_score into v_self
    from public.kpi_scores
    where employee_id = new.employee_id
      and self_score is not null
      and (period_year, period_month) < (new.period_year, new.period_month)
    order by period_year desc, period_month desc
    limit 1;
  end if;

  new.manager_score := v_mgr;
  new.self_score    := v_self;

  -- Accumulate only what is actually known. NULL means not evaluated; 0 is a
  -- real score and is counted (a month of unauthorised absence must still drag
  -- the attendance component down).
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
  if v_mgr is not null then
    v_num := v_num + v_mgr * w_mgr;
    v_den := v_den + w_mgr;  v_den_not_self := v_den_not_self + w_mgr;
  end if;
  if v_self is not null then
    v_num := v_num + v_self * w_self;
    v_den := v_den + w_self;
  end if;

  v_coverage := case when v_total_weight > 0
                     then round(v_den * 100.0 / v_total_weight, 1) else 0 end;

  -- total_score is NOT NULL, so an entirely unevaluated row stores 0 — but it
  -- carries no rating, which is what stops 0 reading as a verdict.
  new.total_score := case when v_den > 0 then round(v_num / v_den, 2) else 0 end;

  -- A rating requires two things:
  --   * enough of the assessment to exist, and
  --   * at least one component the employee does not control.
  -- self_score is written by the employee themselves, so without the second
  -- condition someone could self-award 100 and be rated Exceptional on 10% of
  -- the assessment.
  if v_den > 0 and v_coverage >= c_min_coverage and v_den_not_self > 0 then
    new.rating          := public.kpi_rating_label(new.total_score);
    new.bonus_eligible  := new.total_score >= 75;
  else
    new.rating          := null;
    new.bonus_eligible  := false;
  end if;

  -- Coverage is recorded so the UI can say "79.04 based on 40% of the
  -- assessment" without a schema change.
  new.weights_used := jsonb_build_object(
    'attendance',     w_att,
    'behavior',       w_beh,
    'achievement',    w_ach,
    'manager',        w_mgr,
    'self',           w_self,
    'covered_weight', v_den,
    'total_weight',   v_total_weight,
    'coverage_pct',   v_coverage
  );

  return new;
end;
$$;

-- ── 2. Stop defaulting components to 0 ──────────────────────────────────────
-- With a default of 0, every inserted row claimed a score of zero for
-- components nobody had filled in yet. NULL is the honest value.

alter table public.kpi_scores alter column attendance_score  drop default;
alter table public.kpi_scores alter column behavior_score    drop default;
alter table public.kpi_scores alter column achievement_score drop default;

-- ── 3. Backfill legacy zeros that mean "unentered" ──────────────────────────
-- behavior_score and achievement_score are entered by a human evaluator; a
-- stored 0 means nobody entered one, since a deliberate zero would be recorded
-- through the warning system rather than as a score. Same for manager_score,
-- where the old trigger wrote 0 whenever there was no history.
--
-- attendance_score is deliberately NOT backfilled: it is machine-derived, and 0
-- is a legitimate value (a month of unauthorised absence). Verified that no
-- existing row has attendance_score = 0, so there is nothing to disambiguate.

update public.kpi_scores set behavior_score    = null where behavior_score    = 0;
update public.kpi_scores set achievement_score = null where achievement_score = 0;
update public.kpi_scores set manager_score     = null where manager_score     = 0;

commit;

-- Not addressed here, tracked in docs/kpi-math-audit.md:
--   * calculate_attendance_score returns 0 for a month with no attendance rows.
--     Returning NULL would let this function exclude it, but that changes the
--     contract for the attendance_score_sync trigger and belongs in its own
--     migration.
--   * absent_approved scores 80, penalising leave the handbook grants neutrally
--     (Art. 5 gives approved absence a KPI impact of 0). That is a data change to
--     kpi_settings.attendance_point_values, not code.
--   * The per-day-average model is 4-5x more lenient than Art. 5's absolute point
--     deductions. Reconciling those two is a policy decision, not a fix.
