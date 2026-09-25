import { useEffect, useState } from 'react'
import { ClipboardCheck, Loader2, CheckCircle2 } from 'lucide-react'
import supabase from '../../services/supabase'

// The employee's quarterly self-assessment.
//
// Once a quarter, once. The card appears only while HR has a cycle open for
// self-review and the employee has not yet submitted; after they submit it
// disappears until the next quarter's cycle opens. The kpi_review_guard trigger
// enforces the same rule — a second write is refused — so this card mirrors a
// database rule rather than inventing a UI-level one.
//
// Results are not shown here. Once a quarter is published the employee sees
// their score on the Evaluation tab.

export default function SelfReviewCard({ employeeId, showToast }) {
  const [state, setState] = useState({ loading: true, cycle: null, review: null })
  const [score, setScore] = useState('')
  const [comment, setComment] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    // No synchronous setState here: with no employeeId there is nothing to
    // fetch, and the card already renders nothing while `cycle` is null.
    if (!employeeId) return undefined
    let cancelled = false
    async function load() {
      // The open cycle, if any. Only one stage accepts a self-assessment.
      const { data: cycles, error: cErr } = await supabase
        .from('kpi_review_cycles')
        .select('*')
        .eq('status', 'self_review')
        .order('period_year', { ascending: false })
        .order('period_quarter', { ascending: false })
        .limit(1)
      if (cancelled) return
      if (cErr) {
        console.error('[SelfReviewCard] cycle load failed', cErr)
        setState({ loading: false, cycle: null, review: null })
        return
      }
      const cycle = cycles?.[0] ?? null
      if (!cycle) { setState({ loading: false, cycle: null, review: null }); return }

      const { data: review } = await supabase
        .from('kpi_reviews')
        .select('id, self_submitted_at')
        .eq('cycle_id', cycle.id)
        .eq('employee_id', employeeId)
        .maybeSingle()
      if (cancelled) return

      setState({ loading: false, cycle, review: review ?? null })
    }
    load()
    return () => { cancelled = true }
  }, [employeeId, reloadKey])

  const { loading, cycle, review } = state
  if (!employeeId || loading || !cycle || !review || review.self_submitted_at) return null

  function askToConfirm() {
    const n = Number(score)
    if (score === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      showToast('error', 'Give yourself a score between 0 and 100.')
      return
    }
    setConfirming(true)
  }

  async function submit() {
    setSaving(true)
    // Only these two columns are sent. The trigger would revert anything else
    // anyway, and sending fields you are not allowed to set makes a confusing
    // failure look like a bug in the form.
    const { error } = await supabase
      .from('kpi_reviews')
      .update({ self_score: Number(score), self_comment: comment.trim() || null })
      .eq('id', review.id)
    setSaving(false)
    setConfirming(false)
    if (error) {
      console.error('[SelfReviewCard] submit failed', error)
      const known = error.message?.startsWith('Self-assessment is not open')
        || error.message?.startsWith('You already submitted')
      showToast('error', known
        ? error.message
        : 'Something went wrong saving your self-assessment. Please try again.')
      setReloadKey((k) => k + 1)
      return
    }
    showToast('success', 'Self-assessment submitted. The next one opens next quarter.')
    setReloadKey((k) => k + 1)
  }

  return (
    <div className="p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-[#4D9FFF]/10 flex items-center justify-center shrink-0">
          <ClipboardCheck size={16} className="text-[#4D9FFF]" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[#1A1A1A] dark:text-white">
            Self-assessment — {cycle.period_year} Q{cycle.period_quarter}
          </h3>
          {cycle.self_due && (
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
              Due {new Date(cycle.self_due + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-3 mb-4 max-w-lg">
        Score your own quarter out of 100. You submit once — after that it is locked until
        next quarter. Your manager scores you separately and cannot change what you write here.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Your score</label>
          <input
            type="number" min={0} max={100} value={score} disabled={confirming}
            onChange={(e) => setScore(e.target.value)}
            className="w-24 px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] disabled:opacity-60"
          />
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
            Anything your manager should know <span className="font-normal text-[#666666] dark:text-[#A0A0A0]">(optional)</span>
          </label>
          <input
            type="text" value={comment} maxLength={2000} disabled={confirming}
            onChange={(e) => setComment(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] disabled:opacity-60"
          />
        </div>
        {!confirming && (
          <button
            type="button" onClick={askToConfirm}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
          >
            <CheckCircle2 size={14} />
            Submit
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-4 flex flex-wrap items-center gap-3 px-3.5 py-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
          <p className="text-sm text-[#1A1A1A] dark:text-white flex-1 min-w-[200px]">
            Submit {score}/100? You can&apos;t change it until next quarter.
          </p>
          <button
            type="button" onClick={() => setConfirming(false)} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:bg-white dark:hover:bg-[#1E1E1E] disabled:opacity-60 transition-colors"
          >
            Back
          </button>
          <button
            type="button" onClick={submit} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Yes, submit
          </button>
        </div>
      )}
    </div>
  )
}
