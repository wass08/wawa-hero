# Numerals: font recommendation

Specimen: `numerals.html` → `numerals.png` (full), `numerals-1.png` (Pixelify, Silkscreen, Press Start 2P, Jersey 10), `numerals-2.png` (Chakra Petch, Rubik Mono One, Orbitron).

## Pick: Chakra Petch 700 for every number

Why:
- **Unambiguous digits at 2 m.** Flat-top 5 vs round S, open 3 vs closed 8, narrow 0 vs wide O, flagged 1 vs straight 7. The chamfered corners keep every digit a different silhouette, which is what Pixelify loses on a pixel grid.
- **Tabular by design.** 41,111 and 40,000 are the same width; the score counts up without jitter, and the right-aligned Top Heroes column stays a column.
- **Zero layout cost.** Its digit width is the same as Pixelify's (0.62em cells still fit), so the score panel, ×4 chip, combo, results, setlist row and countdown keep their current sizes. Every other strong candidate (Press Start 2P, Rubik Mono One, Silkscreen) is 30–40 % wider and would force the panels to grow.
- **Holds at 10 px** (setlist BPM, Top Heroes) where the pixel fonts thin out or clog.
- **Fits the identity.** It reads as an LED scoreboard/sign next to the voxel Pixelify wordmark, not as a different game. Pixelify stays for titles, wordmark, labels and judgement words; only numerals change.

Runner-up: **Rubik Mono One** (400). Same family as the body font, heaviest and most legible digits of the set, tabular by construction. Not picked because it is ~40 % wider: the 7-digit score panel, the results score and the ×4 chip would all need to be re-laid out, and its uniform heavy stroke gets loud next to the Pixelify headings.

Rejected: Press Start 2P (right look, too wide and too loud), Silkscreen (odd 4/6, thin strokes), Jersey 10 (good digits, too light at small sizes, needs a 1.22× size bump), Orbitron (0 ≈ O, 3/8 close at small sizes, wrong genre).

## CSS

Add one token and one font to the Google Fonts link (`index.html`):

```html
<link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@500;700&family=Rubik:wght@400;500;600&family=JetBrains+Mono:wght@500&family=Chakra+Petch:wght@700&display=swap" rel="stylesheet">
```

```css
:root {
  --font-num: 'Chakra Petch', 'Pixelify Sans', 'Silkscreen', ui-monospace, monospace;
}

/* every numeral, nothing else */
.num, .digits, .combo .n, .mult, .calories b, .result-points, .results .points,
.stat dd, .save-stats dd, .top-heroes strong, .row .m b, .countdown .n {
  font-family: var(--font-num);
  font-weight: 700;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}
```

Optical adjustments (Chakra Petch's cap height matches Pixelify's at the same size, so **sizes stay as they are**: score digits `4.4u`, combo `5.2u`, mult `1.9u`, kcal `2u`, top heroes `1u`):
- `.digits span { width: 0.62em }` unchanged.
- Keep `letter-spacing: 0.02em` on big numerals (score, combo, results); drop to `0` at ≤ 1u (Top Heroes, setlist BPM) so the small sizes don't gap.
- The combo and countdown keep their `-webkit-text-stroke` outline; Chakra's straight strokes take it better than Pixelify did, so the stroke can go from `0.35u` to `0.3u`.
- Units (`kcal`, `BPM`) and times (`1:44`) stay in JetBrains Mono as today; only the digits of score/combo/stats/ranks/multiplier/countdown switch.
- The dimmed leading zeros (`.digits .z`) stay; they look even better with Chakra's narrow 0.

If Rubik Mono One is preferred instead: `font: 400 calc(<size> * 0.84) 'Rubik Mono One'`, `letter-spacing: -0.02em`, `.digits span { width: 0.98em }`, and widen `.playing .score` from `22u` to `27u`.
