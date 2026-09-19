# Text density audit

**19 September 2026.** Prompted by a plain question: on a desktop monitor, is BYOND's
text too small?

Nothing in this document has been changed in the code. It is a survey and a
recommendation, so the decision about how far to go stays with Raaed.

## Method

Counted every Tailwind utility in `src/` that renders below 14px — `text-xs` (12px),
`text-[11px]` and `text-[10px]` — then classified each by the role of the element it sits
on, and separately by who actually looks at the screen.

Sizes assume the default 16px root; `index.css` does not override it.

## The headline: the app is not uniformly too small

This was the assumption going in and it turned out to be wrong, which is worth saying
plainly because it changes what is worth doing.

Where the numbers matter most, BYOND already uses the correct pattern — a small label
above a large value:

| Screen | Label | Value |
| --- | --- | --- |
| Payroll — Gross / Deductions | 12px | **20px bold** |
| Payroll — Net Salary | 12px | **24px bold** |
| Attendance — Clock In / Out | 12px | **20px bold** |
| Attendance — Total hours | 12px | 16px bold |
| KPI — self score, final score | 12px | 18px bold |

That is textbook hierarchy. A 12px label is doing its job there: it is the quiet part, and
the eye goes to the number. None of those should change.

So the problem is not "12px is everywhere". It is that 12px is also being used for three
things it is bad at.

## The numbers

**774** sub-14px text utilities across **64 files**. By audience:

| Count | Share | Who sees it |
| ---: | ---: | --- |
| 619 | 79% | **The product** — employees and HR, every day |
| 130 | 17% | **Platform pages** — only Raaed |
| 25 | 3% | Marketing and legal — public, always dark |

Within the 619 that real users see, by the role of the element:

| Count | Share | Role | Verdict |
| ---: | ---: | --- | --- |
| 366 | 59% | Prose, values and helper text | **Mixed — this is where the work is** |
| 79 | 13% | Status pills and badges | Conventional, leave |
| 73 | 12% | Form labels | Borderline, see finding 2 |
| 57 | 9% | Buttons and clickable controls | **Fix, see finding 3** |
| 42 | 7% | Table column headers | Conventional, leave |
| 2 | 0% | Inputs | **Fix — see finding 4** |

## Findings, worst first

### 1. Long-form writing is set at 12px, and it is the writing that matters most

12px is at its worst for prose — a run of sentences someone has to read carefully rather
than glance at. Three places do exactly that, and all three are the sentence a person most
wants to read on that screen:

- `components/kpi/SelfReviewCard.jsx:190` — **`review.manager_comment`**. This is what your
  manager wrote about your performance, shown to you when the review is published. It is
  12px, grey `#666666`, in a tinted box. It is arguably the single most-read sentence in
  the whole product, and it is set smaller than the label above it is bold.
- `components/kpi/ManagerReviewTab.jsx:248` — **`r.self_comment`**, 12px grey italic. The
  employee's own account of their year, which the manager is reading *while deciding their
  score*.
- `components/NotificationBell.jsx:252` — **`r.body`**, 12px. The actual content of every
  notification; the title above it is the only part set larger.

**Recommendation:** 14px for these three, and for any field holding free text a person
wrote. Roughly 10–15 call sites. Low risk — they are paragraphs in flexible containers,
not table cells, so nothing reflows.

### 2. Form labels at 12px — 73 of them

Common enough in dense admin tools, and not wrong. But BYOND's forms are long (adding an
employee, building a scorecard, a leave request) and the label is the only thing telling
someone what a field is for.

**Recommendation:** 13px rather than 14px. It reads noticeably easier without changing any
row height, so no layout moves. Mechanical change, but wide — worth doing in one pass with
a careful look afterwards, not piecemeal.

### 3. 57 buttons and clickable controls at 12px

This is the one I would fix first after the prose. A 12px button label is small to read and
small to hit, and several of these are inside cards where the tap target is already tight.
Examples: `components/kpi/scorecard/Assignments.jsx:392`,
`components/kpi/scorecard/CriteriaLibrary.jsx:440`.

**Recommendation:** 14px, and check each one still clears a 44px touch height on a phone.
This is also an accessibility point, not only a comfort one.

### 4. Two inputs render their typed text at 12px

`components/kpi/scorecard/CriteriaLibrary.jsx:189` and
`components/kpi/scorecard/EvaluationTab.jsx:161`. Text somebody is typing should never be
the smallest thing on screen. Also worth knowing: **iOS Safari zooms the page whenever a
focused input is under 16px**, which is a real behaviour on a phone, not a preference.

**Recommendation:** 14px minimum, 16px if these are ever used on a phone. Two call sites.

### 5. Width, which is a separate question from size

Page content is capped between `max-w-sm` and `max-w-5xl` (1024px). On Raaed's 1901px-wide
window that leaves a lot of empty space while the text stays 12px, which is part of why it
reads as small — the eye compares text to the space around it, not to a ruler.

For prose a narrow measure is correct and should stay. For the **tables** — Employees,
Attendance, Payroll — a wider cap on large screens would let columns breathe, and is
probably more of the perceived fix than the font sizes are.

**Recommendation:** treat separately, and only for table screens.

## What I would not change

- **Table column headers (42).** 12px uppercase with letter-spacing is a deliberate
  convention and reads as chrome, which is what it is.
- **Status pills and badges (79).** 12px in a pill is standard and these are scanned, not
  read.
- **Avatar initials.** Sized to their circle.
- **The label half of every label/value pair.** Enlarging those flattens the hierarchy that
  currently makes payroll and attendance readable at a glance. This would actively make
  things worse.
- **The 130 on Platform pages.** Only Raaed sees them. Real, lowest priority.

## Suggested order

1. **Finding 1** — prose to 14px. ~10–15 sites, low risk, largest gain per edit.
2. **Finding 4** — the two inputs. Two sites, and one of them is an iOS zoom bug.
3. **Finding 3** — buttons to 14px, checking touch heights. 57 sites.
4. **Finding 5** — wider tables on large screens. Needs a look at each table.
5. **Finding 2** — form labels to 13px. 73 sites, mechanical, do last.

Steps 1, 2 and 3 are the ones that answer the original question. Steps 4 and 5 are polish.

## One thing this audit does not cover

Contrast. `#666666` on `#F5F5F0` measures about 5.2:1 and passes, so the greys are legible
even where they are small. The error red was the one failure and was fixed separately
(see `--danger` in `src/index.css`). But 12px grey prose is hard to read even when it
technically passes, and that is the point of finding 1: passing a contrast check and being
comfortable to read are not the same test.
