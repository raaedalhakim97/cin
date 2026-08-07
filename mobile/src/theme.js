// Design tokens.
//
// Colour is BYOND's own system, per BYOND-Design-System.md v1.1 — mint #00D4A0
// on warm neutrals. This is the brand the web app uses, and the two surfaces
// should not disagree about what the product looks like.
//
// What IS borrowed from hr_design_final.pdf is structure, not palette: the
// grouped drawer, the 8pt spacing grid, skeleton on every fetch, an empty state
// for every empty list, and a bottom nav capped at five items. The chrome was
// borrowed too and is no longer — it followed the reference app in staying dark
// in both themes, which put a black bar on the phone where the browser has a
// white one. Chrome now tracks the theme, as the web's header and sidebar do.
//
// One value is deliberately NOT matched to the web: light.surfaceAlt. The web
// fills inputs with #F5F5F0 inside a white card. Several mobile screens — login
// above all — place inputs straight onto the page, which is itself #F5F5F0, so
// the same value would erase the fill. #F9F9F7 is the half-step that keeps it
// readable. Matching a hex is not the goal; matching what a person sees is.
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
  // Chrome — the top bar and drawer. These follow the theme, matching the web
  // app's header and sidebar exactly (`bg-white dark:bg-[#1A1A1A]`).
  //
  // They used to be dark in both themes, borrowed from the reference app's
  // structure. That gave the phone a black bar where the browser has a white
  // one, so the two surfaces disagreed about what the product looks like in
  // light mode — the first thing you notice putting them side by side.
  chrome: '#FFFFFF',
  chromeAlt: '#F5F5F0',
  chromeText: '#1A1A1A',
  chromeMuted: '#666666',
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
  // #1A1A1A, not #0A0A0A: the web's dark header and sidebar are #1A1A1A, one
  // step lighter than the #0F0F0F page behind them. #0A0A0A made the phone's
  // bar darker than its own background, inverting that relationship.
  chrome: '#1A1A1A',
  chromeAlt: '#252525',
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
