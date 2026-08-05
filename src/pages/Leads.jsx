import { useEffect, useState } from 'react'
import { Inbox, Mail, Phone } from 'lucide-react'
import supabase from '../services/supabase'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import { SkeletonRow } from '../components/Skeleton'

const STATUS_OPTIONS = ['new', 'contacted', 'demo_booked', 'converted', 'lost']

const STATUS_BADGE = {
  new:          'bg-[#4D9FFF]/10 text-[#4D9FFF]',
  contacted:    'bg-[#FF8C42]/10 text-[#FF8C42]',
  demo_booked:  'bg-[#A78BFA]/10 text-[#A78BFA]',
  converted:    'bg-[#00D4A0]/10 text-[#00D4A0]',
  lost:         'bg-[#FF4D4D]/10 text-[#FF4D4D]',
}

const STATUS_LABEL = {
  new:          'New',
  contacted:    'Contacted',
  demo_booked:  'Demo Booked',
  converted:    'Converted',
  lost:         'Lost',
}

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')

  async function fetchLeads() {
    setLoading(true)
    setError('')
    // demo_requests has no company_id — this table is platform-level, not
    // tenant-scoped (leads haven't signed up as a company yet). RLS already
    // restricts reads to super_admin.
    const { data, error: fetchError } = await supabase
      .from('demo_requests')
      .select('*')
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('[Leads] fetchLeads failed', fetchError)
      setError('Something went wrong loading leads. Please try again.')
      setLeads([])
    } else {
      setLeads(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  async function handleStatusChange(id, status) {
    setSavingId(id)
    const previous = leads
    setLeads((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)))

    const { error: updateError } = await supabase
      .from('demo_requests')
      .update({ status })
      .eq('id', id)

    if (updateError) {
      console.error('[Leads] handleStatusChange failed', updateError)
      setLeads(previous)
      setError('Something went wrong updating this lead. Please try again.')
    }
    setSavingId(null)
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {/* Page header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Leads</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              {leads.length} demo {leads.length === 1 ? 'request' : 'requests'} from the public site
            </p>
          </div>

          {error && (
            <div className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-sm text-[#FF4D4D] bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
              {error}
              <button onClick={fetchLeads} className="shrink-0 font-semibold hover:underline">Retry</button>
            </div>
          )}

          {/* Table card */}
          <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
            {loading ? (
              <div className="p-5 space-y-4 animate-pulse">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="space-y-2">
                    <SkeletonRow className="h-3 w-1/4" />
                    <SkeletonRow className="h-2.5 w-1/3" />
                  </div>
                ))}
              </div>
            ) : leads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-14 h-14 rounded-full bg-[#F5F5F0] dark:bg-[#252525] flex items-center justify-center">
                  <Inbox size={24} className="text-[#AAAAAA] dark:text-[#555555]" />
                </div>
                <p className="text-sm font-medium text-[#1A1A1A] dark:text-white">No demo requests yet</p>
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">Submissions from /demo will show up here</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                    <th className="text-left py-3.5 px-5 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">Company</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">Contact</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">Employees</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">Received</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-b border-[#E8E8E8] dark:border-[#2A2A2A] last:border-b-0 hover:bg-[#F9F9F7] dark:hover:bg-[#252525] transition-colors"
                    >
                      <td className="py-4 px-5">
                        <div className="text-sm font-medium text-[#1A1A1A] dark:text-white">{lead.company_name}</div>
                        {lead.message && (
                          <div className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 max-w-xs truncate" title={lead.message}>
                            {lead.message}
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm text-[#1A1A1A] dark:text-white">{lead.contact_name}</div>
                        <div className="flex items-center gap-1 text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                          <Mail size={11} />
                          <a href={`mailto:${lead.work_email}`} className="hover:text-[#00D4A0]">{lead.work_email}</a>
                        </div>
                        {lead.phone && (
                          <div className="flex items-center gap-1 text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                            <Phone size={11} />
                            {lead.phone}
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-4 text-sm text-[#1A1A1A] dark:text-white">{lead.employee_count}</td>
                      <td className="py-4 px-4 text-sm text-[#666666] dark:text-[#A0A0A0]">
                        {new Date(lead.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="py-4 px-4">
                        <select
                          value={lead.status}
                          disabled={savingId === lead.id}
                          onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                          className={`px-2.5 py-1.5 rounded-full text-xs font-semibold border-0 focus:outline-none focus:ring-2 focus:ring-[#00D4A0]/40 disabled:opacity-50 ${STATUS_BADGE[lead.status] ?? 'bg-[#E8E8E8] dark:bg-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0]'}`}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
