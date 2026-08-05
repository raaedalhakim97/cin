import { useCallback, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../../src/lib/supabase'
import useAuthStore from '../../src/store/authStore'
import Screen from '../../src/components/Screen'
import { Avatar, Badge, Button, Card, EmptyState, Overline, Row, SectionTitle, SkeletonCard, useTheme } from '../../src/components/ui'
import { money, periodLabel, shortDate } from '../../src/lib/format'
import { space, type } from '../../src/theme'

const PAYROLL_STATUS = {
  draft: { label: 'Draft', tone: 'muted' },
  approved: { label: 'Approved', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
}

export default function Profile() {
  const { c } = useTheme()
  const employee = useAuthStore((s) => s.employee)
  const company = useAuthStore((s) => s.company)
  const can = useAuthStore((s) => s.caps)
  const signOut = useAuthStore((s) => s.signOut)

  const [runs, setRuns] = useState([])
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [openRun, setOpenRun] = useState(null)

  // Currency comes from the tenant, not a hardcoded 'AED' — an NGN company sees
  // NGN here.
  const currency = company?.currency || 'AED'

  const load = useCallback(async () => {
    if (!employee?.id) {
      setLoading(false)
      return
    }
    const [payroll, documents] = await Promise.all([
      supabase
        .from('payroll_runs')
        .select(
          'id, period_year, period_month, status, basic_salary, housing_allowance, transport_allowance, other_allowance, overtime_pay, performance_bonus, deductions'
        )
        .eq('employee_id', employee.id)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(12),
      supabase
        .from('hr_documents_with_status')
        .select('id, file_name, expiry_date, expiry_status, document_type_id')
        .eq('employee_id', employee.id)
        .limit(20),
    ])
    setRuns(payroll.data ?? [])
    setDocs(documents.data ?? [])
    setLoading(false)
  }, [employee?.id])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  function grossOf(r) {
    return (
      Number(r.basic_salary || 0) +
      Number(r.housing_allowance || 0) +
      Number(r.transport_allowance || 0) +
      Number(r.other_allowance || 0) +
      Number(r.overtime_pay || 0) +
      Number(r.performance_bonus || 0)
    )
  }

  return (
    <Screen title="My profile" onRefresh={load}>
      <Card style={{ alignItems: 'center', paddingVertical: space(3) }}>
        <Avatar name={employee?.full_name} size={72} />
        <Text style={{ ...type.h1, color: c.text, marginTop: space(1.5) }}>{employee?.full_name ?? '—'}</Text>
        <Text style={{ ...type.body, color: c.textMuted }}>{employee?.job_title ?? '—'}</Text>
        <View style={{ marginTop: space(1) }}>
          <Badge label={employee?.emp_code ?? can.label} />
        </View>
      </Card>

      <SectionTitle>Employment</SectionTitle>
      <Card>
        <Row label="Department" value={employee?.departments?.name} />
        <Row label="Employee ID" value={employee?.emp_code} />
        <Row label="Email" value={employee?.email} />
        <Row label="Phone" value={employee?.phone} />
        <Row label="Contract" value={employee?.contract_type} />
        <Row label="Joined" value={employee?.hire_date ? shortDate(employee.hire_date) : '—'} />
        <Row label="Company" value={company?.name} />
      </Card>

      <Card style={{ marginTop: space(2) }}>
        <Overline>Your access</Overline>
        <Text style={{ ...type.label, color: c.text }}>{can.label}</Text>
        <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2 }}>{can.purpose}</Text>
      </Card>

      {/* "Payroll — view" is '-' for admin: an ops coordinator has no payroll
          access at all, so the section is absent rather than empty. */}
      {!can.viewOwnPayslip ? null : (
        <>
      <SectionTitle>Payslips</SectionTitle>
      {loading ? (
        <SkeletonCard lines={3} />
      ) : runs.length === 0 ? (
        <EmptyState icon="—" title="No payslips yet" body="Payslips appear here once HR publishes your first payroll run." />
      ) : (
        <View style={{ gap: space(1) }}>
          {runs.map((r) => {
            const meta = PAYROLL_STATUS[r.status] ?? { label: r.status, tone: 'muted' }
            const gross = grossOf(r)
            const net = gross - Number(r.deductions || 0)
            const expanded = openRun === r.id
            return (
              <Pressable key={r.id} onPress={() => setOpenRun(expanded ? null : r.id)}>
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.label, color: c.text }}>{periodLabel(r.period_year, r.period_month)}</Text>
                      <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2 }}>
                        Net {money(net, currency)}
                      </Text>
                    </View>
                    <Badge
                      label={meta.label}
                      color={{ muted: c.textMuted, info: c.info, success: c.success }[meta.tone]}
                    />
                    <Ionicons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={c.textFaint}
                      style={{ marginLeft: space(1) }}
                    />
                  </View>

                  {expanded ? (
                    <View style={{ borderTopWidth: 1, borderTopColor: c.border, marginTop: space(1.5), paddingTop: space(1) }}>
                      <Row label="Basic salary" value={money(r.basic_salary, currency)} />
                      <Row label="Housing" value={money(r.housing_allowance, currency)} />
                      <Row label="Transport" value={money(r.transport_allowance, currency)} />
                      <Row label="Other" value={money(r.other_allowance, currency)} />
                      <Row label="Overtime" value={money(r.overtime_pay, currency)} />
                      <Row label="Bonus" value={money(r.performance_bonus, currency)} />
                      <Row label="Gross" value={money(gross, currency)} valueColor={c.mint} />
                      <Row label="Deductions" value={`- ${money(r.deductions, currency)}`} valueColor={c.danger} />
                      <Row label="Net salary" value={money(net, currency)} valueColor={c.mint} />
                      <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(1) }}>
                        Confidential — Art. 12.4. Do not share your payslip with colleagues.
                      </Text>
                    </View>
                  ) : null}
                </Card>
              </Pressable>
            )
          })}
        </View>
      )}

        </>
      )}

      <SectionTitle>My documents</SectionTitle>
      {loading ? (
        <SkeletonCard lines={2} />
      ) : docs.length === 0 ? (
        <EmptyState icon="—" title="No documents" body="Documents HR uploads for you will be listed here." />
      ) : (
        <Card style={{ padding: 0 }}>
          {docs.map((d, i) => (
            <View
              key={d.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(1.5),
                padding: space(1.5),
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c.border,
              }}
            >
              <Ionicons name="document-text-outline" size={20} color={c.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.body, color: c.text }} numberOfLines={1}>
                  {d.file_name ?? 'Document'}
                </Text>
                {d.expiry_date ? (
                  <Text style={{ ...type.caption, color: c.textMuted }}>Expires {shortDate(d.expiry_date)}</Text>
                ) : null}
              </View>
              {d.expiry_status === 'expiring_critical' || d.expiry_status === 'expired' ? (
                <Badge label="Action needed" color={c.danger} />
              ) : d.expiry_status === 'expiring_soon' ? (
                <Badge label="Expiring" color={c.warning} />
              ) : null}
            </View>
          ))}
        </Card>
      )}

      <Button label="Sign out" variant="secondary" onPress={signOut} style={{ marginTop: space(3) }} />
      <Text style={{ ...type.caption, color: c.textFaint, textAlign: 'center', marginTop: space(2) }}>
        BYOND by SERVA — HR Platform
      </Text>
    </Screen>
  )
}
