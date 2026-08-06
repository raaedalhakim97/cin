import { useEffect, useState } from 'react'
import { ClipboardCheck, Loader2, Lock, CheckCircle2 } from 'lucide-react'
import supabase from '../../services/supabase'

// The employee's quarterly self-assessment.
//
// Only appears when HR has actually opened a cycle — self_score is writable for
// exactly one stage, and the kpi_review_guard trigger reverts anything an
// employee writes outside it. So this card mirrors a database rule rather than
// inventing a UI-level one: if it is not shown, the write would not have landed.
//
// Once submitted and the stage moves on, the score becomes read-only. That is
// deliberate — a self-assessment the employee can revise after seeing their
// manager's score is not a self-assessment.

const STAGE_MESSAGE = {
  manager_review: 'Your manager is reviewing now. Your own score is locked.',
  calculated:     'Scores have been calculated and are with HR.',
  published:      'This quarter is published.',
}

export default function SelfReviewCard({ employeeId, showToast }) {
  const [state, setState] = useState({ loading: true, cycle: null, review: null })
  const [score, setScore] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    // No synchronous setState here: with no employeeId there is nothing to
    // fetch, and the card already renders nothing while `cycle` is null.
    if (!employeeId) return undefined
    let cancelled = false
    async function load() {
      // The most recent cycle that is not finished, else the latest published
      // one so a just-published result is still visible here.
      const { data: cycles, error: cErr } = await supabase
        .from('kpi_review_cycles')
        .select('*')
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
        .select('*')
        .eq('cycle_id', cycle.id)
        .eq('employee_id', employeeId)
        .maybeSingle()
      if (cancelled) return

      setScore(review?.self_score != null ? String(review.self_score) : '')
      setComment(review?.self_comment ?? '')
      setState({ loading: false, cycle, review: review ?? null })
    }
    load()
    return () => { cancelled = true }
  }, [employeeId, reloadKey])

  const { loading, cycle, review } = state
  if (!employeeId || loading || !cycle || !review) return null

  const isOpen = cycle.status === 'self_review'
  const submitted = !!review.self_submitted_at

  async function submit() {
    const n = Number(score)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      showToast('error', 'Give yourself a score between 0 and 100.')
      return
    }
    setSaving(true)
    // Only these two columns are sent. The trigger would revert anything else
    // anyway, and sending fields you are not allowed to set makes a confusing
    // failure look like a bug in the form.
    const { error } = await supabase
      .from('kpi_reviews')
      .update({ self_score: n, self_comment: comment.trim() || null })
      .eq('id', review.id)
    setSaving(false)
    if (error) {
      console.error('[SelfReviewCard] submit failed', error)
      showToast('error', error.message?.startsWith('Self-assessment is not open')
        ? error.message
        : 'Something went wrong saving your self-assessment. Please try again.')
      return
    }
    showToast('success', 'Self-assessment saved')
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
          {isOpen && cycle.self_due && (
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
              Due {new Date(cycle.self_due + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}
            </p>
          )}
        </div>
      </div>

      {isOpen ? (
        <>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-3 mb-4 max-w-lg">
            Score your own quarter out of 100. Your manager scores you separately and cannot change
            what you write here. Once self-assessment closes this becomes read-only.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Your score</label>
              <input
                type="number" min={0} max={100} value={score}
                onChange={(e) => setScore(e.target.value)}
                className="w-24 px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0]"
              />
            </div>
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
                Anything your manager should know <span className="font-normal text-[#AAAAAA] dark:text-[#555555]">(optional)</span>
              </label>
              <input
                type="text" value={comment} maxLength={2000}
                onChange={(e) => setComment(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0]"
              />
            </div>
            <button
              type="button" onClick={submit} disabled={saving}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {submitted ? 'Update' : 'Submit'}
            </button>
          </div>

          {submitted && (
            <p className="text-xs text-[#00D4A0] mt-3">
              Submitted {new Date(review.self_submitted_at).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {' '}— you can still change it until self-assessment closes.
            </p>
          )}
        </>
      ) : (
        <div className="mt-3">
          <div className="flex items-start gap-2 px-3.5 py-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
            <Lock size={13} className="text-[#666666] dark:text-[#A0A0A0] shrink-0 mt-0.5" />
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
              {STAGE_MESSAGE[cycle.status] ?? 'Self-assessment is not open for this quarter.'}
            </p>
          </div>

          {submitted && (
            <div className="mt-4 grid grid-cols-2 gap-3 max-w-md">
              <div className="px-3.5 py-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-0.5">You scored yourself</p>
                <p className="text-lg font-bold text-[#1A1A1A] dark:text-white">{Number(review.self_score).toFixed(0)}<span className="text-xs font-normal">/100</span></p>
              </div>
              {cycle.status === 'published' && review.final_score != null && (
                <div className="px-3.5 py-3 rounded-lg bg-[#00D4A0]/10">
                  <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-0.5">Final for the quarter</p>
                  <p className="text-lg font-bold text-[#00D4A0]">
                    {Number(review.final_score).toFixed(1)}
                    {review.rating && <span className="text-xs font-semibold"> · {review.rating}</span>}
                  </p>
                </div>
              )}
            </div>
          )}

          {cycle.status === 'published' && review.manager_comment && (
            <div className="mt-3 px-3.5 py-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525] max-w-lg">
              <p className="text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Your manager wrote</p>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{review.manager_comment}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
