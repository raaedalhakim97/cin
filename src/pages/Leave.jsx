import { useEffect, useState, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, Plus, Check, X, Loader2,
  AlertTriangle, CalendarDays, Users, FileText, CheckCircle2, Ban, Clock,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonBlock } from '../components/Skeleton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localDateStr(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function calcDays(s, e) {
  if (!s || !e) return 0
  const a = new Date(s + 'T00:00:00'), b = new Date(e + 'T00:00:00')
  return b < a ? 0 : Math.floor((b - a) / 86400000) + 1
}

function fmtDate(str) {
  if (!str) return '—'
  return new Date(str + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEAVE_TYPES = [
  { value: 'annual',      label: 'Annual Leave',     cls: 'bg-[#00D4A0]/10 text-[#00D4A0]', dot: 'bg-[#00D4A0]' },
  { value: 'sick',        label: 'Sick Leave',        cls: 'bg-[#FF8C42]/10 text-[#FF8C42]', dot: 'bg-[#FF8C42]' },
  { value: 'emergency',   label: 'Emergency Leave',   cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]', dot: 'bg-[#FF4D4D]' },
  { value: 'marriage',    label: 'Marriage Leave',    cls: 'bg-[#9B5DE5]/10 text-[#9B5DE5]', dot: 'bg-[#9B5DE5]' },
  { value: 'paternity',   label: 'Paternity Leave',   cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]', dot: 'bg-[#4D9FFF]' },
  { value: 'maternity',   label: 'Maternity Leave',   cls: 'bg-[#F15BB5]/10 text-[#F15BB5]', dot: 'bg-[#F15BB5]' },
  { value: 'hajj',        label: 'Hajj Leave',        cls: 'bg-[#FEE440]/15 text-[#A89200]', dot: 'bg-[#FEE440]' },
  { value: 'bereavement', label: 'Bereavement Leave', cls: 'bg-[#A0A0A0]/10 text-[#A0A0A0]', dot: 'bg-[#A0A0A0]' },
  { value: 'study',       label: 'Study Leave',       cls: 'bg-[#00BBF9]/10 text-[#00BBF9]', dot: 'bg-[#00BBF9]' },
]

const LT = Object.fromEntries(LEAVE_TYPES.map(t => [t.value, t]))

const STATUS_META = {
  pending:          { label: 'Pending',          cls: 'bg-[#FEE440]/15 text-[#A89200] dark:text-[#FEE440]' },
  manager_approved: { label: 'Manager Approved', cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  approved:         { label: 'Approved',          cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  rejected:         { label: 'Rejected',          cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
  cancelled:        { label: 'Cancelled',         cls: 'bg-[#A0A0A0]/10 text-[#A0A0A0]' },
}

// Requested → Manager → HR timeline for a single request, used in My Leave's
// history table. Rejected/cancelled are terminal, non-linear states — shown
// as a plain badge (plus which stage rejected it) rather than forced onto
// the 3-stage track.
function LeaveStageTimeline({ req }) {
  if (req.status === 'rejected') {
    const rejectedByManager = !!req.manager_reviewed_at && !req.reviewed_at
    return (
      <div className="flex items-center gap-1.5">
        <StatusBadge status="rejected" />
        <span className="text-[10px] text-[#666666] dark:text-[#A0A0A0]">
          {rejectedByManager ? 'by manager' : 'by HR'}
        </span>
      </div>
    )
  }
  if (req.status === 'cancelled') return <StatusBadge status="cancelled" />

  const stages = [
    { key: 'requested', label: 'Requested', done: true },
    { key: 'manager',   label: 'Manager',   done: req.status === 'manager_approved' || req.status === 'approved' },
    { key: 'hr',        label: 'HR',        done: req.status === 'approved' },
  ]
  const currentIdx = stages.findIndex(s => !s.done)

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            s.done ? 'bg-[#00D4A0]' : i === currentIdx ? 'bg-[#FF8C42]' : 'bg-[#E8E8E8] dark:bg-[#2A2A2A]'
          }`} />
          <span className={`text-[10px] whitespace-nowrap ${
            s.done ? 'text-[#00D4A0] font-semibold' : i === currentIdx ? 'text-[#FF8C42] font-semibold' : 'text-[#AAAAAA] dark:text-[#555555]'
          }`}>
            {s.label}
          </span>
          {i < stages.length - 1 && <span className="w-3 h-px bg-[#E8E8E8] dark:bg-[#2A2A2A] mx-0.5 shrink-0" />}
        </div>
      ))}
    </div>
  )
}

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TEAM_ROLES = new Set(['super_admin', 'hr_manager', 'department_manager'])

// ─── Shared input class ───────────────────────────────────────────────────────

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

// ─── Micro-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status]
  if (!m) return null
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>
}

function LeaveBadge({ type }) {
  const m = LT[type]
  if (!m) return <span className="text-xs text-[#666666]">{type}</span>
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>
}

// ─── Balance Card ─────────────────────────────────────────────────────────────

function BalanceCard({ type, balance }) {
  const meta     = LT[type]
  const entitled = balance?.entitled_days ?? 0
  const used     = balance?.used_days     ?? 0
  const remaining = entitled - used
  const pct      = entitled > 0 ? Math.min(100, Math.round((used / entitled) * 100)) : 0

  return (
    <div className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/30 transition-colors group">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta?.cls ?? 'bg-[#A0A0A0]/10 text-[#A0A0A0]'}`}>
          <CalendarDays size={15} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{meta?.label ?? type}</p>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
            {remaining >= 0 ? `${remaining}d remaining` : 'Exceeded'}
          </p>
        </div>
      </div>

      {/* Mint progress bar — width is a computed value, requires inline style */}
      <div className="h-1.5 bg-[#F0F0F0] dark:bg-[#2A2A2A] rounded-full mb-3 overflow-hidden">
        <div className="h-full bg-[#00D4A0] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-[#666666] dark:text-[#A0A0A0]">
          <span className="font-bold text-[#1A1A1A] dark:text-white">{used}</span> used
        </span>
        <span className="text-[#666666] dark:text-[#A0A0A0]">
          <span className="font-bold text-[#1A1A1A] dark:text-white">{entitled}</span> entitled
        </span>
      </div>
    </div>
  )
}

// ─── Request Modal ────────────────────────────────────────────────────────────

function RequestModal({ onClose, onSubmit, saving }) {
  const today = localDateStr(new Date())
  const [form, setForm] = useState({
    leave_type: 'annual',
    start_date: today,
    end_date:   today,
    reason:     '',
  })
  const [err, setErr] = useState('')

  const days = calcDays(form.start_date, form.end_date)
  const set  = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErr('') }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.start_date || !form.end_date) { setErr('Select both start and end dates.'); return }
    if (days === 0) { setErr('End date must be on or after start date.'); return }
    if (!form.reason.trim()) { setErr('Please provide a reason for your leave.'); return }
    await onSubmit(form, days)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Request Leave</h2>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">Submit a new leave request for approval</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {/* Leave type */}
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Leave Type</label>
            <select value={form.leave_type} onChange={e => set('leave_type', e.target.value)} className={INPUT}>
              {LEAVE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">From</label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => {
                  set('start_date', e.target.value)
                  if (form.end_date < e.target.value) set('end_date', e.target.value)
                }}
                className={INPUT}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">To</label>
              <input
                type="date"
                value={form.end_date}
                min={form.start_date}
                onChange={e => set('end_date', e.target.value)}
                className={INPUT}
              />
            </div>
          </div>

          {/* Day count pill */}
          {days > 0 && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[#00D4A0]/10 border border-[#00D4A0]/20">
              <CalendarDays size={15} className="text-[#00D4A0] shrink-0" />
              <span className="text-sm font-semibold text-[#00D4A0]">
                {days} day{days !== 1 ? 's' : ''} requested
              </span>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">
              Reason <span className="text-[#666666] dark:text-[#A0A0A0] font-normal">(required)</span>
            </label>
            <textarea
              rows={3}
              placeholder="Briefly describe your reason for requesting leave…"
              value={form.reason}
              onChange={e => set('reason', e.target.value)}
              className={`${INPUT} resize-none`}
            />
          </div>

          {err && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-sm text-[#FF4D4D]">
              <AlertTriangle size={13} className="shrink-0" />
              {err}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || days === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {saving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────

function RejectModal({ request, onClose, onConfirm, saving }) {
  const [reason, setReason] = useState('')
  const [err, setErr]       = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) { setErr('Please provide a rejection reason.'); return }
    await onConfirm(request, reason.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Reject Request</h2>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">This will notify the employee</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {/* Request summary */}
          <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-1">
              {request?.employees?.full_name ?? 'Employee'}
            </p>
            <div className="flex items-center gap-2">
              <LeaveBadge type={request?.leave_type} />
              <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                {fmtDate(request?.start_date)} → {fmtDate(request?.end_date)}
              </span>
              <span className="text-xs font-semibold text-[#1A1A1A] dark:text-white ml-auto">
                {request?.days_requested}d
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Rejection Reason</label>
            <textarea
              rows={3}
              placeholder="Explain why this request is being rejected…"
              value={reason}
              onChange={e => { setReason(e.target.value); setErr('') }}
              className={`${INPUT} resize-none focus:border-[#FF4D4D]`}
            />
          </div>

          {err && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-sm text-[#FF4D4D]">
              <AlertTriangle size={13} className="shrink-0" />
              {err}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              {saving ? 'Rejecting…' : 'Confirm Reject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── My Leave Tab ─────────────────────────────────────────────────────────────

function MyLeaveTab({ balances, requests, loading, onRequestLeave, onCancel, cancelLoadingId, canWrite }) {
  const balanceMap = Object.fromEntries((balances ?? []).map(b => [b.leave_type, b]))

  const pending  = (requests ?? []).filter(r => r.status === 'pending').length
  const approved = (requests ?? []).filter(r => r.status === 'approved').length

  return (
    <div className="space-y-8">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Pending',  value: pending,  cls: 'text-[#FEE440]' },
          { label: 'Approved', value: approved, cls: 'text-[#00D4A0]' },
          { label: 'Rejected', value: (requests ?? []).filter(r => r.status === 'rejected').length, cls: 'text-[#FF4D4D]' },
          { label: 'Total Requests', value: (requests ?? []).length, cls: 'text-[#1A1A1A] dark:text-white' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="px-5 py-4 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <p className={`text-2xl font-bold ${cls}`}>{value}</p>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Balance Cards */}
      <section>
        <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-4">Leave Balances — {new Date().getFullYear()}</h2>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            {[0, 1, 2, 3, 4, 5].map(i => <SkeletonBlock key={i} className="h-28" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {LEAVE_TYPES.map(t => (
              <BalanceCard key={t.value} type={t.value} balance={balanceMap[t.value] ?? null} />
            ))}
          </div>
        )}
      </section>

      {/* Request History */}
      <section>
        <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-4">Request History</h2>
        {loading ? (
          <SkeletonBlock className="h-40 animate-pulse" />
        ) : !requests?.length ? (
          <div className="flex flex-col items-center py-14 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <div className="w-14 h-14 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center mb-3">
              <CalendarDays size={22} className="text-[#00D4A0]" />
            </div>
            <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">No leave requests yet</p>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1 mb-5">Your requests will appear here once submitted</p>
            {canWrite && (
              <button
                onClick={onRequestLeave}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
              >
                <Plus size={14} /> Request Leave
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                  {['Type', 'From', 'To', 'Days', 'Status', ''].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                {requests.map(req => (
                  <tr key={req.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                    <td className="px-5 py-3.5"><LeaveBadge type={req.leave_type} /></td>
                    <td className="px-5 py-3.5 text-[#1A1A1A] dark:text-white whitespace-nowrap">{fmtDate(req.start_date)}</td>
                    <td className="px-5 py-3.5 text-[#1A1A1A] dark:text-white whitespace-nowrap">{fmtDate(req.end_date)}</td>
                    <td className="px-5 py-3.5 font-bold text-[#1A1A1A] dark:text-white">{req.days_requested}d</td>
                    <td className="px-5 py-3.5"><LeaveStageTimeline req={req} /></td>
                    <td className="px-5 py-3.5">
                      {canWrite && req.status === 'pending' && (
                        <button
                          onClick={() => onCancel(req)}
                          disabled={cancelLoadingId === req.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#FF4D4D] hover:border-[#FF4D4D]/40 disabled:opacity-50 transition-colors"
                        >
                          {cancelLoadingId === req.id ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />}
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Team Requests Tab ────────────────────────────────────────────────────────

function TeamRequestsTab({ requests, loading, onApprove, onReject, approveLoadingId, rejectLoadingId, isHR }) {
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[0, 1, 2].map(i => <SkeletonBlock key={i} className="h-24" />)}
      </div>
    )
  }

  if (!requests?.length) {
    return (
      <div className="flex flex-col items-center py-16 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="w-14 h-14 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center mb-3">
          <CheckCircle2 size={22} className="text-[#00D4A0]" />
        </div>
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">All caught up!</p>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1">No pending leave requests to review</p>
      </div>
    )
  }

  const busy = id => approveLoadingId === id || rejectLoadingId === id

  return (
    <div className="space-y-3">
      {requests.map(req => {
        const isManagerApproved = req.status === 'manager_approved'
        return (
          <div
            key={req.id}
            className="flex items-center gap-4 p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/20 transition-colors"
          >
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-[#00D4A0]/10 flex items-center justify-center text-[#00D4A0] text-sm font-bold shrink-0 select-none">
              {initials(req.employees?.full_name)}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">
                  {req.employees?.full_name ?? 'Unknown Employee'}
                </span>
                <LeaveBadge type={req.leave_type} />
                {isManagerApproved && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#4D9FFF]/10 text-[#4D9FFF]">
                    <Check size={10} /> Manager approved ✓ by {req.manager?.full_name ?? 'manager'}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                {fmtDate(req.start_date)} → {fmtDate(req.end_date)}
                <span className="ml-2 font-semibold text-[#1A1A1A] dark:text-white">{req.days_requested}d</span>
              </p>
              {req.reason && (
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 truncate">
                  "{req.reason}"
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {!isHR && isManagerApproved ? (
                <span className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#4D9FFF]">
                  <Clock size={12} /> Awaiting HR final approval
                </span>
              ) : (
                <>
                  <button
                    onClick={() => onApprove(req)}
                    disabled={busy(req.id)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-50 transition-colors"
                  >
                    {approveLoadingId === req.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Check size={12} />}
                    {isHR ? 'Final Approve' : 'Approve (Step 1)'}
                  </button>
                  <button
                    onClick={() => onReject(req)}
                    disabled={busy(req.id)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] disabled:opacity-50 transition-colors"
                  >
                    {rejectLoadingId === req.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <X size={12} />}
                    Reject
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Leave Calendar ───────────────────────────────────────────────────────────

function LeaveCalendar({ leaves, viewDate, onPrev, onNext, loading, isHR }) {
  const year       = viewDate.getFullYear()
  const month      = viewDate.getMonth()
  const firstDay   = new Date(year, month, 1)
  const lastDayNum = new Date(year, month + 1, 0).getDate()
  const todayStr   = localDateStr(new Date())
  const startOff   = (firstDay.getDay() + 6) % 7
  const monthLabel = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const cells = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - startOff + 1
    if (dayNum < 1 || dayNum > lastDayNum) return null
    const d       = new Date(year, month, dayNum)
    const dateStr = localDateStr(d)
    const isToday   = dateStr === todayStr
    const isWeekend = d.getDay() === 0 || d.getDay() === 6
    const dayLeaves = leaves.filter(lr => lr.start_date <= dateStr && lr.end_date >= dateStr)
    return { dayNum, dateStr, isToday, isWeekend, dayLeaves }
  })

  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-6">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">{monthLabel}</h2>
        <div className="flex items-center gap-0.5 bg-[#F5F5F0] dark:bg-[#252525] rounded-lg px-1 border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <button
            onClick={onPrev}
            className="w-8 h-9 flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={onNext}
            className="w-8 h-9 flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS_SHORT.map(d => (
          <div key={d} className="text-center py-2 text-xs font-semibold text-[#666666] dark:text-[#A0A0A0]">{d}</div>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-7 gap-1 animate-pulse">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="min-h-14 rounded-xl bg-[#FAFAFA] dark:bg-[#1A1A1A]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            if (!cell) return <div key={`e-${i}`} />
            const { dayNum, dateStr, isToday, isWeekend, dayLeaves } = cell
            const hasLeaves = dayLeaves.length > 0
            const shown = dayLeaves.slice(0, 2)
            const extra = dayLeaves.length - shown.length

            return (
              <div
                key={dateStr}
                className={[
                  'min-h-[72px] p-1.5 rounded-xl flex flex-col transition-colors',
                  isToday
                    ? 'ring-2 ring-[#00D4A0] ring-offset-1 ring-offset-white dark:ring-offset-[#1E1E1E]'
                    : '',
                  hasLeaves
                    ? 'bg-[#F5F5F0] dark:bg-[#252525]'
                    : isWeekend
                    ? 'bg-[#FAFAFA] dark:bg-[#1A1A1A] opacity-50'
                    : 'bg-[#FAFAFA] dark:bg-[#1A1A1A]',
                ].filter(Boolean).join(' ')}
              >
                <span className={`text-xs font-semibold mb-1 ${
                  isToday ? 'text-[#00D4A0]' : 'text-[#666666] dark:text-[#A0A0A0]'
                }`}>
                  {dayNum}
                </span>
                <div className="flex flex-col gap-0.5">
                  {shown.map(lr => {
                    const meta = LT[lr.leave_type]
                    const label = isHR
                      ? (lr.employees?.full_name?.split(' ')[0] ?? meta?.label ?? lr.leave_type)
                      : (meta?.label ?? lr.leave_type)
                    return (
                      <div
                        key={lr.id}
                        title={isHR
                          ? `${lr.employees?.full_name} — ${meta?.label}`
                          : meta?.label}
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded truncate ${meta?.cls ?? 'bg-[#A0A0A0]/10 text-[#A0A0A0]'}`}
                      >
                        {label}
                      </div>
                    )
                  })}
                  {extra > 0 && (
                    <span className="text-[9px] text-[#666666] dark:text-[#A0A0A0] px-1">
                      +{extra} more
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-5 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
        {LEAVE_TYPES.map(t => (
          <div key={t.value} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${t.dot}`} />
            <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Leave() {
  const employee  = useAuthStore(s => s.employee)
  const role      = useAuthStore(s => s.role)
  const companyId = useAuthStore(s => s.companyId)

  const canManage = TEAM_ROLES.has(role)
  const isHR      = role === 'super_admin' || role === 'hr_manager'

  const [activeTab,       setActiveTab]       = useState('my-leave')
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [rejectTarget,    setRejectTarget]    = useState(null)

  const [balances,     setBalances]     = useState([])
  const [myRequests,   setMyRequests]   = useState([])
  const [teamRequests, setTeamRequests] = useState([])
  const [calLeaves,    setCalLeaves]    = useState([])

  const now          = new Date()
  const currentYear  = now.getFullYear()
  const [calView,    setCalView]    = useState(new Date(currentYear, now.getMonth(), 1))

  const [loadingBal,  setLoadingBal]  = useState(true)
  const [loadingMy,   setLoadingMy]   = useState(true)
  const [loadingTeam, setLoadingTeam] = useState(false)
  const [loadingCal,  setLoadingCal]  = useState(true)

  const [requestSaving,    setRequestSaving]    = useState(false)
  const [approveLoadingId, setApproveLoadingId] = useState(null)
  const [rejectLoadingId,  setRejectLoadingId]  = useState(null)
  const [cancelLoadingId,  setCancelLoadingId]  = useState(null)

  const { toast, showToast } = useToast()

  // ── Fetchers ────────────────────────────────────────────────────────────────

  const fetchBalances = useCallback(async () => {
    if (!employee?.id) return
    setLoadingBal(true)
    const { data } = await supabase
      .from('leave_balances')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('year', currentYear)
    setBalances(data ?? [])
    setLoadingBal(false)
  }, [employee?.id, currentYear])

  const fetchMyRequests = useCallback(async () => {
    if (!employee?.id) return
    setLoadingMy(true)
    const { data } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
    setMyRequests(data ?? [])
    setLoadingMy(false)
  }, [employee?.id])

  const fetchTeamRequests = useCallback(async () => {
    if (!canManage) return
    setLoadingTeam(true)
    // HR's queue shows both step-1-pending and step-1-approved requests
    // (they can finalize either); a department_manager's queue shows the
    // same two statuses for visibility, but can only act on 'pending' —
    // 'manager_approved' rows are read-only "awaiting HR" for them.
    const { data } = await supabase
      .from('leave_requests')
      .select('*, employees!leave_requests_employee_id_fkey(full_name, department_id), manager:employees!leave_requests_manager_reviewed_by_fkey(full_name)')
      .in('status', ['pending', 'manager_approved'])
      .order('created_at', { ascending: true })

    // leave_select RLS grants department_manager company-wide read (no
    // department filter at the DB layer, confirmed live) — same pattern as
    // ManagerDashboard.jsx's belt-and-suspenders client filter, except here
    // it's the only scoping that exists at all for this role.
    const rows = role === 'department_manager'
      ? (data ?? []).filter(r => r.employees?.department_id === employee?.department_id)
      : (data ?? [])

    setTeamRequests(rows)
    setLoadingTeam(false)
  }, [canManage, role, employee?.department_id])

  const fetchCalLeaves = useCallback(async (vd, empId, showAll) => {
    setLoadingCal(true)
    const yr      = vd.getFullYear()
    const mo      = vd.getMonth()
    const first   = localDateStr(new Date(yr, mo, 1))
    const last    = localDateStr(new Date(yr, mo + 1, 0))

    let q = supabase
      .from('leave_requests')
      .select(showAll ? '*, employees(full_name)' : '*')
      .eq('status', 'approved')
      .lte('start_date', last)
      .gte('end_date', first)

    if (!showAll) q = q.eq('employee_id', empId)

    const { data } = await q
    setCalLeaves(data ?? [])
    setLoadingCal(false)
  }, [])

  useEffect(() => { fetchBalances() },               [fetchBalances])
  useEffect(() => { fetchMyRequests() },             [fetchMyRequests])
  useEffect(() => { if (canManage) fetchTeamRequests() }, [canManage, fetchTeamRequests])
  useEffect(() => {
    if (employee?.id) fetchCalLeaves(calView, employee.id, isHR)
  }, [calView, employee?.id, isHR, fetchCalLeaves])

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function submitRequest(form, days) {
    if (role === 'read_only') return
    setRequestSaving(true)

    const { error: reqErr } = await supabase.from('leave_requests').insert({
      company_id:     companyId,
      employee_id:    employee.id,
      leave_type:     form.leave_type,
      start_date:     form.start_date,
      end_date:       form.end_date,
      days_requested: days,
      reason:         form.reason.trim(),
      status:         'pending',
    })

    if (reqErr) {
      console.error('[Leave] submitRequest failed', reqErr)
      showToast('error', 'Something went wrong submitting your request. Please try again.')
      setRequestSaving(false)
      return
    }

    // Deduct days from balance so balance reflects pending requests
    const reqYear = new Date(form.start_date + 'T00:00:00').getFullYear()
    const { data: balRow } = await supabase
      .from('leave_balances')
      .select('id, used_days')
      .eq('employee_id', employee.id)
      .eq('leave_type', form.leave_type)
      .eq('year', reqYear)
      .maybeSingle()

    if (balRow) {
      await supabase
        .from('leave_balances')
        .update({ used_days: balRow.used_days + days })
        .eq('id', balRow.id)
    }

    await Promise.all([fetchMyRequests(), fetchBalances()])
    setShowRequestModal(false)
    setRequestSaving(false)
    showToast('success', 'Leave request submitted successfully')
  }

  // Only ever sends `status` (plus `rejection_reason` for rejects below) —
  // the aa_leave_transition trigger populates manager_reviewed_by/at or
  // reviewed_by/at itself based on the caller's own role, so the frontend
  // doesn't need to guess which pair applies. Any invalid transition (wrong
  // role, wrong department, wrong starting status) THROWS from the trigger —
  // surfaced verbatim via error.message, per the task's explicit instruction.
  async function approveRequest(req) {
    setApproveLoadingId(req.id)

    // department_manager approving a 'pending' request is step 1 only;
    // everything else (HR/super_admin on 'pending' or 'manager_approved',
    // or a manager finalizing something that's already past step 1 — not
    // reachable through this UI, but harmless if it were) is final approval.
    const nextStatus = (!isHR && req.status === 'pending') ? 'manager_approved' : 'approved'

    const { error } = await supabase
      .from('leave_requests')
      .update({ status: nextStatus })
      .eq('id', req.id)

    if (error) {
      console.error('[Leave] approveRequest failed', error)
      showToast('error', error.message)
    } else {
      await Promise.all([
        fetchTeamRequests(),
        fetchCalLeaves(calView, employee?.id, isHR),
      ])
      showToast('success', nextStatus === 'manager_approved'
        ? `${req.employees?.full_name ?? 'Request'} approved — sent to HR for final approval`
        : `${req.employees?.full_name ?? 'Request'} approved`)
    }
    setApproveLoadingId(null)
  }

  async function rejectRequest(req, reason) {
    setRejectLoadingId(req.id)

    const { error } = await supabase
      .from('leave_requests')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', req.id)

    if (!error) {
      // Revert the balance deduction made when the request was submitted
      const reqYear = new Date(req.start_date + 'T00:00:00').getFullYear()
      const { data: balRow } = await supabase
        .from('leave_balances')
        .select('id, used_days')
        .eq('employee_id', req.employee_id)
        .eq('leave_type', req.leave_type)
        .eq('year', reqYear)
        .maybeSingle()

      if (balRow) {
        await supabase
          .from('leave_balances')
          .update({ used_days: Math.max(0, balRow.used_days - req.days_requested) })
          .eq('id', balRow.id)
      }

      await fetchTeamRequests()
      setRejectTarget(null)
      showToast('success', `${req.employees?.full_name ?? 'Request'} rejected`)
    } else {
      console.error('[Leave] rejectRequest failed', error)
      showToast('error', error.message)
    }
    setRejectLoadingId(null)
  }

  // Employee cancelling their own pending request. `leave_self_update` RLS
  // (migration 44) grants UPDATE to the requester's own row while
  // status='pending', alongside the pre-existing super_admin/hr_manager/
  // department_manager grant. Migration 46 (make_read_only_role_truly_read_only)
  // re-excluded `read_only` specifically from this grant — confirmed live —
  // so the Cancel button is hidden for that role above (`canWrite`); this
  // guard is defense-in-depth. The `.select().maybeSingle()` null-check
  // below is kept as a fallback for every other role (e.g. the row stopped
  // being 'pending' between page load and click), not because RLS is
  // expected to reject a normal employee's own cancel.
  async function cancelRequest(req) {
    if (role === 'read_only') return
    setCancelLoadingId(req.id)

    const { data, error } = await supabase
      .from('leave_requests')
      .update({ status: 'cancelled' })
      .eq('id', req.id)
      .select()
      .maybeSingle()

    if (error) {
      console.error('[Leave] cancelRequest failed', error)
      showToast('error', error.message)
    } else if (!data) {
      console.error('[Leave] cancelRequest matched no rows — RLS likely blocked it for role', role)
      showToast('error', 'Could not cancel this request. Please contact HR.')
    } else {
      const reqYear = new Date(req.start_date + 'T00:00:00').getFullYear()
      const { data: balRow } = await supabase
        .from('leave_balances')
        .select('id, used_days')
        .eq('employee_id', req.employee_id)
        .eq('leave_type', req.leave_type)
        .eq('year', reqYear)
        .maybeSingle()

      if (balRow) {
        await supabase
          .from('leave_balances')
          .update({ used_days: Math.max(0, balRow.used_days - req.days_requested) })
          .eq('id', balRow.id)
      }

      await Promise.all([fetchMyRequests(), fetchBalances()])
      showToast('success', 'Leave request cancelled')
    }
    setCancelLoadingId(null)
  }

  // ── Tabs config ─────────────────────────────────────────────────────────────

  // For HR, every row in the queue (pending or manager_approved) is
  // actionable directly. For a department_manager, only 'pending' rows are —
  // 'manager_approved' ones are already done on their end, just awaiting HR.
  const actionableTeamCount = isHR
    ? teamRequests.length
    : teamRequests.filter(r => r.status === 'pending').length

  const tabs = [
    { id: 'my-leave',      label: 'My Leave',      icon: FileText, badge: null },
    ...(canManage ? [{ id: 'team-requests', label: 'Team Requests', icon: Users, badge: actionableTeamCount || null }] : []),
    { id: 'calendar',      label: 'Calendar',       icon: CalendarDays, badge: null },
  ]

  // ── No employee record linked ───────────────────────────────────────────────

  if (!employee) {
    return (
      <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
        <Sidebar />
        <div className="flex-1 flex flex-col lg:ml-60">
          <Header />
          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20 max-w-lg">
              <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[#FF8C42]">Account not linked</p>
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                  Your login is not linked to an employee record. Contact HR to complete setup.
                </p>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {/* Page header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Leave Management</h1>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                Track balances, request leave, and manage team approvals
              </p>
            </div>
            {role !== 'read_only' && (
              <button
                onClick={() => setShowRequestModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors shadow-sm"
              >
                <Plus size={15} />
                Request Leave
              </button>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 p-1 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] w-fit mb-8">
            {tabs.map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === id
                    ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                    : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
                }`}
              >
                <Icon size={15} />
                {label}
                {badge ? (
                  <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF8C42] text-white text-[10px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'my-leave' && (
            <MyLeaveTab
              balances={balances}
              requests={myRequests}
              loading={loadingBal || loadingMy}
              onRequestLeave={() => setShowRequestModal(true)}
              onCancel={cancelRequest}
              cancelLoadingId={cancelLoadingId}
              canWrite={role !== 'read_only'}
            />
          )}

          {activeTab === 'team-requests' && canManage && (
            <TeamRequestsTab
              requests={teamRequests}
              loading={loadingTeam}
              onApprove={approveRequest}
              onReject={setRejectTarget}
              approveLoadingId={approveLoadingId}
              rejectLoadingId={rejectLoadingId}
              isHR={isHR}
            />
          )}

          {activeTab === 'calendar' && (
            <LeaveCalendar
              leaves={calLeaves}
              viewDate={calView}
              onPrev={() => setCalView(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              onNext={() => setCalView(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              loading={loadingCal}
              isHR={isHR}
            />
          )}
        </main>
      </div>

      <ToastComp toast={toast} />

      {showRequestModal && (
        <RequestModal
          onClose={() => setShowRequestModal(false)}
          onSubmit={submitRequest}
          saving={requestSaving}
        />
      )}

      {rejectTarget && (
        <RejectModal
          request={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={rejectRequest}
          saving={rejectLoadingId === rejectTarget?.id}
        />
      )}
    </div>
  )
}
