// Pulsing placeholder block — same visual language as Dashboard.jsx's
// DashboardSkeleton. Compose these into shapes that match the real content
// (a row of stat cards, a table's rows, a chart panel) rather than a single
// generic spinner.
export function SkeletonBlock({ className = '' }) {
  return (
    <div className={`rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] ${className}`} />
  )
}

export function SkeletonRow({ className = '' }) {
  return <div className={`rounded-lg bg-[#F0F0F0] dark:bg-[#242424] ${className}`} />
}
