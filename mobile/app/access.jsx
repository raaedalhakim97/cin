import { useCallback, useState } from 'react'
import { View, Text, Pressable, Modal, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../src/lib/supabase'
import useAuthStore from '../src/store/authStore'
import { NAV } from '../src/lib/vocabulary'
import Screen from '../src/components/Screen'
import {
  LEVEL_LABEL,
  MODULE_GROUPS,
  ROLES,
  ROLE_LABELS,
  ROLE_PURPOSE,
  ROLE_PURPOSE_OTHER,
  cell,
} from '../src/lib/permissions'
import { Avatar, Badge, Button, Card, EmptyState, Overline, SectionTitle, SkeletonCard, useTheme } from '../src/components/ui'
import { radius, space, type } from '../src/theme'

// Access & permissions.
//
// Two things live here, gated by "User roles / permissions" in §3:
//   • "My access" — what your own role grants, readable by anyone. This is
//     rendered from the role already in the session, so it needs no extra read.
//   • Role assignment — super_admin only (F on that row). RLS is the real
//     enforcement; this screen simply doesn't offer the control to anyone else.
//
// Note on the matrix: that row shows '-' for hr_manager, department_manager,
// admin and read_only, yet every user's login reads their own user_roles row to
// discover their role at all. So the cell means "no management access", not
// "cannot read own row".

const LEVEL_COLOR = (c) => ({
  F: c.success,
  W: c.mint,
  O: c.info,
  B: c.info,
  R: c.textMuted,
  '-': c.textFaint,
})

function LevelPill({ level }) {
  const { c } = useTheme()
  const colors = LEVEL_COLOR(c)
  const color = colors[level] ?? c.textFaint
  const none = level === '-'
  return (
    <View
      style={{
        minWidth: space(9),
        paddingHorizontal: space(1),
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: none ? 'transparent' : color + '1F',
        borderWidth: none ? 1 : 0,
        borderColor: c.border,
        alignItems: 'center',
      }}
    >
      <Text style={{ ...type.caption, fontWeight: '700', color: none ? c.textFaint : color }}>
        {LEVEL_LABEL[level] ?? level}
      </Text>
    </View>
  )
}

export default function Access() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const can = useAuthStore((s) => s.caps)
  const role = useAuthStore((s) => s.role)
  const companyId = useAuthStore((s) => s.companyId)
  const employee = useAuthStore((s) => s.employee)
  const loadProfile = useAuthStore((s) => s.loadProfile)
  const session = useAuthStore((s) => s.session)

  const [tab, setTab] = useState('mine')
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!can.manageRoles) {
      setLoading(false)
      return
    }
    // user_roles carries the assignment; employees supplies the human name.
    const [roleRows, employeeRows] = await Promise.all([
      supabase.from('user_roles').select('user_id, role, company_id').eq('company_id', companyId),
      supabase.from('employees').select('id, user_id, full_name, job_title, departments!employees_department_id_fkey(name)'),
    ])

    const byUser = new Map((employeeRows.data ?? []).map((e) => [e.user_id, e]))
    const joined = (roleRows.data ?? []).map((r) => ({
      ...r,
      employee: byUser.get(r.user_id) ?? null,
    }))
    // Most privileged first, so the people with the most access are visible
    // without scrolling.
    joined.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role))
    setMembers(joined)
    setLoading(false)
  }, [can.manageRoles, companyId])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  async function applyRole(nextRole) {
    if (!editing || !can.manageRoles) return
    setSaving(true)
    setMessage('')
    const { error } = await supabase
      .from('user_roles')
      .update({ role: nextRole })
      .eq('user_id', editing.user_id)
    setSaving(false)
    if (error) {
      console.error('[Access] role change failed', error)
      setMessage("Couldn't change that role. You may not have permission.")
      setEditing(null)
      return
    }
    const name = editing.employee?.full_name ?? 'That account'
    setEditing(null)
    setMessage(`${name} is now ${ROLE_LABELS[nextRole]}`)
    await load()
    // Changing your own role changes your own access, so refresh the session's
    // capabilities rather than leaving the app showing stale permissions.
    if (session && editing.user_id === session.user?.id) await loadProfile(session)
  }

  const showRoleTab = can.manageRoles

  return (
    <Screen title={NAV.access} onRefresh={showRoleTab ? load : undefined}>
      {showRoleTab ? (
        <View style={{ flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: c.surfaceAlt, marginBottom: space(2) }}>
          {[
            ['mine', 'My access'],
            ['roles', 'Who has access'],
          ].map(([key, label]) => {
            const active = tab === key
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={{
                  flex: 1,
                  paddingVertical: space(1.25),
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  backgroundColor: active ? c.mint : 'transparent',
                }}
              >
                <Text style={{ ...type.label, color: active ? c.onMint : c.textMuted }}>{label}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {message ? (
        <View style={{ padding: space(1.5), borderRadius: radius.sm, backgroundColor: c.mint + '1A', marginBottom: space(1.5) }}>
          <Text style={{ ...type.body, color: c.mint }}>{message}</Text>
        </View>
      ) : null}

      {tab === 'mine' || !showRoleTab ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
              <Avatar name={employee?.full_name} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.h2, color: c.text }} numberOfLines={1}>
                  {employee?.full_name ?? 'Not linked'}
                </Text>
                <Text style={{ ...type.caption, color: c.textMuted }}>{can.label}</Text>
              </View>
            </View>
            <Text style={{ ...type.body, color: c.textMuted, marginTop: space(1.5) }}>{can.purpose}</Text>
            {can.isReadOnly ? (
              <View style={{ marginTop: space(1.5), padding: space(1.5), borderRadius: radius.sm, backgroundColor: c.warning + '1A' }}>
                <Text style={{ ...type.caption, color: c.warning }}>
                  Read-only means read only. If you also need to clock in or book leave, that requires a separate
                  employee account.
                </Text>
              </View>
            ) : null}
          </Card>

          <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(2) }}>
            What your role grants, module by module. Anything marked no access is hidden from you elsewhere in the app.
          </Text>

          {MODULE_GROUPS.map((group) => (
            <View key={group.title}>
              <SectionTitle>{group.title}</SectionTitle>
              <Card style={{ padding: 0 }}>
                {group.modules.map((module, i) => (
                  <View
                    key={module}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space(1),
                      paddingVertical: space(1.25),
                      paddingHorizontal: space(1.5),
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: c.border,
                    }}
                  >
                    <Text style={{ ...type.body, color: c.text, flex: 1 }}>{module}</Text>
                    <LevelPill level={cell(module, role)} />
                  </View>
                ))}
              </Card>
            </View>
          ))}

          <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(2), marginBottom: space(2) }}>
            Access is set by your company owner and enforced by the database, not by this app. If something you need is
            marked no access, ask them rather than trying again.
          </Text>
        </>
      ) : (
        <>
          <Text style={{ ...type.caption, color: c.textMuted, marginBottom: space(1) }}>
            Everyone in {members.length ? 'your company' : 'this company'} and what they can reach. Only you can change
            these.
          </Text>

          {loading ? (
            <View style={{ gap: space(1.5) }}>
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
            </View>
          ) : members.length === 0 ? (
            <EmptyState icon="—" title="No accounts yet" body="Team members appear here once they accept their invite." />
          ) : (
            <View style={{ gap: space(1) }}>
              {members.map((m) => (
                <Card key={m.user_id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
                    <Avatar name={m.employee?.full_name} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.label, color: c.text }} numberOfLines={1}>
                        {m.employee?.full_name ?? 'Unlinked account'}
                      </Text>
                      <Text style={{ ...type.caption, color: c.textMuted }} numberOfLines={1}>
                        {m.employee?.job_title ?? '—'}
                        {m.employee?.departments?.name ? ` · ${m.employee.departments.name}` : ''}
                      </Text>
                    </View>
                    <Badge label={ROLE_LABELS[m.role] ?? m.role} color={m.role === 'super_admin' ? c.purple : c.info} />
                  </View>
                  <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(1) }}>
                    {ROLE_PURPOSE_OTHER[m.role]}
                  </Text>
                  <Button
                    label="Change role"
                    variant="secondary"
                    onPress={() => setEditing(m)}
                    style={{ marginTop: space(1.5) }}
                  />
                </Card>
              ))}
            </View>
          )}

          <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(2), marginBottom: space(2) }}>
            A role change takes effect the next time that person opens the app. Read Only accounts cannot write
            anything, including their own records — an auditor who also works here needs two accounts.
          </Text>
        </>
      )}

      {/* Role picker. Deliberately a confirm step rather than an inline tap: this
          changes what another person can see and do. */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' }}>
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              padding: space(2),
              paddingBottom: insets.bottom + space(2),
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space(1) }}>
              <Text style={{ ...type.h2, color: c.text, flex: 1 }}>
                Role for {editing?.employee?.full_name ?? 'this account'}
              </Text>
              <Pressable onPress={() => setEditing(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={c.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 420 }}>
              {ROLES.map((r) => {
                const current = editing?.role === r
                return (
                  <Pressable
                    key={r}
                    onPress={() => applyRole(r)}
                    disabled={saving || current}
                    style={{
                      padding: space(1.5),
                      borderRadius: radius.sm,
                      borderWidth: current ? 2 : 1,
                      borderColor: current ? c.mint : c.border,
                      backgroundColor: current ? c.accentSoft : 'transparent',
                      marginBottom: space(1),
                      opacity: saving ? 0.6 : 1,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
                      <Text style={{ ...type.label, color: c.text, flex: 1 }}>{ROLE_LABELS[r]}</Text>
                      {current ? <Badge label="Current" color={c.mint} /> : null}
                    </View>
                    <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2 }}>{ROLE_PURPOSE_OTHER[r]}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>

            <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(1) }}>
              Changing a role changes what that person can see and do immediately.
            </Text>
          </View>
        </View>
      </Modal>
    </Screen>
  )
}
