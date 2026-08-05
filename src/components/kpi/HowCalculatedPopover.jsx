import { useEffect, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'

// Mirrors the default weights baked into kpi_settings before any company
// customizes them (KPI.jsx's original 30/25/20/15/10 split) — used only as a
// display fallback for score rows saved before weights_used existed.
const DEFAULT_WEIGHTS = { attendance: 30, behavior: 25, achievement: 20, manager: 15, self: 10 }

const ROWS = [
  { key: 'attendance', scoreKey: 'attendance_score', label: 'Attendance' },
  { key: 'behavior', scoreKey: 'behavior_score', label: 'Behavior' },
  { key: 'achievement', scoreKey: 'achievement_score', label: 'Achievement' },
  { key: 'manager', scoreKey: 'manager_score', label: 'Manager Evaluation' },
  { key: 'self', scoreKey: 'self_score', label: 'Self Evaluation' },
]

function num(v) {
  return Number(v || 0)
}

// weights_used is flat jsonb with integer values, e.g.
// {"attendance":30,"behavior":25,"achievement":20,"manager":15,"self":10}
// (confirmed via migration 26's handoff). Only pre-migration-24 score rows
// (written before weights_used existed) fall back to the old default split.
function extractWeights(weightsUsed) {
  if (!weightsUsed || typeof weightsUsed !== 'object') {
    return { weights: DEFAULT_WEIGHTS, isDefault: true }
  }
  return {
    weights: {
      attendance: num(weightsUsed.attendance),
      behavior: num(weightsUsed.behavior),
      achievement: num(weightsUsed.achievement),
      manager: num(weightsUsed.manager),
      self: num(weightsUsed.self),
    },
    isDefault: false,
  }
}

export default function HowCalculatedPopover({ row, align = 'left', className = '', compact = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!row) return null

  const { weights, isDefault } = extractWeights(row.weights_used)
  const contributions = ROWS.map(r => {
    const score = num(row[r.scoreKey])
    const weight = num(weights[r.key])
    return { ...r, score, weight, contribution: (score * weight) / 100 }
  })
  const computedTotal = contributions.reduce((sum, r) => sum + r.contribution, 0)
  const displayedTotal = row.total_score != null ? num(row.total_score) : computedTotal

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          title="How is this calculated?"
          className="flex items-center justify-center w-5 h-5 rounded-full text-[#AAAAAA] dark:text-[#555555] hover:text-[#00D4A0] hover:bg-[#00D4A0]/10 transition-colors"
        >
          <Info size={13} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-xs font-semibold text-[#00D4A0] hover:underline"
        >
          <Info size={12} />
          How is this calculated?
        </button>
      )}

      {open && (
        <div
          className={`absolute z-30 top-full mt-2 w-72 p-4 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-[#1A1A1A] dark:text-white">Score Calculation</p>
            <button onClick={() => setOpen(false)} className="text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white">
              <X size={13} />
            </button>
          </div>

          <div className="space-y-1.5">
            {contributions.map(r => (
              <div key={r.key} className="flex items-center justify-between text-[11px]">
                <span className="text-[#666666] dark:text-[#A0A0A0]">{r.label}</span>
                <span className="font-mono text-[#1A1A1A] dark:text-white">
                  {r.score.toFixed(0)} × {r.weight}% = <span className="font-semibold">{r.contribution.toFixed(1)}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
            <span className="text-xs font-bold text-[#1A1A1A] dark:text-white">Total</span>
            <span className="text-sm font-bold text-[#00D4A0]">{displayedTotal.toFixed(1)}</span>
          </div>

          <p className="text-[10px] text-[#AAAAAA] dark:text-[#555555] mt-2">
            {isDefault
              ? 'Weights not recorded for this score — showing default 30/25/20/15/10 split.'
              : "Weights are set by your company's KPI Configuration and locked in per score."}
          </p>
        </div>
      )}
    </div>
  )
}
