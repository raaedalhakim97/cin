import { useCallback, useState } from 'react'
import { View, Text, TextInput } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../../src/lib/supabase'
import useAuthStore from '../../src/store/authStore'
import Screen from '../../src/components/Screen'
import ScoreRing from '../../src/components/ScoreRing'
import { Avatar, Badge, Button, Card, EmptyState, SectionTitle, SkeletonCard, useTheme } from '../../src/components/ui'
import { periodLabel } from '../../src/lib/format'
import { ratingColor, radius, space, type } from '../../src/theme'

// The five components and their default split (Art. 14: 30/25/20/15/10). Actual
// weights come from each score row's weights_used snapshot; this is only the
// fallback for rows written before that column existed.
const DEFAULT_WEIGHTS = { attendance: 30, behavior: 25, achievement: 20, manager: 15, self: 10 }

const COMPONENTS = [
  { key: 'attendance', scoreKey: 'attendance_score', label: 'Attendance', auto: true },
  { key: 'behavior', scoreKey: 'behavior_score', label: 'Behavior' },
  { key: 'achievement', scoreKey: 'achievement_score', label: 'Achievements' },
  { key: 'manager', scoreKey: 'manager_score', label: 'Manager evaluation' },
  { key: 'self', scoreKey: 'self_score', label: 'Self evaluation' },
]

const num = (v) => Number(v) || 0

function weightsOf(row) {
  const w = row?.weights_used
  if (!w || typeof w !== 'object') return DEFAULT_WEIGHTS
  return {
    attendance: num(w.attendance),
    behavior: num(w.behavior),
    achievement: num(w.achievement),
    manager: num(w.manager),
    self: num(w.self),
  }
}

function ComponentBar({ label, weight, score, auto }) {
  const { c } = useTheme()
  const pct = Math.max(0, Math.min(100, num(score)))
  return (
    <View style={{ marginTop: space(1.5) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Text style={{ ...type.body, color: c.text }} numberOfLines={1}>
            {label}
          </Text>
          {auto ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Ionicons name="flash" size={11} color={c.mint} />
              <Text style={{ ...type.caption, color: c.mint, fontWeight: '700' }}>AUTO</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ ...type.caption, color: c.textMuted }}>
          {weight}% · <Text style={{ color: c.text, fontWeight: '700' }}>{pct.toFixed(0)}</Text>/100
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: c.surfaceAlt, borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: auto ? c.mint : c.info, borderRadius: 3 }} />
      </View>
    </View>
  )
}

export default function KPI() {
  const { c } = useTheme()
  const employee = useAuthStore((s) => s.employee)
  const companyId = useAuthStore((s) => s.companyId)
  const role = useAuthStore((s) => s.role)

  const now = new Date()
  const curY = now.getFullYear()
  const curM = now.getMonth() + 1

  const [row, setRow] = useState(null)
  const [history, setHistory] = useState([])
  const [board, setBoard] = useState([])
  const [loading, setLoading] = useState(true)
  const [selfScore, setSelfScore] = useState('50')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // read_only is excluded from kpi_self_eval RLS (migration 46) — hide the form
  // rather than let the write 400.
  const canSelfEval = role !== 'read_only'

  const load = useCallback(async () => {
    if (!employee?.id) {
      setLoading(false)
      return
    }
    const [current, hist, leaderboard] = await Promise.all([
      supabase
        .from('kpi_scores')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('period_year', curY)
        .eq('period_month', curM)
        .maybeSingle(),
      supabase
        .from('kpi_scores')
        .select('id, period_year, period_month, total_score, rating')
        .eq('employee_id', employee.id)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(6),
      supabase
        .from('kpi_scores')
        .select('id, employee_id, total_score, employees(full_name)')
        .eq('period_year', curY)
        .eq('period_month', curM)
        .order('total_score', { ascending: false })
        .limit(10),
    ])

    setRow(current.data ?? null)
    setSelfScore(String(current.data?.self_score ?? 50))
    setNotes(current.data?.notes ?? '')
    setHistory(hist.data ?? [])
    setBoard(leaderboard.data ?? [])
    setLoading(false)
  }, [employee?.id, curY, curM])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  async function submitSelfEval() {
    if (!employee?.id || !canSelfEval) return
    const value = Math.max(0, Math.min(100, Number(selfScore) || 0))
    setSaving(true)
    setMessage('')

    // The DB's aa_compute_kpi_total trigger recalculates total_score and rating
    // from the weights after this write — the app never computes the total.
    const { error } = row
      ? await supabase.from('kpi_scores').update({ self_score: value, notes }).eq('id', row.id)
      : await supabase.from('kpi_scores').insert({
          company_id: companyId,
          employee_id: employee.id,
          period_year: curY,
          period_month: curM,
          self_score: value,
          notes,
        })

    setSaving(false)
    if (error) {
      console.error('[KPI] submitSelfEval failed', error)
      setMessage("Couldn't save your self-evaluation. Please try again.")
      return
    }
    setMessage(row ? 'Self-evaluation updated' : 'Self-evaluation submitted')
    load()
  }

  const weights = weightsOf(row)
  const myRank = board.findIndex((b) => b.employee_id === employee?.id)

  return (
    <Screen title="Performance" onRefresh={load}>
      <Text style={{ ...type.caption, color: c.textMuted, marginBottom: space(2) }}>
        {periodLabel(curY, curM)} · updated automatically
      </Text>

      {loading ? (
        <View style={{ gap: space(1.5) }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={5} />
        </View>
      ) : !row ? (
        <EmptyState
          icon="—"
          title="No score this month yet"
          body="Your attendance score is calculated automatically as the month progresses. Submit your self-evaluation to get started."
        />
      ) : (
        <>
          <Card style={{ alignItems: 'center', paddingVertical: space(3) }}>
            <ScoreRing score={row.total_score} rating={row.rating} />
            <View style={{ marginTop: space(1.5) }}>
              <Badge label={row.rating ?? 'Not rated'} color={ratingColor[row.rating] ?? c.textMuted} />
            </View>
            {myRank >= 0 ? (
              <Text style={{ ...type.caption, color: c.textMuted, marginTop: space(1) }}>
                Rank {myRank + 1} of {board.length} this month
              </Text>
            ) : null}
          </Card>

          <SectionTitle>Breakdown</SectionTitle>
          <Card>
            {COMPONENTS.map((comp) => (
              <ComponentBar
                key={comp.key}
                label={comp.label}
                weight={weights[comp.key]}
                score={row[comp.scoreKey]}
                auto={comp.auto}
              />
            ))}
            <View style={{ borderTopWidth: 1, borderTopColor: c.border, marginTop: space(2), paddingTop: space(1.5) }}>
              <Text style={{ ...type.caption, color: c.textMuted }}>
                Attendance is scored automatically from your clock-ins: on time 100, late under 30 min 85, under an hour
                70, over an hour 50, approved absence 80, unauthorised 0 — averaged across the month.
              </Text>
            </View>
          </Card>
        </>
      )}

      {canSelfEval ? (
        <>
          <SectionTitle>Self evaluation</SectionTitle>
          <Card>
            <Text style={{ ...type.body, color: c.textMuted }}>
              Rate your own month out of 100. This is {weights.self}% of your total score.
            </Text>
            <TextInput
              value={selfScore}
              onChangeText={setSelfScore}
              keyboardType="number-pad"
              maxLength={3}
              style={{
                ...type.h1,
                color: c.text,
                backgroundColor: c.surfaceAlt,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: radius.sm,
                paddingHorizontal: space(2),
                paddingVertical: space(1),
                marginTop: space(1.5),
                textAlign: 'center',
              }}
            />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything your manager should know (optional)"
              placeholderTextColor={c.textFaint}
              multiline
              style={{
                ...type.body,
                color: c.text,
                backgroundColor: c.surfaceAlt,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: radius.sm,
                padding: space(1.5),
                marginTop: space(1),
                minHeight: space(9),
                textAlignVertical: 'top',
              }}
            />
            <Button
              label={row?.self_score != null ? 'Update self-evaluation' : 'Submit self-evaluation'}
              onPress={submitSelfEval}
              loading={saving}
              style={{ marginTop: space(1.5) }}
            />
            {message ? (
              <Text style={{ ...type.caption, color: c.mint, marginTop: space(1), textAlign: 'center' }}>{message}</Text>
            ) : null}
          </Card>
        </>
      ) : null}

      {board.length > 0 ? (
        <>
          <SectionTitle>Team leaderboard</SectionTitle>
          <Card style={{ padding: 0 }}>
            {board.map((b, i) => {
              const isMe = b.employee_id === employee?.id
              return (
                <View
                  key={b.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space(1.5),
                    padding: space(1.5),
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: c.border,
                    backgroundColor: isMe ? c.mint + '0F' : 'transparent',
                  }}
                >
                  <Text style={{ ...type.label, color: c.textMuted, width: 20 }}>{i + 1}</Text>
                  <Avatar name={b.employees?.full_name} size={32} />
                  <Text style={{ ...type.body, color: c.text, flex: 1 }} numberOfLines={1}>
                    {isMe ? 'You' : (b.employees?.full_name ?? 'Unknown')}
                  </Text>
                  <Text style={{ ...type.label, color: c.text }}>{Math.round(num(b.total_score))}</Text>
                </View>
              )
            })}
          </Card>
        </>
      ) : null}

      {history.length > 1 ? (
        <>
          <SectionTitle>History</SectionTitle>
          <Card style={{ padding: 0 }}>
            {history.map((h, i) => (
              <View
                key={h.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: space(1.5),
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: c.border,
                }}
              >
                <Text style={{ ...type.body, color: c.text }}>{periodLabel(h.period_year, h.period_month)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
                  <Badge label={h.rating ?? '—'} color={ratingColor[h.rating] ?? c.textMuted} />
                  <Text style={{ ...type.label, color: c.text, width: 32, textAlign: 'right' }}>
                    {Math.round(num(h.total_score))}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  )
}
