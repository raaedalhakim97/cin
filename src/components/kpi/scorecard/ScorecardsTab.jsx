import { useState } from 'react'
import { BookOpen, LayoutList, UserCheck } from 'lucide-react'
import CriteriaLibrary from './CriteriaLibrary'
import TemplateBuilder from './TemplateBuilder'
import Assignments from './Assignments'

// Three screens that belong together and would each be too small to earn a tab of their
// own: what a company measures, the scorecards it builds out of that, and who is on which.
//
// The Criteria library is HR's alone. A manager who could invent criteria could invent a
// favourable one, and the anchors are the company's official language about people's work.
// Scorecards and assignments are shared with managers — a manager proposing a scorecard for
// their own team is the useful case, and the approval chain is what makes it safe.

const SECTIONS = [
  { id: 'criteria',    label: 'Criteria',   icon: BookOpen,   hrOnly: true,
    blurb: 'What can be measured, and what each level means.' },
  { id: 'scorecards',  label: 'Scorecards', icon: LayoutList, hrOnly: false,
    blurb: 'Criteria and weights, approved as a set.' },
  { id: 'people',      label: 'People',     icon: UserCheck,  hrOnly: false,
    blurb: 'Who is measured on which scorecard.' },
]

export default function ScorecardsTab({ companyId, role, me, showToast }) {
  const isHr = role === 'super_admin' || role === 'hr_manager'
  const sections = SECTIONS.filter((s) => !s.hrOnly || isHr)
  const [active, setActive] = useState(sections[0]?.id ?? 'scorecards')
  const current = sections.find((s) => s.id === active) ?? sections[0]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] w-fit max-w-full">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id} type="button" onClick={() => setActive(id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              active === id
                ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
            }`}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {current && (
        <p className="text-xs text-[#AAAAAA] dark:text-[#555555] -mt-3">{current.blurb}</p>
      )}

      {active === 'criteria' && isHr && (
        <CriteriaLibrary companyId={companyId} canEdit={isHr} showToast={showToast} />
      )}
      {active === 'scorecards' && (
        <TemplateBuilder companyId={companyId} role={role} showToast={showToast} />
      )}
      {active === 'people' && (
        <Assignments companyId={companyId} role={role} me={me} showToast={showToast} />
      )}
    </div>
  )
}
