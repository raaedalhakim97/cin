// The rule that separates one region of /profile from the next.
//
// Privacy and data used to be three more full-width white cards, identical to the ones
// above them, which gave the legal region more visual weight than the employee's own
// employment record. A titled rule costs no height and says "different kind of thing".
//
// ── Why the aside is not simply on the same line ───────────────────────────
//
// It was, and it broke the page on a phone. Title and aside were both shrink-0 either side
// of a flex-1 rule, which is fine until their combined width exceeds the viewport: the
// rule collapses to nothing, the aside keeps its width anyway, and the whole document
// grows wider than the screen. Every card below then hangs off the right edge, and the
// symptom a person reports is not "the text overflows" — it is "nothing is aligned",
// because the entire page has been pushed sideways.
//
// "HR uploads these. You can view and download." is 43 characters. At 390px there is no
// arrangement where it and a heading share a line, so below sm it goes underneath, where
// it has the full width and pushes nothing.
export default function RegionHeading({ title, aside }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline gap-4">
        <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white shrink-0">
          {title}
        </h2>
        <div className="flex-1 h-px bg-[#E8E8E8] dark:bg-[#2A2A2A]" />
        {aside && (
          <span className="hidden sm:inline text-xs text-[#666666] dark:text-[#A0A0A0] shrink-0">
            {aside}
          </span>
        )}
      </div>
      {aside && (
        <p className="sm:hidden text-xs text-[#666666] dark:text-[#A0A0A0] mt-2">
          {aside}
        </p>
      )}
    </div>
  )
}
