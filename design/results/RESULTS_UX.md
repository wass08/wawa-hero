# Results screen · redesign spec

Mocks: `mock-1p.html/.png`, `mock-2p.html/.png`, `mock-states.html/.png` (shared `mock.css`, real tokens from `src/styles/hud.css`).

## 1. Principle

One panel, two zones, one decision.

- **Score zone** (top): display type, readable from 2 m. Nothing interactive.
- **Save zone** (bottom): desktop-size form. Exactly one decision for the player: *save with photos / save score only / don't save*. Download is a side action, never part of the decision.
- In 2P there is **one** save zone and **one** set of buttons for both players (one click posts two entries). Only the name/country fields are per player; the photos are shared, so they are shown once.
- No checkbox. Picking **Save with photos** *is* the consent; the sentence under the buttons says exactly what it does.

## 2. Layout

Panel: `.panel` dark glass, centred, 1240 px wide (1P) / 1300 px (2P) at 1600×900 (in `u`: 77u / 81u). Rows, top to bottom:

| Row | 1P | 2P |
|---|---|---|
| Kicker | `SET COMPLETE · <SONG>` left, `1:44 · 108 BPM` mono right | same |
| Banner | — | `PLAYER 1 WINS!` / `PLAYER 2 WINS!` in the winner's colour, 6u, text-stroke; tie: `IT'S A TIE!` in `--fg` |
| Score | Score 10u left (+ `NEW BEST` chip in `--perfect`), 3 stars 3.8u beneath. Stat row right-aligned: MAX COMBO · PERFECT · GOOD · MISS · BURNED (kcal) | Two columns (P1 cyan, P2 magenta): `■ PLAYER n` label, score 8u, stars, stat row (same stats, 2.9u numerals) |
| Rule | 2 px `--border` | same |
| Identity | Hero name (1.15fr) + Country (1fr), max 720 px | Two columns: P1 fields (cyan focus) / P2 fields (magenta focus) |
| Photos | `YOUR 4 PHOTOS · Click one to leave it out`, 4 thumbs 16:9, numbered, timestamp | label `YOUR 4 PHOTOS · BOTH PLAYERS`, same row, shared |
| Actions | `[Save with photos] [Save score only] …… [↓ Download all] Don't save` | same, one row for both players |
| Consent line | 13 px body, globe icon | same, starts with "Saves both players." |

Time is dropped from the stat row (it's the song length, already in the kicker). Judgement numerals use `--perfect/--good/--miss` so the row reads at a glance.

## 3. Controls (complete list)

| Control | Type | Label / state |
|---|---|---|
| Hero name (×players) | text, `maxlength=16`, `autocomplete=nickname`, counter `9/16` | label `HERO NAME` (`P1 HERO NAME` in 2P), small `up to 16 letters`; placeholder `Your hero name` |
| Country (×players) | combobox (see §5) | label `COUNTRY`, small `optional` |
| Photo thumb ×4 | toggle button (`aria-pressed`), shared in 2P | in: solid `--fg` border, `n` badge, time; out: dashed border, greyed, `LEFT OUT / click to put it back` |
| **Save with photos** | primary `.btn` (white, Pixelify) | see states |
| Save score only | ghost | |
| Download all | ghost with ↓ icon, right side | always enabled when there is ≥1 photo (even offline, even Safari) |
| Don't save | text link, far right | leaves immediately → song select. No confirmation. |

That's it. 8 controls in 1P, 10 in 2P (before: 15 per player + Back = 31 in 2P).

### Button rules
- Primary and secondary stay in the same two slots in every state; only the label changes (`Saving…`, `Retry in 42 s`, `Try again`, `Save score`, `Continue`). Nothing jumps.
- If all 4 photos are left out, the primary becomes `Save score` and `Save score only` is hidden (they'd be identical).
- When photos can't be posted (Safari/no WebP, avatar-cam run), same thing: primary `Save score`, no secondary, thumbs get a small `PNG` / `AVATAR` corner tag.

## 4. Copy

| Where | Text |
|---|---|
| Kicker | `SET COMPLETE · SHOWTIME` |
| New best chip | `NEW BEST` |
| Banner 2P | `PLAYER 1 WINS!` · `PLAYER 2 WINS!` · `IT'S A TIE!` |
| Stat labels | `MAX COMBO` (`COMBO` in 2P) · `PERFECT` · `GOOD` · `MISS` · `BURNED` + `kcal` |
| Name label / placeholder | `HERO NAME` + `up to 16 letters` / `Your hero name` |
| Country label / placeholder | `COUNTRY` + `optional` / `Pick a country` |
| Photos | `YOUR 4 PHOTOS` (`· BOTH PLAYERS`) · hint `Click one to leave it out` · out-state `LEFT OUT` / `click to put it back` · hover `Leave out` |
| Consent 1P | **Save with photos** puts these 4 photos on the public Wall of Heroes with your name, flag and score. **Save score only** keeps them on this laptop. |
| Consent 2P | Saves both players. **Save with photos** puts the 3 kept photos on the public Wall of Heroes with your names, flags and scores. **Save score only** keeps them on this laptop. (count follows the kept photos) |
| Buttons | `Save with photos` · `Save score only` · `Save score` · `Download all` · `Don't save` · `Continue` |
| Empty name (on press) | `Add a hero name to save.` (field goes `--miss`, focused) · 2P status `P2 not saved (no name).` |
| Saving | `Saving…` + `Uploading 4 photos…`; 2P `Saving P1…` → `Saving P2…` |
| Saved | `Saved! Your photos are on the Wall of Heroes.` / `Saved! Photos stayed on this laptop.` |
| Rank chip | `#4 on Showtime · PIXEL KAI` (player colour) · outside top 100: `Top 100? Not yet` (neutral) · rank fetch failed: `Saved · rank unavailable` |
| Offline | `You're offline, so the score can't be saved. Download keeps your photos.` |
| No WebP | `This browser can't share photos yet (Safari has no WebP). They're in your download as PNG.` |
| Avatar cam | `Avatar-cam photos stay on this laptop.` |
| Rate limited | `Whoa, too many saves from this connection. Hang on, nothing is lost.` + primary `Retry in 42 s` |
| Failed | `Couldn't save. Your photos are still here.` + primary `Try again` |
| Partial | `Score saved, 2 of 4 photos didn't upload. They're in your download.` |
| Download done | `Downloaded wawa-hero-showtime-2026-10-10.zip` (brief, then fades) |

## 5. Name and country

- **Name**: empty with placeholder; prefilled with the last name used on this device for that slot. Storage: `wh.hero.p1` / `wh.hero.p2` = `{ name, country, at }`. Written on every successful save *and* on "Don't save"/Continue if the field was edited (so a typo-fix sticks). Never prefill `Player 1`. Trim, collapse spaces, 1–16 chars.
- **Country**: prefill order = last used for that slot → `guessCountry()` → empty (`Pick a country`). Optional; saved as `null` when empty.
- Both players may share the laptop: in 2P each slot keeps its own memory, so a regular duo sees both names again.

### Country combobox
- A field that looks like the name input: flag badge + country name + chevron. Click or any typing opens the list; the field becomes the filter (`br` → list filters as you type, matches highlighted in the player colour, name *and* code match: `jp`, `japan`, `uk`, `united k`).
- Listbox: `SUGGESTED` group first (device guess, last used, then the 12 most common: US GB FR DE JP BR ES IT CA AU KR MX), then `ALL COUNTRIES` alphabetical. Each row: flag badge · name · code (mono, right). Footer: `↑↓ move · Enter pick · Esc close`. Max 7 rows visible, scrolls.
- Keyboard: `↑/↓` move, `Enter` pick, `Esc` closes and restores the previous value, `Backspace` on a picked value clears to the filter, `Tab` picks the highlighted row and moves on. Mouse: hover highlights, click picks. ARIA: `role=combobox aria-expanded aria-controls`, list `role=listbox`, rows `role=option aria-selected`.
- Flags: use `flagSvg()` everywhere (combobox, listbox, strip, wall), **not emoji**, so it's identical on Windows/macOS. Restyle the badge to the brand: 4:3, 2 px stepped corners (no `rx`), Rubik 700 letters, OKLch tint from the code (`oklch(0.45 0.12 <hue>)`), 1 px inner white line. A consistent monogram badge looks designed; emoji-on-some-platforms looks broken. (Real flag art would need an asset pack; not now.)

## 6. Photo selection

- Keep a single implicit control: **click a thumbnail to leave it out** (toggle). No checkboxes, no per-photo download links, no "select all". Default: all in.
- Why keep it at all: a bystander walking into the frame is the one real reason not to share a shot, and consent is per photo. One tap, zero chrome.
- 2P: one shared set, one toggle state. Either player can leave one out; it applies to both posts (same photo, same consent problem).
- Left-out photos are **still in the download** (the download is yours; "leave out" is about the public wall). The consent sentence counts kept photos (`the 3 kept photos`).
- Thumbs show `n` badge top-left and the cue time bottom-right (matches the "PHOTO!" moments). Out state: dashed `--border`, grey 22 % image, `LEFT OUT / click to put it back`.

## 7. Download

**One button, one file: a zip.** `wawa-hero-<song-slug>-<yyyy-mm-dd>.zip` containing:
- `strip-p1.webp` (and `strip-p2.webp` in 2P) — the branded strip, per player (name/flag/score differ)
- `shot-1.webp … shot-4.webp` — all 4 originals (`.png` on Safari), including left-out ones

Why a zip and not 5 downloads: browsers block or prompt on multiple programmatic downloads (Safari asks per file, Chrome shows the "download multiple files" permission), the strip-only option throws away the clean 16:9 originals, and a combined image needs a second encode step we already struggle with on Safari. A STORE-only zip writer is ~40 lines (local headers + central directory + CRC32 table), no dependency, no compression needed since WebP/PNG are already compressed. In 2P the zip is shared, so the button is also shared (one download for the laptop, not two).

Always enabled when there is at least one photo, in every state except `Saving`. Never blocked by offline or Safari. After click: status `Downloaded wawa-hero-showtime-2026-10-10.zip`.

## 8. States and flow

Only the primary/secondary labels and the status line change; slots are fixed (see `mock-states.png`).

| State | Primary | Secondary | Download | Don't save | Status |
|---|---|---|---|---|---|
| Ready | `Save with photos` | `Save score only` | on | on | consent sentence |
| No name (on press) | unchanged, field errors & focuses | | on | on | `Add a hero name to save.` |
| Saving | `Saving…` (spinner, busy tint) | disabled | disabled | disabled | `Uploading 4 photos…` / `Saving P1…` |
| Saved | `Continue` (`--perfect`) | hidden | on | hidden | rank chips + `Saved! …` |
| Offline | `Download all` (promoted to primary) | `Continue` | — | hidden | offline text (`--down`); on `online` event the Ready row returns automatically |
| No WebP / avatar cam | `Save score` | hidden | on | on | browser/avatar text; thumbs tagged `PNG`/`AVATAR` |
| Rate limited | `Retry in 42 s` disabled, counts down, then back to `Save with photos` | disabled | on | on | `Whoa, too many saves…` |
| Failed | `Try again` | `Save score only` | on | on | `Couldn't save…` (`--miss`) |
| Partial (score ok, some photos failed) | `Continue` | hidden | on | hidden | partial text, rank chip shown |

2P specifics: one click = two sequential posts (P1 then P2). If P1 succeeds and P2 is rate-limited, P1 gets its rank chip at once and the countdown retries P2 only; `Continue` appears once both are done (or the player gives up via `Don't save`, which becomes `Continue` as soon as anything was saved). A player with an empty name is skipped, not blocked: status `P2 not saved (no name).` and only the saved player's rank appears. The primary is blocked only when *both* names are empty.

After **Saved**: the rank chips sit where the consent line was (`#4 on Showtime · PIXEL KAI`, coloured per player), the row becomes `[→ Continue] …… [↓ Download all]`. `Continue` → song select. Auto-continue after 20 s of no input (the laptop is 2 m away for the next players), with a thin countdown line under `Continue`.

**Don't save** → remembers edited names, goes straight to song select. No "are you sure".

## 9. Keyboard and moves

- `Enter` anywhere in the form = primary (in the name field too; in the country list it picks first, then a second `Enter` saves).
- `Esc` = `Don't save` (before saving) / `Continue` (after). Inside the open listbox, `Esc` only closes the list.
- `Tab` order: P1 name → P1 country → (P2 name → P2 country) → photos 1–4 → Save with photos → Save score only → Download all → Don't save.
- `⌘/Ctrl+S` = Download all (prevents the browser save dialog, which is what people hit by reflex).
- Moves (for whoever is still on stage): **CLAP** = primary (`Save with photos`, or `Continue` after saving); **LEFT UP held 1.2 s with the fill ring** = `Don't save`/`Continue` (same gesture as Back in song select). No move for the secondary: it's a form choice, you're at the laptop. Move input is ignored while a text field has focus with a non-empty draft.
- No key hints in the UI (Round 4 rule); the listbox footer is the only exception because it's a desktop widget.

## 10. Before → after

| Removed | Replaced by |
|---|---|
| `Player 1` / `Player 2` prefill | empty + placeholder, last name on this device |
| `datalist` country search with emoji | combobox with SVG badges, suggested group, keyboard nav |
| 4 × `↓ Save shot` links per player | one `Download all` (zip) |
| `Download` per player (2P: 2 buttons) | one shared `Download all` |
| consent checkbox `I'm OK with these photos appearing on the public wall` | the choice itself + one sentence under the buttons |
| `Post score + photos` / `Post score only` / `Don't post` per player (2P: 6 buttons) | `Save with photos` / `Save score only` / `Don't save`, once for everyone |
| `Back to songs` button at the bottom | `Don't save` (before) / `Continue` (after) |
| `Choose photos to share · Download keeps all your shots` + `format-note` + `post-status` + `result-rank` (4 text lines per player) | one status line + rank chips |
| `Time` stat | kicker `1:44 · 108 BPM` |
| Per-player photo grids (2P showed the same 4 photos twice) | one shared row |
| `WAWA HERO · SET COMPLETE` + song title + banner stacked (3 header lines) | one kicker line + banner (2P only) |

Control count: 2P 31 → 10, 1P 15 → 8.
