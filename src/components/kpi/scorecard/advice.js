// Turning the numbers into sentences.
//
// Raaed asked for "a small summary about the score performance and how to increase it —
// the app should understand and recommend feedback for both manager and employee". This is
// that, and it is deliberately not a language model: every sentence here is derived from a
// figure the database computed, so it cannot say something the data does not support.
//
// The two audiences need different sentences from the same rows. An employee needs "here
// is the one thing to change and what good looks like"; a manager needs "here is what this
// costs you and where you two disagree". Writing one paragraph for both produces something
// that reads like it was written for neither.

// The rating bands mirror compute_kpi_rating() in the database so the two systems do not
// describe the same number differently.
export function bandFor(score) {
  if (score == null) return { label: 'Not yet rated', hex: '#A0A0A0' }
  if (score >= 90) return { label: 'Exceptional',        hex: '#A78BFA' }
  if (score >= 75) return { label: 'High performer',     hex: '#00D4A0' }
  if (score >= 60) return { label: 'Meets expectations', hex: '#4D9FFF' }
  if (score >= 45) return { label: 'Needs improvement',  hex: '#FF8C42' }
  return { label: 'Unsatisfactory', hex: '#FF4D4D' }
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

// ── For the person being reviewed ──────────────────────────────────────────
export function employeeAdvice({ score, coverage, opportunities }) {
  const lines = []
  const shortfalls = opportunities.filter((o) => o.band === 'shortfall')
  const upsides = opportunities.filter((o) => o.band === 'upside')

  if (score == null) {
    lines.push({
      tone: 'neutral',
      text: 'Nothing has been rated yet, so there is no score to explain. Your criteria and what each level means are below — they are worth reading before the review, not after.',
    })
    return lines
  }

  const band = bandFor(Number(score))
  lines.push({
    tone: 'headline',
    text: `${Number(score).toFixed(0)} out of 100 — ${band.label.toLowerCase()}.`
      + (coverage < 100 ? ` Based on ${coverage}% of your scorecard so far.` : ''),
  })

  if (shortfalls.length > 0) {
    const worst = shortfalls[0]
    lines.push({
      tone: 'fix',
      text: `${shortfalls.length === 1 ? 'One criterion is' : `${shortfalls.length} criteria are`} below the standard`
        + `, costing ${shortfalls.reduce((s, o) => s + Number(o.points_at_stake), 0).toFixed(1)} points in total.`
        + ` Start with ${worst.definition_name} — reaching "meets expectations" there is worth ${Number(worst.points_at_stake).toFixed(1)} points on its own.`,
    })
    if (worst.target_anchor) {
      lines.push({ tone: 'quote', text: worst.target_anchor, label: `What "meets expectations" looks like for ${worst.definition_name}` })
    }
  } else if (upsides.length > 0) {
    const best = upsides[0]
    lines.push({
      tone: 'grow',
      text: `Nothing is below the standard. The largest single gain available is ${best.definition_name}`
        + ` — one level up is worth ${Number(best.points_at_stake).toFixed(1)} points.`,
    })
    if (best.target_anchor) {
      lines.push({ tone: 'quote', text: best.target_anchor, label: `What the next level looks like for ${best.definition_name}` })
    }
  } else {
    lines.push({ tone: 'grow', text: 'Every criterion is at the top level. There is nothing left to raise.' })
  }

  if (coverage < 100) {
    lines.push({
      tone: 'neutral',
      text: `${(100 - coverage).toFixed(0)}% of your scorecard has not been rated yet, so this figure will move.`,
    })
  }

  return lines
}

// ── For the manager doing the rating ───────────────────────────────────────
export function managerAdvice({ score, coverage, opportunities, disagreements, name }) {
  const lines = []
  const who = name || 'this employee'
  const shortfalls = opportunities.filter((o) => o.band === 'shortfall')

  if (coverage === 0) {
    lines.push({
      tone: 'neutral',
      text: `You have not rated ${who} on anything yet. Each criterion below has the sentences your company wrote for each level — pick the one that describes what actually happened.`,
    })
    return lines
  }

  if (coverage < 100) {
    lines.push({
      tone: 'fix',
      text: `${coverage}% of the scorecard is rated. The score shown is only over what you have filled in, so it will move as you finish.`,
    })
  }

  if (score != null) {
    const band = bandFor(Number(score))
    lines.push({
      tone: 'headline',
      text: `${who} is at ${Number(score).toFixed(0)} — ${band.label.toLowerCase()}.`,
    })
  }

  if (shortfalls.length > 0) {
    const total = shortfalls.reduce((s, o) => s + Number(o.points_at_stake), 0)
    lines.push({
      tone: 'fix',
      text: `${plural(shortfalls.length, 'criterion is', 'criteria are')} below standard, worth ${total.toFixed(1)} points`
        + ` — ${shortfalls.map((o) => o.definition_name).join(', ')}.`
        + ' These are the conversation, not the score.',
    })
  }

  if (disagreements.length > 0) {
    lines.push({
      tone: 'warn',
      text: `You and ${who} are two or more levels apart on ${disagreements.map((d) => d.definition_name).join(', ')}.`
        + ' That is a different account of the same quarter, and it is better found now than in the meeting.',
    })
  } else if (coverage > 0) {
    lines.push({ tone: 'neutral', text: 'No large gaps between your rating and their own.' })
  }

  return lines
}
