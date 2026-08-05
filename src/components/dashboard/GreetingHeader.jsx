function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// Shared across every dashboard variant (session 32) — rendered once by
// Dashboard.jsx's dispatcher rather than duplicated in each role dashboard.
export default function GreetingHeader({ name }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">
        {greeting()}{name ? `, ${name.split(' ')[0]}` : ''} 👋
      </h1>
      <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
        {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </p>
    </div>
  )
}
