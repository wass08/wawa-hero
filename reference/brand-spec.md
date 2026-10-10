# Brand spec — webcam rhythm game (derived from `image.png` key art)

**One line:** a voxel night concert — deep indigo stage, LED-wall glow, and three saturated "move" colours that do all the functional work.

## Tokens (OKLch)

| Token | Value | Use |
|---|---|---|
| `--bg` | `oklch(0.16 0.07 285)` | venue night, HUD panel base |
| `--surface` | `oklch(0.22 0.07 290)` | raised panels, stage deck |
| `--fg` | `oklch(0.97 0.01 280)` | primary HUD text |
| `--muted` | `oklch(0.78 0.05 285)` | labels (SCORE, COMBO) |
| `--border` | `oklch(0.42 0.10 290)` | panel inner rule |
| `--accent` | `oklch(0.70 0.25 345)` | hot magenta stage light (doubles as the Clap lane) |

Functional move palette (never decorative):

| Move | Token | Value | Pictogram |
|---|---|---|---|
| Arms up (elbows 90°) | `--up` | `oklch(0.84 0.14 205)` cyan | goal-post up |
| Arms down (elbows 90°) | `--down` | `oklch(0.86 0.17 88)` amber | goal-post down |
| Clap | `--clap` | `oklch(0.70 0.25 345)` magenta | pressed palms |

Judgement: `--perfect oklch(0.90 0.20 135)` · `--good oklch(0.86 0.09 250)` · `--miss oklch(0.68 0.22 28)`.

## Type

- Display: `'Pixelify Sans', 'Silkscreen', ui-monospace, monospace` — scores, combo, judgements, move labels
- Body: `'Rubik', system-ui, sans-serif` — small labels, hints, tracking status
- Mono: `'JetBrains Mono', ui-monospace, monospace` — timings, BPM

## Observed rules

1. Everything is built from cubes — pixel pictograms, stepped panel corners, LED-dot wall. No smooth illustration.
2. Colour = move. A move always appears in the same lane position, colour and pictogram (never colour alone).
3. Light comes from the stage (beams, LED wall, glow strips); HUD panels are dark glass so they never compete with it.
4. Sized for 2 m: key HUD numerals ≥ 4u, move labels ≥ 1.3u where `1u = 1%` of a 16:9 frame.
