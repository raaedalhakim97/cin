// Design tokens.
//
// Palette is the 2026 system from hr_design_final.pdf — cyan primary on cool
// blue-grey neutrals. That document defines light only, so the dark counterpart
// below is designed rather than inverted: the neutrals stay on the same navy
// hue family so cyan keeps its relationship to the ground in both themes.
//
// From the same PDF's developer checklist: 8pt spacing grid, skeleton on every
// fetch, empty state for every empty list, bottom nav capped at five items.

export const light = {
  bg: '#F4F6F9',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF1F6',
  border: '#E2E8F0',
  text: '#0D1B2A',
  textMuted: '#4A5568',
  textFaint: '#8A9BB5',
  // Chrome — top bar and drawer are dark in both themes, as in the reference app.
  chrome: '#0D1B2A',
  chromeAlt: '#162032',
  chromeText: '#FFFFFF',
  chromeMuted: '#8A9BB5',
  accentSoft: '#E6F9FF',
}

export const dark = {
  bg: '#0B1520',
  surface: '#132030',
  surfaceAlt: '#1A2A3C',
  border: '#24374D',
  text: '#FFFFFF',
  textMuted: '#9FB3C8',
  textFaint: '#64798F',
  chrome: '#060E16',
  chromeAlt: '#0D1B2A',
  chromeText: '#FFFFFF',
  chromeMuted: '#8A9BB5',
  // Cyan at 10% on a dark ground rather than the light tint, which would glare.
  accentSoft: '#0A2E3D',
}

export const brand = {
  cyan: '#00C2FF',
  cyanHover: '#00A8E0',
  // Text/icon colour that sits on a filled cyan surface. Deep navy rather than
  // white — cyan is light enough that white on it fails contrast.
  onCyan: '#04222E',
}

export const semantic = {
  success: '#00D68F',
  warning: '#FFB020',
  danger: '#FF4757',
  info: '#00C2FF',
  purple: '#845EF7',
}

// KPI rating colours. Kept aligned with the web app's RATING_META bands so a
// score reads the same on both surfaces.
export const ratingColor = {
  Exceptional: semantic.purple,
  'High Performer': semantic.success,
  'Meets Expectations': brand.cyan,
  'Needs Improvement': semantic.warning,
  Unsatisfactory: semantic.danger,
}

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 }

// 8pt grid — every margin and padding is a multiple of this.
export const space = (n) => n * 8

export const type = {
  display: { fontSize: 28, fontWeight: '700' },
  h1: { fontSize: 20, fontWeight: '700' },
  h2: { fontSize: 16, fontWeight: '600' },
  bodyL: { fontSize: 15, fontWeight: '400' },
  body: { fontSize: 14, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 11, fontWeight: '400' },
  overline: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
}

export function palette(isDark) {
  return { ...(isDark ? dark : light), ...brand, ...semantic, mint: brand.cyan, onMint: brand.onCyan }
}
