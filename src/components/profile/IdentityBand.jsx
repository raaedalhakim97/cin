import { Hash } from 'lucide-react'
import ProfileIntro from './ProfileIntro'

// The identity band at the top of /profile, and the four facts under it.
//
// Replaces the narrow left-hand identity card. That card printed the employee code twice —
// once as a chip and again as the first Employment row — and sat in a third of a 896px
// column, which left the other two thirds to carry every detail on the page.
//
// ── The four facts, and where each one is allowed to come from ─────────────
//
// Nothing here is computed from anything the page does not already load, and nothing is
// invented when a value is missing. Every fact has a defined empty state, because on a
// real company most of them will be empty on day one:
//
//   TENURE      hire_date. Absent until HR sets one, and then the band shows no tenure
//               rather than "0 mo", which would read as a fact about a new joiner.
//   DEPARTMENT  the employee's own department, plus their manager's name when the
//               my_manager() reader returns one. Both unset company-wide today, so the
//               sub-line is usually absent — by design, not by failure.
//   DOCUMENTS   how many document types have a file against them, out of how many the
//               company defines. Lifted from the same query the grid below already runs.
//   CONSENT     how many of the consent policies this person has never answered. Amber
//               when there are any, because an undecided policy is the one fact on this
//               strip the employee can act on themselves.
//
// Nothing here states a performance rating. The intro says it instead, by putting the
// person inside the O the acronym marks, and then the ring stays. Printing "Outstanding"
// underneath would turn a gesture into an assertion — and one the product would have to
// make about somebody it has not finished measuring, since a rating is withheld below half
// coverage on purpose.

// Per-cell rules. 2×2 on a phone, 4×1 from lg up.
//   phone   right rule on the left-hand cell of each row; bottom rule under the first row
//   desktop right rule on every cell but the last; no bottom rules at all
const FACT_EDGES = [
  'border-r border-b lg:border-b-0',
  'lg:border-r border-b lg:border-b-0',
  'border-r',
  '',
]

function FactCell({ label, value, sub, tone }) {
  return (
    <div className="px-5 py-4 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#666666] dark:text-[#A0A0A0]">
        {label}
      </p>
      {/* Wraps rather than truncates. A department called "Operations" fits on a phone and
          "Commercial and Partnerships" does not — and clipping it to "Commercial an…"
          loses the half that identifies it. The grid row grows to its tallest cell, which
          costs a line of height on a narrow screen and keeps the fact readable. */}
      <p
        className={`text-lg font-bold mt-1 wrap-break-word ${
          tone === 'attention' ? 'text-[#FF8C42]' : 'text-[#1A1A1A] dark:text-white'
        }`}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 wrap-break-word">{sub}</p>
      )}
    </div>
  )
}

export default function IdentityBand({
  employee,
  manager,
  tenure,
  documents,
  consent,
  onIntroDone,
}) {
  const initial = employee.full_name?.[0]?.toUpperCase() ?? '?'
  const department = employee.departments?.name ?? null

  const facts = [
    {
      label: 'Tenure',
      value: tenure?.label ?? '—',
      sub: tenure?.since ?? 'No hire date on file',
    },
    {
      label: 'Department',
      value: department ?? '—',
      sub: manager?.manager_name ? `${manager.manager_name}'s team` : null,
    },
    {
      label: 'Documents',
      value: documents ? `${documents.onFile} of ${documents.total}` : '—',
      sub: documents ? 'on file' : null,
    },
    {
      label: 'Consent',
      value: consent
        ? consent.undecided > 0
          ? `${consent.undecided} to decide`
          : 'All decided'
        : '—',
      sub: consent ? `of ${consent.total} policies` : null,
      tone: consent?.undecided > 0 ? 'attention' : undefined,
    },
  ]

  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
      {/* The intro covers this block and nothing below it.
          Covering the whole card looked fine on a desktop, where the band is short. On a
          phone the fact strip stacks 2×2 and the card is roughly twice as tall, so a
          full-height white curtain with a small O near the top read as a page that had
          failed to load rather than as a flourish. Scoped here, the facts stay on screen
          throughout and the person resolves into a card that is already populated. */}
      <div className="relative flex flex-col items-center text-center gap-3 px-6 pt-8 pb-7">
        <ProfileIntro employeeId={employee.id} initial={initial} onDone={onIntroDone} />
        {/* The ring stays. It is where the O settles at the end of the intro, and leaving
            it there is what keeps the idea true for the rest of the time somebody spends
            on this page — and for everybody who skipped the animation, saw it once months
            ago, or has prefers-reduced-motion set. An idea that only exists during a
            1.8-second window is a trick; one that stays is a mark. */}
        <div className="relative flex items-center justify-center w-[108px] h-[108px] shrink-0">
          <div className="absolute inset-0 rounded-full border-[3px] border-[#00D4A0]" />
          <div className="w-[84px] h-[84px] rounded-full bg-[#00D4A0] flex items-center justify-center text-[#062B22] text-[34px] font-bold">
            {initial}
          </div>
        </div>

        <div className="min-w-0 max-w-full">
          <h2 className="text-2xl font-bold text-[#1A1A1A] dark:text-white wrap-break-word">
            {employee.full_name}
          </h2>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
            {[employee.job_title, department].filter(Boolean).join(' · ') || 'No job title set'}
          </p>
        </div>

        {/* No rating here, and no "Outstanding" written anywhere. The avatar sitting inside
            the O says it, and saying it twice would turn a courtesy into a claim — one the
            product could not stand behind, since a published rating needs half the quarter
            assessed before kpi_rating_label will issue one at all. */}
        {employee.emp_code && (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold font-mono border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0]">
            <Hash size={11} />{employee.emp_code}
          </span>
        )}
      </div>

      {/* Four across on desktop, 2×2 on a phone. Dividers are borders on the cells rather
          than a gap over a coloured background, so the strip never shows a hanging rule
          where a row ends.

          The classes are written out per position rather than computed from the index.
          A conditional that emitted both `lg:border-r` and `lg:border-r-0` for the last
          cell would resolve by CSS source order, not by the order they appear in the
          string — which is the kind of thing that looks right until a Tailwind upgrade
          reorders its output. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
        {facts.map((f, i) => (
          <div
            key={f.label}
            className={`border-[#E8E8E8] dark:border-[#2A2A2A] ${FACT_EDGES[i]}`}
          >
            <FactCell {...f} />
          </div>
        ))}
      </div>
    </div>
  )
}
