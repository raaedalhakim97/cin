# Colour contrast audit

**19 September 2026.** Prompted by a single line found while raising prose to 14px: the
leave-policy notes were `#AAAAAA` on light and `#555555` on dark, measuring **2.32:1** and
**2.24:1**. That one line was fixed in passing. This is the sweep to find the rest.

Nothing here has been changed in the code except that one line. It is a survey.

## Method

Extracted every `text-[#RRGGBB]` utility in `src/`, split by whether it carried a `dark:`
prefix, and measured each against the surface it actually lands on — `#FFFFFF` cards and
the `#F5F5F0` page in light, `#1E1E1E` cards and `#0F0F0F` page in dark.

The bar is WCAG AA: **4.5:1** for text under 18.66px bold / 24px regular, **3:1** for
larger text and for meaningful icons. Decorative icons beside a text label are exempt, as
are logotypes.

## The headline: the faint grey is the second problem, not the first

The faint grey is real — 140 sites. But the scan turned up something larger that nobody
was looking for.

### Light theme

| Colour | Uses | On white card | On page | Verdict |
| --- | ---: | ---: | ---: | --- |
| `#1A1A1A` | 671 | 17.40 | 15.91 | ok |
| `#666666` | 673 | 5.74 | 5.25 | ok |
| **`#00D4A0`** mint | **319** | **1.92** | **1.76** | **fails — largest by volume** |
| `#AAAAAA` | 116 | 2.32 | 2.12 | fails |
| **`#FF8C42`** amber | **110** | **2.31** | **2.11** | **fails** |
| **`#4D9FFF`** blue | **54** | **2.72** | **2.49** | **fails** |
| `#00A57D` | 26 | 3.14 | 2.88 | fails |
| `#B5B5B5` | 24 | 2.05 | 1.87 | fails |
| `#A0A0A0` without a `dark:` prefix | 22 | 2.61 | 2.39 | fails |

### Dark theme

| Colour | Uses | On `#1E1E1E` | On `#0F0F0F` | Verdict |
| --- | ---: | ---: | ---: | --- |
| `#A0A0A0` | 660 | 6.38 | 7.33 | ok |
| **`#555555`** | **105** | **2.24** | **2.57** | **fails** |
| `#6B6B6B` | 9 | 3.13 | 3.60 | fails |
| `#00D4A0` | 25 | 8.67 | 9.97 | ok |

**Dark mode is in good shape.** Its two body colours cover 660 of ~800 uses and both pass
comfortably. This is almost entirely a light-theme problem, which fits how the product was
built — dark was the default and the one that got looked at.

## Finding 1 — the brand mint is unreadable as text on light, 281 times

`#00D4A0` at **1.92:1** on white is the single largest contrast failure in the product, and
the hardest to fix, because it is the brand colour and it is everywhere.

It is not 281 bugs. Broken down by what it is actually doing:

| Uses | What it is | Bar | Verdict |
| ---: | --- | --- | --- |
| 105 | Icons | 3:1, or exempt if decorative beside a label | Case by case |
| 68 | Mint text on a mint tint (`bg-[#00D4A0]/10`) | 4.5:1 | **Worst case — 1.86:1** |
| 57 | Plain text and values | 4.5:1 | **Fails** |
| 45 | Link and button labels | 4.5:1 | **Fails** |
| 6 | Small-caps headings | 4.5:1 | Exempt — all on always-dark surfaces |

Two things reduce the real number. The wordmark's mint **O** (`Logo.jsx`) is a logotype and
exempt. Several components are dark regardless of theme — `BrandPanel`, `LoginIntro`,
`ChangePasswordCard`, `WorkLocationMap` — where mint measures 8.67:1 and is correct.

The **68 mint-on-mint-tint** cases are the worst in the product: mint text on a 10% mint
wash over white comes out at about **1.86:1**, which is close to invisible. These are status
pills — "Active", "Approved", "Paid" — so they carry meaning.

**Someone has already started fixing this by hand.** `PlatformCompany.jsx` uses
`text-[#00A57D] dark:text-[#00D4A0]` — exactly the right shape, applied in one file. But
`#00A57D` measures 3.14:1, so it fixes the icons and not the text.

## Finding 2 — the faint grey pair, 140 sites

`#AAAAAA` light / `#555555` dark, at 2.32:1 and 2.24:1. By role:

| Sites | Role | Verdict |
| ---: | --- | --- |
| 88 | Readable text | **Needs changing** |
| 43 | Icons | Case by case — decorative ones are exempt |
| 5 | Disabled / unavailable states | Legitimate — dimness *is* the message |
| 3 | Build stamp and mono chrome | Legitimate |
| 1 | Em-dash standing in for an empty value | Legitimate |

The 88 include timestamps in the notification list, secondary lines in permission tables,
and helper text under form fields. None are critical individually; together they are most
of the quiet furniture of the product.

## Finding 3 — amber and blue, 164 uses

`#FF8C42` at 2.31:1 and `#4D9FFF` at 2.72:1 on light. Same problem, same fix, smaller
numbers. Amber already has a working light value — `#B45309` at 5.02:1, introduced in
`SessionTimeoutModal` — so half this decision is already made.

## Finding 4 — 22 uses of `#A0A0A0` with no `dark:` prefix

`#A0A0A0` is the dark-theme body colour, where it measures 6.38:1. Used without the prefix
it lands on a white card at **2.61:1**. These are almost certainly mistakes — a `dark:`
dropped in a copy-paste — rather than decisions, and they are the cheapest fix in this
document.

## The recommendation: four more tokens, same shape as `--danger`

`src/index.css` already proves the pattern. One `@theme inline` mapping plus a pair of
declarations on `html` and `html.dark` fixed 290 sites of red without touching 52 files
twice.

Values below all clear 4.5:1 on a white card, on the `#F5F5F0` page, **and** inside their
own 10% tint — the hardest of the three and the one usually missed:

| Token | Light | Dark | Light measures (white / page / in tint) |
| --- | --- | --- | --- |
| `--danger` | `#B91C1C` | `#FF4D4D` | done — 6.47 / 5.92 / 5.45 |
| `--accent` mint | `#00735F` | `#00D4A0` | 5.81 / 5.31 / 5.39 |
| `--warn` amber | `#B45309` | `#FF8C42` | 5.02 / 4.59 / 4.64 |
| `--info` blue | `#175CD3` | `#4D9FFF` | 5.99 / 5.47 / 5.45 |
| `--muted` grey | `#6E6E6E` | `#8A8A8A` | 5.10 / 4.66 / — |

Note `#00735F` rather than the `#00806A` used in the login design notes: `#00806A` measures
4.47 on the page background, marginally under the bar. `#00735F` clears everywhere.

**One thing this cannot do automatically.** `--danger` was a straight swap because red means
one thing. Mint does not: it is the brand colour on a dark panel, a link, an icon, a status
pill and the fill behind white text. A blind find-and-replace would darken the mint
*buttons* too, which are already correct — `#062B22` ink on `#00D4A0` measures 7.94:1. The
mint pass has to distinguish `text-` from `bg-`, and skip the always-dark components.

## Suggested order

1. **Finding 4** — the 22 missing `dark:` prefixes. Almost certainly typos, cheapest fix here.
2. **Finding 1a** — the 68 mint-on-mint-tint status pills. Worst measured contrast in the
   product at ~1.86:1, and a bounded, well-defined set.
3. **Finding 2** — the 88 readable faint-grey texts, via `--muted`.
4. **Finding 1b** — mint links, labels and plain text, via `--accent`, skipping buttons and
   always-dark components.
5. **Finding 3** — amber and blue, via `--warn` and `--info`.
6. **Icons** — 105 mint plus 43 grey, judged against 3:1, with decorative ones left alone.

Steps 1 and 2 are small and safe. Step 4 is the one that needs care and a look at every
screen afterwards.

## What this does not claim

Passing 4.5:1 does not make text comfortable, and failing it does not make text invisible.
Mint on a mint tint at 1.86:1 genuinely is hard to read; `#AAAAAA` timestamps at 2.32:1 are
legible to most people in good light and not to everyone. The numbers are a floor to design
against, not a verdict on each screen.

Nor is contrast the whole of accessibility. Keyboard order, focus rings, and what a screen
reader announces are not measured here.
