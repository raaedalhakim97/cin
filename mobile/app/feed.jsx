import { useCallback, useState } from 'react'
import { View, Text, ScrollView, RefreshControl, Pressable, TextInput } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../src/lib/supabase'
import useAuthStore from '../src/store/authStore'
import { NAV } from '../src/lib/vocabulary'
import { Avatar, Card, EmptyState, ErrorState, SkeletonCard, useTheme } from '../src/components/ui'
import { shortDate } from '../src/lib/format'
import { radius, space, type } from '../src/theme'

const REACTIONS = [
  { key: 'like', icon: 'thumbs-up', label: 'Like' },
  { key: 'celebrate', icon: 'sparkles', label: 'Celebrate' },
  { key: 'support', icon: 'heart', label: 'Support' },
]

export default function Feed() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const employee = useAuthStore((s) => s.employee)
  const can = useAuthStore((s) => s.caps)

  const [posts, setPosts] = useState([])
  const [reactions, setReactions] = useState([])
  const [comments, setComments] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [openComments, setOpenComments] = useState(null)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)

  // "News feed — react/comment": F for super_admin/hr_manager/
  // department_manager/admin, O for employee, blocked for read_only.
  const canInteract = can.reactAndComment

  const load = useCallback(async () => {
    setError(false)
    const { data: postRows, error: postErr } = await supabase
      .from('feed_posts')
      .select('id, title, body, created_at, employees!feed_posts_author_employee_id_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(30)

    if (postErr) {
      console.error('[Feed] load failed', postErr)
      setError(true)
      setLoading(false)
      return
    }

    const ids = (postRows ?? []).map((p) => p.id)
    let reactionRows = []
    let commentRows = []
    if (ids.length) {
      const [rx, cm] = await Promise.all([
        supabase.from('feed_reactions').select('id, post_id, employee_id, reaction').in('post_id', ids),
        supabase
          .from('feed_comments')
          .select('id, post_id, body, created_at, employees!feed_comments_employee_id_fkey(full_name)')
          .in('post_id', ids)
          .order('created_at', { ascending: true }),
      ])
      reactionRows = rx.data ?? []
      commentRows = cm.data ?? []
    }

    const grouped = {}
    for (const cm of commentRows) {
      grouped[cm.post_id] = grouped[cm.post_id] ?? []
      grouped[cm.post_id].push(cm)
    }

    setPosts(postRows ?? [])
    setReactions(reactionRows)
    setComments(grouped)
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  async function toggleReaction(postId, kind) {
    if (!canInteract || !employee?.id) return
    const mine = reactions.find((r) => r.post_id === postId && r.employee_id === employee.id)

    if (mine?.reaction === kind) {
      await supabase.from('feed_reactions').delete().eq('id', mine.id)
    } else {
      if (mine) await supabase.from('feed_reactions').delete().eq('id', mine.id)
      const { error: insErr } = await supabase
        .from('feed_reactions')
        .insert({ post_id: postId, employee_id: employee.id, reaction: kind })
      if (insErr) console.error('[Feed] reaction failed', insErr)
    }
    load()
  }

  async function addComment(postId) {
    const body = draft.trim()
    if (!body || !canInteract || !employee?.id) return
    setPosting(true)
    const { error: insErr } = await supabase
      .from('feed_comments')
      .insert({ post_id: postId, employee_id: employee.id, body })
    setPosting(false)
    if (insErr) {
      console.error('[Feed] addComment failed', insErr)
      return
    }
    setDraft('')
    load()
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space(2), paddingTop: insets.top + space(2), paddingBottom: space(4) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.mint} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), marginBottom: space(2) }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={c.text} />
        </Pressable>
        <Text style={{ ...type.h1, color: c.text }}>{NAV.news}</Text>
      </View>

      {loading ? (
        <View style={{ gap: space(1.5) }}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </View>
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : posts.length === 0 ? (
        <EmptyState icon="—" title="Nothing posted yet" body="Company news and HR notices will appear here." />
      ) : (
        <View style={{ gap: space(1.5) }}>
          {posts.map((p) => {
            const postReactions = reactions.filter((r) => r.post_id === p.id)
            const mine = postReactions.find((r) => r.employee_id === employee?.id)
            const postComments = comments[p.id] ?? []
            const showComments = openComments === p.id

            return (
              <Card key={p.id}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
                  <Avatar name={p.employees?.full_name} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.label, color: c.text }} numberOfLines={1}>
                      {p.employees?.full_name ?? 'HR'}
                    </Text>
                    <Text style={{ ...type.caption, color: c.textFaint }}>{shortDate(p.created_at)}</Text>
                  </View>
                </View>

                {p.title ? (
                  <Text style={{ ...type.h2, color: c.text, marginTop: space(1.5) }}>{p.title}</Text>
                ) : null}
                <Text style={{ ...type.body, color: c.textMuted, marginTop: space(0.5), lineHeight: 20 }}>{p.body}</Text>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space(2),
                    marginTop: space(1.5),
                    paddingTop: space(1),
                    borderTopWidth: 1,
                    borderTopColor: c.border,
                  }}
                >
                  {REACTIONS.map((rx) => {
                    const count = postReactions.filter((r) => r.reaction === rx.key).length
                    const active = mine?.reaction === rx.key
                    return (
                      <Pressable
                        key={rx.key}
                        onPress={() => toggleReaction(p.id, rx.key)}
                        disabled={!canInteract}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: canInteract ? 1 : 0.4 }}
                        hitSlop={6}
                      >
                        <Ionicons
                          name={active ? rx.icon : `${rx.icon}-outline`}
                          size={17}
                          color={active ? c.mint : c.textMuted}
                        />
                        {count > 0 ? (
                          <Text style={{ ...type.caption, color: active ? c.mint : c.textMuted }}>{count}</Text>
                        ) : null}
                      </Pressable>
                    )
                  })}

                  <Pressable
                    onPress={() => {
                      setOpenComments(showComments ? null : p.id)
                      setDraft('')
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' }}
                    hitSlop={6}
                  >
                    <Ionicons name="chatbubble-outline" size={16} color={c.textMuted} />
                    <Text style={{ ...type.caption, color: c.textMuted }}>{postComments.length}</Text>
                  </Pressable>
                </View>

                {showComments ? (
                  <View style={{ marginTop: space(1.5), gap: space(1) }}>
                    {postComments.map((cm) => (
                      <View key={cm.id} style={{ flexDirection: 'row', gap: space(1) }}>
                        <Avatar name={cm.employees?.full_name} size={28} />
                        <View style={{ flex: 1, backgroundColor: c.surfaceAlt, borderRadius: radius.sm, padding: space(1) }}>
                          <Text style={{ ...type.caption, color: c.text, fontWeight: '700' }}>
                            {cm.employees?.full_name ?? 'Someone'}
                          </Text>
                          <Text style={{ ...type.body, color: c.textMuted, marginTop: 2 }}>{cm.body}</Text>
                        </View>
                      </View>
                    ))}

                    {canInteract ? (
                      <View style={{ flexDirection: 'row', gap: space(1), alignItems: 'center' }}>
                        <TextInput
                          value={draft}
                          onChangeText={setDraft}
                          placeholder="Write a comment…"
                          placeholderTextColor={c.textFaint}
                          style={{
                            ...type.body,
                            flex: 1,
                            color: c.text,
                            backgroundColor: c.surfaceAlt,
                            borderRadius: radius.sm,
                            paddingHorizontal: space(1.5),
                            paddingVertical: space(1),
                          }}
                        />
                        <Pressable onPress={() => addComment(p.id)} disabled={posting || !draft.trim()} hitSlop={8}>
                          <Ionicons name="send" size={20} color={draft.trim() ? c.mint : c.textFaint} />
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={{ ...type.caption, color: c.textFaint }}>
                        Read-only accounts can read the feed but not comment.
                      </Text>
                    )}
                  </View>
                ) : null}
              </Card>
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}
