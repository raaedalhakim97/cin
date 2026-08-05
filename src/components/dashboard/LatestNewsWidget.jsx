import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Newspaper, BadgeCheck } from 'lucide-react'
import supabase from '../../services/supabase'

// Extracted verbatim from Dashboard.jsx (session 32) so all four role
// dashboards can reuse the exact same widget instead of copy-pasting it.

// Mirrors NewsFeed.jsx's CATEGORIES accent map — kept minimal here since this
// widget only ever shows a small category dot, not the full tag.
const NEWS_CATEGORY_DOT = {
  announcement: 'bg-[#4D9FFF]',
  news:         'bg-[#00BBF9]',
  achievement:  'bg-[#A78BFA]',
  training:     'bg-[#FF8C42]',
  policy:       'bg-[#9B5DE5]',
}

function newsTimeAgo(iso) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const hr = Math.floor(diffMs / 3600000)
  if (hr < 1) return 'just now'
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function LatestNewsWidget() {
  const [posts, setPosts]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('feed_posts')
        .select('id, title, category, published_at, author_employee_id, employees(full_name)')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(3)
      setPosts(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Latest News</h2>
        <Link to="/news" className="text-xs text-[#00D4A0] hover:underline">View all</Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={18} className="animate-spin text-[#00D4A0]" />
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center py-6">
          <Newspaper size={20} className="text-[#AAAAAA] dark:text-[#555555] mb-2" />
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">No posts yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map(p => {
            const isSystem = p.author_employee_id === null
            return (
              <Link
                key={p.id}
                to="/news"
                className="flex items-start gap-3 p-3 -mx-3 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
              >
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${NEWS_CATEGORY_DOT[p.category] ?? 'bg-[#A0A0A0]'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1A] dark:text-white truncate">{p.title}</p>
                  <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 flex items-center gap-1">
                    {isSystem ? (
                      <span className="flex items-center gap-1">
                        <BadgeCheck size={10} className="text-[#00D4A0]" /> BYOND HR
                      </span>
                    ) : (
                      p.employees?.full_name ?? 'Unknown'
                    )}
                    <span>· {newsTimeAgo(p.published_at)}</span>
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
