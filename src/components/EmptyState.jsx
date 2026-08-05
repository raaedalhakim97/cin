// Shared empty-state pattern: centered muted icon, headline, one-line hint,
// and an optional mint CTA — only pass `action` when there's something useful
// to do about the empty state (e.g. "Request leave"). Leave it out for
// passive empty states (e.g. "No news yet").
export default function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      {Icon && <Icon size={40} strokeWidth={1.5} className="text-[#AAAAAA] dark:text-[#555555] mb-3" />}
      <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{title}</p>
      {hint && <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1 max-w-sm">{hint}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 bg-[#00D4A0] hover:bg-[#00B589] text-white font-semibold text-sm py-2.5 px-5 rounded-lg transition-colors duration-200"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
