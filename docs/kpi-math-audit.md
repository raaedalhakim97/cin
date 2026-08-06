# Automatic KPI math — audit against live data

> **Resolved 2026-08-05.** Finding 1 is fixed and applied as three migrations
> (`fix_kpi_partial_evaluation`, `exclude_carried_forward_scores_from_rating`,
> `stop_carry_forward_manufacturing_scores` — the database is now at 54). Outcome
> on the 123 live rows: rows rated Unsatisfactory fell from 3 to 1 (the one
> genuine low score), 2 rows became "not yet rated" instead of falsely
> Unsatisfactory, and bonus-eligible rows returned to 61 — nobody gained a bonus.
> See "What was applied" at the foot of this file. Findings 2, 3 and 4 remain
> open.

Measured 2026-08-05 against the real `BYOND` company (`9e43e4ca…`). No seeded or
fictional rows were used; every number below comes from rows already in the
database.

## The formula as implemented

**Attendance component** — `calculate_attendance_score(employee, year, month, company)`
averages a per-day score over every attendance row in the month:

| status | points |
|---|---|
| `present` | 100 |
| `late_minor` | 85 |
| `late_moderate` | 70 |
| `late_major` | 50 |
| `absent_approved` | **80** |
| `absent_unauthorized` | 0 |

`score = round(avg(points), 2)`, clamped to 0–100. **With no rows it returns 0.**
Written into `kpi_scores.attendance_score` by the `attendance_score_sync` trigger.

**Total** — `compute_kpi_total`, on every write to `kpi_scores`:

```
total = attendance·w_att/100 + behavior·w_beh/100 + achievement·w_ach/100
      + manager·w_mgr/100  + self·w_self/100
```

with each component wrapped in `COALESCE(component, 0)`. Live weights are
**30/25/20/15/10** and sum to 100 ✓ (Art. 14). Bands and the bonus threshold match
Art. 14 exactly: ≥90 Exceptional, ≥75 High Performer (and `bonus_eligible`), ≥60
Meets, ≥45 Needs Improvement, else Unsatisfactory.

## The arithmetic is correct

Recomputed all three live score rows independently. `stored_total` equals
`recomputed_total` in every case, and the attendance averages reproduce exactly
(84.38, 75.00). There is no arithmetic bug. Every problem below is in the *model*,
not the implementation of it.

## Finding 1 — missing data is scored as zero (severe)

`COALESCE(component, 0)` treats *not yet evaluated* as *scored zero*, while leaving
the divisor at the full 100%. Measured consequence, same employee, consecutive
months:

| Period | att | beh | ach | mgr | self | total | rating |
|---|---|---|---|---|---|---|---|
| EMP-0001, 2026-06 | 95.00 | 88 | 92 | 90 | 85 | **90.90** | Exceptional |
| EMP-0001, 2026-07 | 84.38 | **0** | **0** | **0** | 63 | **31.61** | Unsatisfactory |
| EMP-0004, 2026-07 | 75.00 | **0** | **0** | **0** | 0 | **22.50** | Unsatisfactory |

EMP-0001 did not get worse. Their attendance is 84.38 and they self-rated 63. Three
of five components simply have not been entered yet, and that alone moved them from
Exceptional to Unsatisfactory.

With only attendance and self populated, the arithmetic ceiling is 30 + 10 = **40
points**. Passing is impossible regardless of performance.

This is not cosmetic. Art. 14 makes Unsatisfactory "Formal review / risk of
termination", and Art. 16 puts anyone below 60 for two consecutive months on a
30-day PIP. As written, an unentered evaluation can start a disciplinary process.

**Fix — renormalise over the weights that exist:**

```
total = Σ(scoreᵢ · wᵢ) / Σ(wᵢ for populated i)
```

EMP-0001 July becomes (84.38·30 + 63·10) / 40 = **79.04**, High Performer — a
defensible reading of "good attendance, self-rated 63, not yet reviewed". Pair it
with withholding a rating until some minimum share of weight is populated, so a
partial score is never presented as a verdict.

## Finding 2 — no attendance rows scores 0, not "no data"

`IF v_total_days = 0 THEN RETURN 0`. A new joiner, or any month before the first
clock-in, scores zero on 30% of the total.

Related: EMP-0001's June row stores `attendance_score = 95.00` but the month has
**zero attendance rows**. So the stored value and what the function would now
produce disagree — the auto-calculation and whatever wrote that 95 are two sources
of truth with nothing reconciling them.

## Finding 3 — approved leave is penalised

`absent_approved` scores **80**, so each approved leave day drags the average down.
Art. 5's table gives approved absence a KPI impact of **0** — neutral. Taking leave
the handbook grants should not cost KPI points. Either the point value becomes 100,
or approved-leave days are excluded from the average entirely.

## Finding 4 — the model diverges structurally from the handbook

Art. 5 expresses attendance as **absolute point deductions** from the KPI (−1
minor, −2 moderate, −3 major, −5 unauthorised). The database instead **averages
per-day scores and weights the result at 30%**. These are different models, and the
database is far more lenient:

| Event, once in a 22-day month | Handbook | As implemented |
|---|---|---|
| Late 6–15 min | −1.00 KPI pt | −0.20 KPI pt |
| Late > 30 min | −3.00 | −0.68 |
| Unauthorised absence | −5.00 | −1.36 |

Roughly 4–5× weaker than the signed policy. Whichever model is intended, both
documents currently describe the product and they do not agree.

## Finding 5 — silent carry-forward

When `manager_score` or `self_score` is NULL, `compute_kpi_total` copies the most
recent earlier month's value, falling back to 0. A stale evaluation is therefore
presented as the current month's, and `weights_used` records nothing to indicate
the number was inherited rather than given.

## Verified correct

- Weights sum to 100; live values are the Art. 14 split.
- Rating bands and the ≥75 bonus threshold match Art. 14 exactly.
- No attendance status in real data falls outside the point map — though note the
  function's `COALESCE` fallback would silently score an unmapped status as
  `present`/100, so a future status added without updating the map scores as a
  perfect day.
- `recompute_kpi_totals` does **not** recalculate `attendance_score`; it only
  touches `updated_at` to re-fire the total trigger. Historical attendance values
  are not rewritten by it.


## What was applied, and what went wrong on the way

Three migrations, because the first two each exposed something the audit had
described but not connected.

**1. `fix_kpi_partial_evaluation`** — renormalise over populated weight, drop the
`0` defaults on the component columns, backfill legacy zeros to NULL for the two
human-entered components and `manager_score`.

**2. `exclude_carried_forward_scores_from_rating`** — because migration 1 had an
effect the dry run did not predict. Nulling the zeros in `manager_score`
*re-activated* the carry-forward those zeros had been suppressing: June's manager
score of 90 was pulled into July, and EMP-0001 went from 31.61 Unsatisfactory to
82.03 High Performer **and bonus-eligible**, on the strength of the previous
month's review. The dry run had missed this because it modelled "populated" as
`> 0` rather than simulating the post-backfill NULLs — it was not a faithful
simulation of the change being made.

**3. `stop_carry_forward_manufacturing_scores`** — because migration 2 could not
fix it either. Carry-forward *writes* the inherited value into the column, so by
the time migration 2 ran, the 90 was already stored and indistinguishable from a
real review; the `manager_inherited` flag it added recorded `false`. Carry-forward
is now informational only: the previous value is recorded in `weights_used` as
`previous_manager_score` for context, is never written to the column, and never
counts toward the total, coverage, rating or bonus.

Final state of the two affected rows:

| Row | att | self | coverage | total | rating | bonus |
|---|---|---|---|---|---|---|
| EMP-0001 · 2026-07 | 84.38 | 63 | 40% | **79.04** | not yet rated | no |
| EMP-0004 · 2026-07 | 75.00 | 0 | 40% | 56.25 | not yet rated | no |

79.04 is the figure this audit predicted for that row. Both are now honest: a real
score, no verdict until enough of the assessment exists.

The lesson worth keeping: a dry run that approximates the logic instead of
executing it will agree with you when you are wrong.
