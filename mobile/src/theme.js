// Design tokens.
//
// Colour is BYOND's own system, per BYOND-Design-System.md v1.1 — mint #00D4A0
// on warm neutrals. This is the brand the web app uses, and the two surfaces
// should not disagree about what the product looks like.
//
// What IS borrowed from hr_design_final.pdf is structure, not palette: the dark
// chrome bar, the grouped drawer, the 8pt spacing grid, skeleton on every fetch,
// an empty state for every empty list, and a bottom nav capped at five items.
//
// `cyan`/`onCyan` are kept as aliases onto mint so component code that refers to
// them keeps working — there is one accent, and it is mint.

export const light = {
  bg: '#F5F5F0',
  surface: '#FFFFFF',
  surfaceAlt: '#F9F9F7',
  border: '#E8E8E8',
  text: '#1A1A1A',
  textMuted: '#666666',
  textFaint: '#AAAAAA',
  // Chrome — the top bar and drawer stay dark in both themes, which is what
  // frames the light content surfaces.
  chrome: '#1A1A1A',
  chromeAlt: '#2A2A2A',
  chromeText: '#FFFFFF',
  chromeMuted: '#A0A0A0',
  accentSoft: '#E6FBF6',
}

export const dark = {
  bg: '#0F0F0F',
  surface: '#1E1E1E',
  surfaceAlt: '#252525',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textMuted: '#A0A0A0',
  textFaint: '#555555',
  chrome: '#0A0A0A',
  chromeAlt: '#1E1E1E',
  chromeText: '#FFFFFF',
  chromeMuted: '#A0A0A0',
  // Mint at low opacity on a dark ground; the light tint would glare here.
  accentSoft: '#0C2E26',
}

export const brand = {
  mint: '#00D4A0',
  mintHover: '#00B589',
  // Text/icon colour that sits on filled mint. Deep green-black rather than
  // white — mint is light enough that white on it fails contrast.
  onMint: '#062B22',
}

export const semantic = {
  success: '#00D4A0',
  warning: '#FF8C42',
  danger: '#FF4D4D',
  info: '#4D9FFF',
  purple: '#A78BFA',
}

// KPI rating colours, matching the web app's RATING_META so a score reads the
// same on both surfaces.
export const ratingColor = {
  Exceptional: semantic.purple,
  'High Performer': brand.mint,
  'Meets Expectations': semantic.info,
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
  return {
    ...(isDark ? dark : light),
    ...brand,
    ...semantic,
    // Aliases — component code written against cyan resolves to mint.
    cyan: brand.mint,
    cyanHover: brand.mintHover,
    onCyan: brand.onMint,
  }
}
