import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, Loader2, UserCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'

// Who manages whom, on one screen.
//
// A person's manager rates them in the quarterly review and is the one told about their
// team. Until this page, making someone a manager was only possible on their invite, and
// naming someone's manager was buried inside KPI → Scorecards — so measured on
// production, 9 of 11 people in a review cycle had nobody to rate them.
//
// Two things happen here:
//   · the owner (super_admin) makes someone a manager, or stops them being one —
//     set_employee_role(), which refuses anything the owner should not be able to do;
//   · the owner or HR sets each person's manager (employees.reports_to), one at a time or
//     for several people at once.
//
// "Has a manager" is worked out the way the database works it out (manager_covers): the
// named manager if there is one, otherwise a manager in the same department or the
// department's own manager. The same rule decides who can rate them, so this screen and
// the review warnings never disagree.

const INPUT =
  'px-3 py-2 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const ROLE_LABEL = {
  super_admin: 'Owner', hr_manager: 'HR manager', department_manager: 'Manager',
  admin: 'Admin', employee: 'Employee', read_only: 'Read only',
}

export default function TeamStructure() {
  const role = useAuthStore((s) => s.role)
  const me = useAuthStore((s) => s.employee)
  const isOwner = role === 'super_admin'
  const { toast, showToast } = useToast()

  const [people, setPeople] = useState([])
  const [roles, setRoles] = useState({})
  const [depts, setDepts] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [bulkManager, setBulkManager] = useState('')
  const [promoteId, setPromoteId] = useState('')
  const [confirmDemote, setConfirmDemote] = useState(null)

  const load = useCallback(async () => {
    const [{ data: emps, error }, { data: roleRows }, { data: deptRows }] = await Promise.all([
      supabase.from('employees')
        .select('id, full_name, job_title, user_id, status, department_id, reports_to, departments!employees_department_id_fkey(name)')
        .neq('status', 'terminated').order('full_name'),
      supabase.from('user_roles').select('user_id, role'),
      supabase.from('departments').select('id, name, manager_id'),
    ])
    if (error) console.error('[TeamStructure] load failed', error)
    setPeople(emps ?? [])
    setRoles(Object.fromEntries((roleRows ?? []).map((r) => [r.user_id, r.role])))
    setDepts(deptRows ?? [])
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after awaiting
  useEffect(() => { load() }, [load])

  const roleOf = useCallback((p) => (p.user_id ? roles[p.user_id] ?? null : null), [roles])
  const managers = useMemo(() => people.filter((p) => roleOf(p) === 'department_manager'), [people, roleOf])
  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people])
  const deptById = useMemo(() => Object.fromEntries(depts.map((d) => [d.id, d])), [depts])

  // Mirrors manager_covers(): the named manager, else the department's.
  const coverFor = useCallback((p) => {
    if (p.reports_to) {
      const m = byId[p.reports_to]
      return m && roleOf(m) === 'department_manager'
        ? { names: [m.full_name], via: 'named' }
        : { names: [], via: 'named-not-manager', who: m?.full_name }
    }
    if (!p.department_id) return { names: [], via: 'none' }
    const dept = deptById[p.department_id]
    const names = managers
      .filter((m) => m.id !== p.id && (m.department_id === p.department_id || dept?.manager_id === m.id))
      .map((m) => m.full_name)
    return { names, via: names.length ? 'department' : 'none' }
  }, [byId, deptById, managers, roleOf])

  const rows = useMemo(() => people.map((p) => ({ ...p, cover: coverFor(p) })), [people, coverFor])
  const missing = rows.filter((r) => r.cover.names.length === 0 && roleOf(r) !== 'super_admin')
  const shown = onlyMissing ? missing : rows
  const reportsCount = useMemo(() => {
    const c = {}
    rows.forEach((r) => { if (r.reports_to) c[r.reports_to] = (c[r.reports_to] ?? 0) + 1 })
    return c
  }, [rows])
  const promotable = people.filter((p) => p.user_id && roleOf(p) === 'employee' && p.status === 'active')

  async function setManager(ids, managerId) {
    setBusy('assign')
    const { error } = await supabase.from('employees').update({ reports_to: managerId || null }).in('id', ids)
    setBusy(null)
    if (error) {
      console.error('[TeamStructure] reports_to failed', error)
      showToast('error', error.message || 'Could not save. Please try again.')
      return
    }
    const mName = managerId ? byId[managerId]?.full_name : null
    showToast('success', ids.length === 1
      ? (mName ? `${byId[ids[0]]?.full_name} now reports to ${mName}` : `${byId[ids[0]]?.full_name} goes back to their department manager`)
      : `${ids.length} people ${mName ? `now report to ${mName}` : 'go back to their department manager'}`)
    setSelected(new Set())
    setBulkManager('')
    load()
  }

  async function changeRole(employeeId, newRole) {
    setBusy(`role-${employeeId}`)
    const { error } = await supabase.rpc('set_employee_role', { p_employee_id: employeeId, p_role: newRole })
    setBusy(null)
    setConfirmDemote(null)
    if (error) {
      console.error('[TeamStructure] role change failed', error)
      showToast('error', error.message || 'Could not change the role.')
      return
    }
    showToast('success', newRole === 'department_manager'
      ? `${byId[employeeId]?.full_name} is now a manager. Choose who reports to them below.`
      : `${byId[employeeId]?.full_name} is no longer a manager`)
    setPromoteId('')
    load()
  }

  function toggle(id) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-5xl w-full">
          <Link to="/employees" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white mb-3">
            <ArrowLeft size={15} /> Employees
          </Link>
          <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Managers & teams</h1>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1 max-w-2xl">
            Who manages whom. A person&apos;s manager rates them in the quarterly review and is told about their team.
          </p>

          {loading ? (
            <div className="mt-6 space-y-2">{[0, 1, 2, 3].map((i) => <SkeletonRow key={i} />)}</div>
          ) : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6" data-tour="team-summary">
                <div className="p-4 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                  <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">Managers</p>
                  <p className="text-2xl font-bold text-[#1A1A1A] dark:text-white">{managers.length}</p>
                </div>
                <div className="p-4 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                  <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">Have a manager</p>
                  <p className="text-2xl font-bold text-[#1A1A1A] dark:text-white">{rows.length - missing.length}<span className="text-sm font-normal text-[#666666] dark:text-[#A0A0A0]"> / {rows.length}</span></p>
                </div>
                <button type="button" onClick={() => setOnlyMissing((v) => !v)} aria-pressed={onlyMissing}
                  className={`p-4 rounded-xl text-left border transition-colors ${missing.length
                    ? 'bg-[#FF8C42]/10 border-[#FF8C42]/30 hover:border-[#FF8C42]/60'
                    : 'bg-[#00D4A0]/10 border-[#00D4A0]/30'}`}>
                  <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{missing.length ? (onlyMissing ? 'Showing only these — tap to show all' : 'Without a manager — tap to show only them') : 'Without a manager'}</p>
                  <p className={`text-2xl font-bold ${missing.length ? 'text-[#C2410C] dark:text-[#FF8C42]' : 'text-accent'}`}>{missing.length}</p>
                </button>
              </div>

              {/* Managers */}
              <section className="mt-6 p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]" data-tour="team-managers">
                <div className="flex items-center gap-2 mb-1">
                  <UserCheck size={17} className="text-accent" />
                  <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Managers</h2>
                </div>
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-4">
                  {isOwner
                    ? 'Make someone a manager, then choose who reports to them below.'
                    : 'Only the account owner can make someone a manager. You can choose who reports to whom below.'}
                </p>

                {managers.length === 0 && (
                  <p className="text-sm text-[#1A1A1A] dark:text-white mb-3">Nobody is a manager yet.</p>
                )}
                <ul className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                  {managers.map((m) => (
                    <li key={m.id} className="py-3 flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1 basis-full sm:basis-48">
                        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{m.full_name}</p>
                        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate">
                          {[m.job_title, m.departments?.name].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#00D4A0]/10 text-accent">
                        {reportsCount[m.id] ?? 0} named {(reportsCount[m.id] ?? 0) === 1 ? 'report' : 'reports'}
                      </span>
                      {isOwner && (confirmDemote === m.id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-[#C2410C] dark:text-[#FF8C42]">
                            {reportsCount[m.id] ? `${reportsCount[m.id]} will lose their named manager. ` : ''}Sure?
                          </span>
                          <button type="button" onClick={() => setConfirmDemote(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white">Keep</button>
                          <button type="button" onClick={() => changeRole(m.id, 'employee')} disabled={busy === `role-${m.id}`}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-danger border border-danger/40 hover:bg-danger/10 disabled:opacity-60">
                            {busy === `role-${m.id}` ? <Loader2 size={12} className="animate-spin" /> : 'Remove'}
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmDemote(m.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-danger hover:border-danger/40">
                          <UserMinus size={13} /> Remove manager role
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>

                {isOwner && (
                  <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
                    <select value={promoteId} onChange={(e) => setPromoteId(e.target.value)} aria-label="Person to make a manager"
                      className={`${INPUT} flex-1 min-w-[200px]`} disabled={promotable.length === 0}>
                      <option value="">{promotable.length ? 'Choose someone to make a manager…' : 'Everyone who has joined already has a role above employee'}</option>
                      {promotable.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name}{p.departments?.name ? ` — ${p.departments.name}` : ''}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => changeRole(promoteId, 'department_manager')}
                      disabled={!promoteId || busy === `role-${promoteId}`}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-50">
                      {busy === `role-${promoteId}` ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                      Make manager
                    </button>
                    <p className="w-full text-xs text-[#666666] dark:text-[#A0A0A0]">
                      Only people who have joined can be made a manager. For someone not invited yet, choose Manager on their invite.
                    </p>
                  </div>
                )}
              </section>

              {/* Everyone */}
              <section className="mt-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden" data-tour="team-people">
                <div className="flex flex-wrap items-center gap-2 p-5 pb-3">
                  <Users size={17} className="text-[#4D9FFF]" />
                  <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white flex-1">
                    {onlyMissing ? 'People without a manager' : 'Everyone'}
                  </h2>
                  {managers.length === 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-[#C2410C] dark:text-[#FF8C42]">
                      <AlertTriangle size={13} /> Make someone a manager first
                    </span>
                  )}
                </div>

                {selected.size > 0 && (
                  <div className="mx-5 mb-3 p-3 rounded-xl bg-[#00D4A0]/10 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{selected.size} selected — set their manager:</span>
                    <select value={bulkManager} onChange={(e) => setBulkManager(e.target.value)} className={`${INPUT} flex-1 min-w-[180px] bg-white dark:bg-[#1E1E1E]`} aria-label="Manager for the selected people">
                      <option value="">Their department manager</option>
                      {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                    <button type="button" onClick={() => setManager([...selected].filter((id) => id !== bulkManager), bulkManager)} disabled={busy === 'assign'}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60">
                      {busy === 'assign' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Apply
                    </button>
                    <button type="button" onClick={() => setSelected(new Set())} className="px-3 py-2 text-sm font-semibold text-[#666666] dark:text-[#A0A0A0]">Clear</button>
                  </div>
                )}

                {shown.length === 0 ? (
                  <p className="px-5 pb-5 text-sm text-accent font-semibold flex items-center gap-2"><Check size={15} /> Everyone has a manager.</p>
                ) : (
                  <ul className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                    {shown.map((p) => {
                      const r = roleOf(p)
                      const noMgr = p.cover.names.length === 0 && r !== 'super_admin'
                      return (
                        <li key={p.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                          <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)}
                            aria-label={`Select ${p.full_name}`} className="w-4 h-4 accent-[#00A884] shrink-0" disabled={managers.length === 0} />
                          <div className="min-w-0 flex-1 basis-40">
                            <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">
                              {p.full_name}{p.id === me?.id && <span className="font-normal text-[#666666] dark:text-[#A0A0A0]"> (you)</span>}
                            </p>
                            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate">
                              {[r ? ROLE_LABEL[r] : (p.user_id ? null : 'Not joined yet'), p.departments?.name].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <div className="basis-full sm:basis-64 sm:flex-none">
                            <select value={p.reports_to ?? ''} onChange={(e) => setManager([p.id], e.target.value)}
                              disabled={busy === 'assign' || managers.length === 0}
                              aria-label={`Manager for ${p.full_name}`}
                              className={`${INPUT} w-full ${noMgr ? 'border-[#FF8C42]/60' : ''}`}>
                              <option value="">
                                {p.cover.via === 'department' ? `Department: ${p.cover.names.join(', ')}` : 'No manager'}
                              </option>
                              {managers.filter((m) => m.id !== p.id).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                            </select>
                            {p.cover.via === 'named-not-manager' && (
                              <p className="text-[11px] text-[#C2410C] dark:text-[#FF8C42] mt-1">{p.cover.who ?? 'Their named manager'} is no longer a manager — choose someone else.</p>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </main>
      </div>
      <ToastComp toast={toast} />
    </div>
  )
}
