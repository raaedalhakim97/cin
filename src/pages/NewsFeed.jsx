import { useEffect, useState, useCallback } from 'react'
import {
  Plus, X, Check, Loader2, AlertTriangle, Newspaper, Megaphone, Trophy,
  GraduationCap, ScrollText, Pin, MoreVertical, Pencil, Archive, Trash2,
  MessageCircle, Send, ThumbsUp, PartyPopper, HeartHandshake, Lightbulb,
  BadgeCheck, ChevronDown, ChevronUp, FileEdit,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonBlock } from '../components/Skeleton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function timeAgo(iso) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'announcement', label: 'Announcements', tag: 'Announcement', icon: Megaphone,     cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  { value: 'news',         label: 'News',          tag: 'News',         icon: Newspaper,     cls: 'bg-[#00BBF9]/10 text-[#00BBF9]' },
  { value: 'achievement',  label: 'Achievements',  tag: 'Achievement',  icon: Trophy,        cls: 'bg-[#A78BFA]/10 text-[#A78BFA]' },
  { value: 'training',     label: 'Training',      tag: 'Training',     icon: GraduationCap, cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  { value: 'policy',       label: 'Policy',        tag: 'Policy',       icon: ScrollText,    cls: 'bg-[#9B5DE5]/10 text-[#9B5DE5]' },
]
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.value, c]))

const REACTIONS = [
  { value: 'like',       label: 'Like',       icon: ThumbsUp },
  { value: 'celebrate',  label: 'Celebrate',  icon: PartyPopper },
  { value: 'support',    label: 'Support',    icon: HeartHandshake },
  { value: 'insightful', label: 'Insightful', icon: Lightbulb },
]

const MODERATOR_ROLES = new Set(['super_admin', 'hr_manager'])
const ALWAYS_CAN_POST_ROLES = new Set(['super_admin', 'hr_manager', 'department_manager'])

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

// ─── Micro-components ─────────────────────────────────────────────────────────

function CategoryTag({ category }) {
  const meta = CAT[category]
  if (!meta) return null
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>
      <Icon size={11} />
      {meta.tag}
    </span>
  )
}

function Avatar({ authorName, isSystem }) {
  if (isSystem) {
    return (
      <div className="w-10 h-10 rounded-full bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
        <BadgeCheck size={18} className="text-[#00D4A0]" />
      </div>
    )
  }
  return (
    <div className="w-10 h-10 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-sm font-bold shrink-0 select-none">
      {initials(authorName)}
    </div>
  )
}

// ─── Composer Modal ────────────────────────────────────────────────────────────

function ComposerModal({ post, canPin, onClose, onSave, saving }) {
  const [form, setForm] = useState({
    title:    post?.title ?? '',
    body:     post?.body ?? '',
    category: post?.category ?? 'announcement',
    pinned:   post?.pinned ?? false,
  })
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function validate() {
    if (!form.title.trim()) return 'Title is required.'
    if (!form.body.trim()) return 'Body is required.'
    return ''
  }

  async function handleSave(status) {
    const v = validate()
    if (v) { setErr(v); return }
    setErr('')
    await onSave(form, status)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
              {post ? 'Edit Post' : 'New Post'}
            </h2>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">Share an update with the company</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="e.g. Q3 town hall next Thursday"
              className={INPUT}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Body</label>
            <textarea
              rows={5}
              value={form.body}
              onChange={e => set('body', e.target.value)}
              placeholder="Write the full post…"
              className={`${INPUT} resize-none`}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)} className={INPUT}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {canPin && (
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A]">
              <div className="flex items-center gap-2.5">
                <Pin size={15} className="text-[#666666] dark:text-[#A0A0A0]" />
                <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white">Pin to top of feed</span>
              </div>
              <button
                type="button"
                onClick={() => set('pinned', !form.pinned)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  form.pinned ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]'
                }`}
              >
                {form.pinned ? 'Pinned' : 'Not pinned'}
              </button>
            </div>
          )}

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
              className="px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave('draft')}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <FileEdit size={14} />}
              Save Draft
            </button>
            <button
              type="button"
              onClick={() => handleSave('published')}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Publish
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Delete Confirm Modal ──────────────────────────────────────────────────────

function DeleteConfirmModal({ post, onClose, onConfirm, deleting }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl p-6">
        <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-1.5">Delete this post?</h2>
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-5">
          "{post.title}" and all its reactions and comments will be permanently removed. This cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] disabled:opacity-60 transition-colors"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Comments Section ──────────────────────────────────────────────────────────

function CommentEditRow({ comment, onSave, onCancel }) {
  const [text, setText] = useState(comment.body)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!text.trim() || text.trim() === comment.body) { onCancel(); return }
    setSaving(true)
    await onSave(comment, text.trim())
    setSaving(false)
  }

  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <input
        type="text"
        value={text}
        autoFocus
        maxLength={2000}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel() }}
        className="flex-1 px-2 py-1 text-xs rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#00D4A0]/40 text-[#1A1A1A] dark:text-white focus:outline-none"
      />
      <button onClick={save} disabled={saving} className="text-[#00D4A0] hover:text-[#00B589] transition-colors disabled:opacity-50">
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button onClick={onCancel} className="text-[#AAAAAA] dark:text-[#555555] hover:text-[#FF4D4D] transition-colors">
        <X size={12} />
      </button>
    </div>
  )
}

function CommentsSection({ post, comments, loading, employee, canModerate, canWrite, onSubmit, onDelete, onEditComment }) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    await onSubmit(post.id, text)
    setText('')
    setSubmitting(false)
  }

  return (
    <div className="mt-4 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A] space-y-3">
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 size={16} className="animate-spin text-[#00D4A0]" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">No comments yet — be the first to reply.</p>
      ) : (
        comments.map(c => {
          const isOwn = c.employee_id === employee?.id
          const canDelete = isOwn || canModerate
          const isEditing = editingId === c.id
          return (
            <div key={c.id} className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[#00D4A0]/10 flex items-center justify-center text-[#00D4A0] text-[10px] font-bold shrink-0">
                {initials(c.employees?.full_name)}
              </div>
              <div className="flex-1 min-w-0 p-2.5 rounded-xl bg-[#F5F5F0] dark:bg-[#252525]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1A1A1A] dark:text-white">
                    {c.employees?.full_name ?? 'Unknown'}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-[#AAAAAA] dark:text-[#555555]">{timeAgo(c.created_at)}</span>
                    {isOwn && !isEditing && (
                      <button
                        onClick={() => setEditingId(c.id)}
                        className="text-[#AAAAAA] dark:text-[#555555] hover:text-[#00D4A0] transition-colors"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                    {canDelete && !isEditing && (
                      <button
                        onClick={() => onDelete(c)}
                        className="text-[#AAAAAA] dark:text-[#555555] hover:text-[#FF4D4D] transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
                {isEditing ? (
                  <CommentEditRow
                    comment={c}
                    onCancel={() => setEditingId(null)}
                    onSave={async (comment, body) => { await onEditComment(comment, body); setEditingId(null) }}
                  />
                ) : (
                  <p className="text-xs text-[#1A1A1A] dark:text-white mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
                )}
              </div>
            </div>
          )
        })
      )}

      {employee && canWrite && (
        <form onSubmit={submit} className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Write a comment…"
            maxLength={2000}
            className="flex-1 px-3.5 py-2 text-xs rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
          />
          <button
            type="submit"
            disabled={submitting || !text.trim()}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-50 transition-colors shrink-0"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </form>
      )}
    </div>
  )
}

// ─── Post Card ─────────────────────────────────────────────────────────────────

function PostCard({
  post, employee, canModerate, canWrite, reactionState, commentCount, expanded, comments, loadingComments,
  onToggleComments, onReact, onSubmitComment, onDeleteComment, onEditComment, onEdit, onArchive, onDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isAuthor = post.author_employee_id != null && post.author_employee_id === employee?.id
  const isSystem = post.author_employee_id === null
  const canEdit  = isAuthor || canModerate

  const counts = reactionState?.counts ?? {}
  const mine   = reactionState?.mine ?? null

  return (
    <div className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] relative">
      {post.pinned && (
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[#00D4A0] mb-2.5">
          <Pin size={11} className="fill-current" />
          Pinned
        </div>
      )}

      <div className="flex items-start gap-3">
        <Avatar authorName={post.employees?.full_name} isSystem={isSystem} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
              {isSystem ? 'BYOND HR' : post.employees?.full_name ?? 'Unknown'}
            </span>
            {isSystem && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00D4A0]/10 text-[#00D4A0]">
                <BadgeCheck size={10} /> System
              </span>
            )}
            <span className="text-xs text-[#AAAAAA] dark:text-[#555555]">· {timeAgo(post.published_at)}</span>
          </div>
          <div className="mt-1.5">
            <CategoryTag category={post.category} />
          </div>
        </div>

        {canEdit && (
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
            >
              <MoreVertical size={15} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-20 w-40 py-1 rounded-xl bg-white dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-xl">
                  <button
                    onClick={() => { setMenuOpen(false); onEdit(post) }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#1A1A1A] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#1E1E1E] transition-colors"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  {canModerate && (
                    <>
                      <button
                        onClick={() => { setMenuOpen(false); onArchive(post) }}
                        className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#1A1A1A] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#1E1E1E] transition-colors"
                      >
                        <Archive size={12} /> Archive
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); onDelete(post) }}
                        className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#FF4D4D] hover:bg-[#FF4D4D]/10 transition-colors"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <h3 className="text-base font-bold text-[#1A1A1A] dark:text-white mt-3.5">{post.title}</h3>
      <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1.5 whitespace-pre-wrap break-words">{post.body}</p>

      {/* Reaction + comment bar */}
      <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-[#E8E8E8] dark:border-[#2A2A2A] flex-wrap">
        {REACTIONS.map(r => {
          const Icon = r.icon
          const count = counts[r.value] ?? 0
          const active = mine === r.value
          return (
            <button
              key={r.value}
              onClick={() => onReact(post, r.value)}
              disabled={!employee || !canWrite}
              title={r.label}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                active
                  ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                  : 'text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525]'
              }`}
            >
              <Icon size={13} />
              {count > 0 && count}
            </button>
          )
        })}

        <button
          onClick={() => onToggleComments(post.id)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors ml-auto"
        >
          <MessageCircle size={13} />
          {commentCount > 0 && commentCount}
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {expanded && (
        <CommentsSection
          post={post}
          comments={comments ?? []}
          loading={loadingComments}
          employee={employee}
          canModerate={canModerate}
          canWrite={canWrite}
          onSubmit={onSubmitComment}
          onDelete={onDeleteComment}
          onEditComment={onEditComment}
        />
      )}
    </div>
  )
}

// ─── Draft Card ─────────────────────────────────────────────────────────────────

function DraftCard({ post, onEdit, onPublish, publishing }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-white dark:bg-[#1E1E1E] border border-dashed border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="w-8 h-8 rounded-lg bg-[#FF8C42]/10 flex items-center justify-center shrink-0">
        <FileEdit size={14} className="text-[#FF8C42]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{post.title || 'Untitled draft'}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <CategoryTag category={post.category} />
          <span className="text-[10px] text-[#AAAAAA] dark:text-[#555555]">Updated {timeAgo(post.updated_at ?? post.created_at)}</span>
        </div>
      </div>
      <button
        onClick={() => onEdit(post)}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors shrink-0"
      >
        Edit
      </button>
      <button
        onClick={() => onPublish(post)}
        disabled={publishing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors shrink-0"
      >
        {publishing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        Publish
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewsFeed() {
  const employee  = useAuthStore(s => s.employee)
  const role      = useAuthStore(s => s.role)
  const companyId = useAuthStore(s => s.companyId)

  const canPost     = ALWAYS_CAN_POST_ROLES.has(role) || employee?.can_post_feed === true
  const canModerate = MODERATOR_ROLES.has(role)
  // Migration 46 (make_read_only_role_truly_read_only) — feed_reactions_insert/
  // feed_comments_insert/update RLS now excludes read_only. Hide reaction and
  // comment controls rather than let them 400.
  const canWrite    = role !== 'read_only'
  const canPin      = canModerate

  const [activeCategory, setActiveCategory] = useState('all')

  const [posts, setPosts]               = useState([])
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [drafts, setDrafts]             = useState([])
  const [loadingDrafts, setLoadingDrafts] = useState(true)

  const [reactionsByPost, setReactionsByPost] = useState({})
  const [commentCounts, setCommentCounts]     = useState({})
  const [expanded, setExpanded]               = useState(new Set())
  const [commentsByPost, setCommentsByPost]   = useState({})
  const [loadingCommentsFor, setLoadingCommentsFor] = useState(null)

  const [showComposer, setShowComposer] = useState(false)
  const [editTarget, setEditTarget]     = useState(null)
  const [saving, setSaving]             = useState(false)
  const [publishingId, setPublishingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting]         = useState(false)

  const { toast, showToast } = useToast()

  // ── Fetchers ────────────────────────────────────────────────────────────────

  const fetchPosts = useCallback(async () => {
    setLoadingPosts(true)
    const { data } = await supabase
      .from('feed_posts')
      .select('*, employees(full_name)')
      .eq('status', 'published')
      .order('pinned', { ascending: false })
      .order('published_at', { ascending: false })
    setPosts(data ?? [])
    setLoadingPosts(false)
  }, [])

  const fetchDrafts = useCallback(async () => {
    if (!canPost || !employee?.id) { setDrafts([]); setLoadingDrafts(false); return }
    setLoadingDrafts(true)
    const { data } = await supabase
      .from('feed_posts')
      .select('*')
      .eq('status', 'draft')
      .eq('author_employee_id', employee.id)
      .order('created_at', { ascending: false })
    setDrafts(data ?? [])
    setLoadingDrafts(false)
  }, [canPost, employee?.id])

  const fetchEngagement = useCallback(async (postIds) => {
    if (!postIds.length) { setReactionsByPost({}); setCommentCounts({}); return }
    const [{ data: reactions }, { data: comments }] = await Promise.all([
      supabase.from('feed_reactions').select('id, post_id, employee_id, reaction').in('post_id', postIds),
      supabase.from('feed_comments').select('id, post_id').in('post_id', postIds),
    ])

    const rMap = {}
    ;(reactions ?? []).forEach(r => {
      if (!rMap[r.post_id]) rMap[r.post_id] = { counts: {}, mine: null, myId: null }
      rMap[r.post_id].counts[r.reaction] = (rMap[r.post_id].counts[r.reaction] ?? 0) + 1
      if (r.employee_id === employee?.id) {
        rMap[r.post_id].mine = r.reaction
        rMap[r.post_id].myId = r.id
      }
    })
    setReactionsByPost(rMap)

    const cMap = {}
    ;(comments ?? []).forEach(c => { cMap[c.post_id] = (cMap[c.post_id] ?? 0) + 1 })
    setCommentCounts(cMap)
  }, [employee?.id])

  const loadComments = useCallback(async (postId) => {
    setLoadingCommentsFor(postId)
    const { data } = await supabase
      .from('feed_comments')
      .select('*, employees(full_name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
    setCommentsByPost(prev => ({ ...prev, [postId]: data ?? [] }))
    setLoadingCommentsFor(null)
  }, [])

  useEffect(() => { fetchPosts() }, [fetchPosts])
  useEffect(() => { fetchDrafts() }, [fetchDrafts])
  useEffect(() => {
    fetchEngagement(posts.map(p => p.id))
  }, [posts, fetchEngagement])

  // ── Actions ─────────────────────────────────────────────────────────────────

  function toggleComments(postId) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(postId)) {
        next.delete(postId)
      } else {
        next.add(postId)
        if (!commentsByPost[postId]) loadComments(postId)
      }
      return next
    })
  }

  async function reactToPost(post, type) {
    if (!employee?.id || !canWrite) return
    const current = reactionsByPost[post.id]
    if (current?.mine === type) {
      await supabase.from('feed_reactions').delete().eq('id', current.myId)
    } else {
      if (current?.myId) await supabase.from('feed_reactions').delete().eq('id', current.myId)
      const { error } = await supabase.from('feed_reactions').insert({
        company_id:  companyId,
        post_id:     post.id,
        employee_id: employee.id,
        reaction:    type,
      })
      if (error) {
        console.error('[NewsFeed] reactToPost failed', error)
        showToast('error', 'Something went wrong saving your reaction. Please try again.')
        return
      }
    }
    fetchEngagement(posts.map(p => p.id))
  }

  async function submitComment(postId, body) {
    if (!canWrite) return
    const { error } = await supabase.from('feed_comments').insert({
      company_id:  companyId,
      post_id:     postId,
      employee_id: employee.id,
      body:        body.trim(),
    })
    if (error) {
      console.error('[NewsFeed] submitComment failed', error)
      showToast('error', 'Something went wrong posting your comment. Please try again.')
      return
    }
    await Promise.all([loadComments(postId), fetchEngagement(posts.map(p => p.id))])
  }

  async function deleteComment(comment) {
    const { error } = await supabase.from('feed_comments').delete().eq('id', comment.id)
    if (error) {
      console.error('[NewsFeed] deleteComment failed', error)
      showToast('error', 'Something went wrong deleting this comment. Please try again.')
      return
    }
    await Promise.all([loadComments(comment.post_id), fetchEngagement(posts.map(p => p.id))])
  }

  async function editComment(comment, body) {
    const { error } = await supabase.from('feed_comments').update({ body }).eq('id', comment.id)
    if (error) {
      console.error('[NewsFeed] editComment failed', error)
      showToast('error', 'Something went wrong editing this comment. Please try again.')
      return
    }
    await loadComments(comment.post_id)
  }

  function openNewPost() {
    setEditTarget(null)
    setShowComposer(true)
  }

  function openEditPost(post) {
    setEditTarget(post)
    setShowComposer(true)
  }

  async function savePost(form, status) {
    setSaving(true)
    const payload = {
      title:    form.title.trim(),
      body:     form.body.trim(),
      category: form.category,
      pinned:   canPin ? form.pinned : false,
      status,
      published_at: status === 'published' ? (editTarget?.published_at ?? new Date().toISOString()) : null,
    }

    const { error } = editTarget
      ? await supabase.from('feed_posts').update(payload).eq('id', editTarget.id)
      : await supabase.from('feed_posts').insert({
          ...payload,
          company_id:         companyId,
          author_employee_id: employee.id,
          source:              'manual',
        })

    setSaving(false)
    if (error) {
      console.error('[NewsFeed] savePost failed', error)
      showToast('error', 'Something went wrong saving this post. Please try again.')
      return
    }
    setShowComposer(false)
    setEditTarget(null)
    showToast('success', status === 'published' ? 'Post published' : 'Draft saved')
    await Promise.all([fetchPosts(), fetchDrafts()])
  }

  async function publishDraft(post) {
    setPublishingId(post.id)
    const { error } = await supabase
      .from('feed_posts')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', post.id)
    setPublishingId(null)
    if (error) {
      console.error('[NewsFeed] publishDraft failed', error)
      showToast('error', 'Something went wrong publishing this post. Please try again.')
      return
    }
    showToast('success', 'Post published')
    await Promise.all([fetchPosts(), fetchDrafts()])
  }

  async function archivePost(post) {
    const { error } = await supabase.from('feed_posts').update({ status: 'archived' }).eq('id', post.id)
    if (error) {
      console.error('[NewsFeed] archivePost failed', error)
      showToast('error', 'Something went wrong archiving this post. Please try again.')
      return
    }
    showToast('success', 'Post archived')
    fetchPosts()
  }

  async function confirmDelete() {
    setDeleting(true)
    const { error } = await supabase.from('feed_posts').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) {
      console.error('[NewsFeed] confirmDelete failed', error)
      showToast('error', 'Something went wrong deleting this post. Please try again.')
      return
    }
    setDeleteTarget(null)
    showToast('success', 'Post deleted')
    await Promise.all([fetchPosts(), fetchDrafts()])
  }

  // ── No employee record linked ───────────────────────────────────────────────

  if (!employee) {
    return (
      <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
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

  const filteredPosts = activeCategory === 'all'
    ? posts
    : posts.filter(p => p.category === activeCategory)

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full">

          {/* Page header */}
          <div className="flex items-start justify-between mb-6 gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">News Feed</h1>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                Company announcements, news, and achievements
              </p>
            </div>
            {canPost && (
              <button
                onClick={openNewPost}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors shadow-sm shrink-0"
              >
                <Plus size={15} />
                New Post
              </button>
            )}
          </div>

          {/* Category chips */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                activeCategory === 'all'
                  ? 'bg-[#00D4A0] text-white'
                  : 'bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
              }`}
            >
              All
            </button>
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => setActiveCategory(c.value)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeCategory === c.value
                    ? c.cls
                    : 'bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
                }`}
              >
                <c.icon size={12} />
                {c.label}
              </button>
            ))}
          </div>

          {/* Drafts */}
          {canPost && !loadingDrafts && drafts.length > 0 && (
            <div className="mb-6 space-y-2">
              <p className="text-xs font-semibold tracking-widest text-[#AAAAAA] dark:text-[#555555] uppercase">
                Your Drafts
              </p>
              {drafts.map(d => (
                <DraftCard
                  key={d.id}
                  post={d}
                  onEdit={openEditPost}
                  onPublish={publishDraft}
                  publishing={publishingId === d.id}
                />
              ))}
            </div>
          )}

          {/* Feed */}
          {loadingPosts ? (
            <div className="space-y-4 animate-pulse">
              {[0, 1, 2].map(i => <SkeletonBlock key={i} className="h-40" />)}
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="flex flex-col items-center py-16 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
              <div className="w-14 h-14 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center mb-3">
                <Newspaper size={22} className="text-[#00D4A0]" />
              </div>
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                {activeCategory === 'all' ? 'No posts yet' : 'Nothing here yet'}
              </p>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1 mb-5">
                {canPost ? 'Share the first update with the company' : 'Check back soon for company updates'}
              </p>
              {canPost && (
                <button
                  onClick={openNewPost}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
                >
                  <Plus size={14} /> New Post
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredPosts.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  employee={employee}
                  canModerate={canModerate}
                  canWrite={canWrite}
                  reactionState={reactionsByPost[post.id]}
                  commentCount={commentCounts[post.id] ?? 0}
                  expanded={expanded.has(post.id)}
                  comments={commentsByPost[post.id]}
                  loadingComments={loadingCommentsFor === post.id}
                  onToggleComments={toggleComments}
                  onReact={reactToPost}
                  onSubmitComment={submitComment}
                  onDeleteComment={deleteComment}
                  onEditComment={editComment}
                  onEdit={openEditPost}
                  onArchive={archivePost}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <ToastComp toast={toast} />

      {showComposer && (
        <ComposerModal
          post={editTarget}
          canPin={canPin}
          onClose={() => { setShowComposer(false); setEditTarget(null) }}
          onSave={savePost}
          saving={saving}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          post={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          deleting={deleting}
        />
      )}
    </div>
  )
}
