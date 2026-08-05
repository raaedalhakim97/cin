// Design tokens — ported from BYOND-Design-System.md v1.1, which is the source
// of truth the web app already follows. The cyan/navy palette in
// hr_design_final.pdf is a superseded draft and deliberately NOT used here;
// what IS taken from that PDF are its cross-cutting rules (bottom nav capped at
// 5 items, skeleton on every fetch, empty state for every empty list).

export const light = {
  bg: '#F5F5F0',
  surface: '#FFFFFF',
  surfaceAlt: '#F9F9F7',
  border: '#E8E8E8',
  text: '#1A1A1A',
  textMuted: '#666666',
  textFaint: '#AAAAAA',
}

export const dark = {
  bg: '#0F0F0F',
  surface: '#1E1E1E',
  surfaceAlt: '#252525',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textMuted: '#A0A0A0',
  textFaint: '#555555',
}

// Brand + semantic colors are mode-independent.
export const brand = {
  mint: '#00D4A0',
  mintHover: '#00B589',
  mintLight: '#E6FBF6',
  onMint: '#062B22',
}

export const semantic = {
  success: '#00D4A0',
  warning: '#FF8C42',
  danger: '#FF4D4D',
  info: '#4D9FFF',
  purple: '#A78BFA',
}

// KPI rating colors, matching web KPI.jsx RATING_META so a score looks the same
// on both surfaces.
export const ratingColor = {
  Exceptional: semantic.purple,
  'High Performer': brand.mint,
  'Meets Expectations': semantic.info,
  'Needs Improvement': semantic.warning,
  Unsatisfactory: semantic.danger,
}

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 }

// 8pt grid, per the design PDF's developer checklist.
export const space = (n) => n * 8

export const type = {
  display: { fontSize: 28, fontWeight: '700' },
  h1: { fontSize: 20, fontWeight: '700' },
  h2: { fontSize: 16, fontWeight: '600' },
  bodyL: { fontSize: 15, fontWeight: '400' },
  body: { fontSize: 14, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 11, fontWeight: '400' },
}

export function palette(isDark) {
  return { ...(isDark ? dark : light), ...brand, ...semantic }
}
