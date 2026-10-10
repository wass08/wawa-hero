# Wawa Hero — webcam dance rhythm game

On-screen name/wordmark: **WAWA HERO** (never "Block Party").
Typography: Chakra Petch only (see src/styles/hud.css tokens)

Three.js voxel concert stage + MediaPipe pose tracking. The player stands ~2 m from the
laptop and performs arm moves on cue. Score + calories burnt.

Design references live in `reference/` (read them, they are the visual source of truth):
- `reference/brand-spec.md` — tokens, type, rules
- `reference/rhythm-core.js` — voxel stage engine (stage, LED wall, avatar, crowd, beams, confetti, jumbotron webcam shader)
- `reference/song-select.html` — title → song select → difficulty → countdown, all on the same 3D stage, camera moves between states, menus navigated with moves
- `reference/gameplay-b-cue-rail-v2.html` — THE chosen gameplay HUD: horizontal cue rail at the bottom, hit ring at 14%, score panel top-right, song panel top-left, combo above ring, jumbotron = player's webcam as posterized LED feed
- `reference/hud.css`, `reference/image.png` (key art)

Stack: Vite + vanilla JS ES modules + three@0.186 + @mediapipe/tasks-vision. No framework.
Fonts from Google Fonts as in the references.

## File ownership (parallel workers — do not edit files you don't own)

| Area | Owner | Paths |
|---|---|---|
| Game app (engine, HUD, menus, audio, chart loading, keyboard input, results) | **Codex** | `index.html`, `src/**` except `src/pose/**`, `vite.config.js` |
| Pose tracking, move scoring/judging, calories | **Pose agent** | `src/pose/**`, `tests/pose/**`, `public/models/**`, `public/mediapipe/**` |
| Chart generation + song catalog | **Chart agent** | `tools/**`, `tests/chart/**`, `public/songs/**` (except `audio.mp3`, `cover.jpg`) |

`package.json` is shared: only add dependencies if essential and mention it in your report.

## Moves (ids are fixed)

"Left"/"right" always mean the **player's anatomical** left/right. Everything the player sees
(webcam feed, avatar, pictograms) is **mirrored**, so the player's left arm appears on the
**screen-left**. MediaPipe landmark 11/13/15 = person's left shoulder/elbow/wrist; 12/14/16 = right.

| id | Name (label) | Definition | Kind | Colour token |
|---|---|---|---|---|
| `up` | ARMS UP | both upper arms ~horizontal (elbow ≈ shoulder height), forearms vertical pointing up (goal post) | tap | `--up` oklch(0.84 0.14 205) cyan |
| `down` | ARMS DOWN | both upper arms ~horizontal, forearms vertical pointing down | tap | `--down` oklch(0.86 0.17 88) amber |
| `clap` | CLAP | wrists come together in front of chest (wrist distance < ~0.6 shoulder widths) | tap | `--clap` oklch(0.70 0.25 345) magenta |
| `split_lu` | LEFT UP | goal-post with LEFT forearm up, RIGHT forearm down | tap | `--split-lu` oklch(0.80 0.15 165) teal |
| `split_ld` | LEFT DOWN | goal-post with LEFT forearm down, RIGHT forearm up | tap | `--split-ld` oklch(0.78 0.16 55) orange |
| `sweep` | SWEEP | straight arms overhead, sweep down OUT TO THE SIDES (frontal plane, like half a jumping jack) to the hips over `dur` seconds | **hold** (has `dur`) | `--sweep` oklch(0.82 0.11 300) lavender |

Pictograms: 13×11 pixel grids like `ICONS` in `reference/rhythm-core.js` (screen-space, mirrored —
`split_lu` shows the arm on the screen-LEFT raised). Sweep cue on the rail is a long bar of
length `dur` with the icon at its head. Colour never carries meaning alone: icon + label too.

## Data contracts

### `public/songs/index.json`
```json
{ "songs": [ {
  "id": "system-online", "title": "System Online", "artist": "…",
  "audio": "songs/system-online/audio.mp3", "cover": "songs/system-online/cover.jpg",
  "bpm": 120.0, "duration": 183.5, "energy": 2,
  "moves": ["up","down","clap","split_lu","split_ld","sweep"],
  "preview": { "start": 51.7, "dur": 15.2 },   // loop played on song select (fade in/out), bar-aligned, most recognisable part (chorus)
  "charts": { "easy": "songs/system-online/charts/easy.json",
              "normal": "songs/system-online/charts/normal.json" }
} ] }
```
Paths are relative to the site root (`import.meta.env.BASE_URL`).

### Chart JSON (`charts/<difficulty>.json`)
```json
{
  "version": 1, "songId": "system-online", "difficulty": "normal",
  "bpm": 120.0, "offset": 0.512,          // seconds of first downbeat in the audio file
  "beats": [0.512, 1.012, ...],           // optional detected beat times (for rail ticks); else derive from bpm+offset
  "downbeats": [0.512, 2.512, ...],       // optional
  "notes": [ { "t": 12.345, "move": "up" },
             { "t": 40.0, "move": "sweep", "dur": 1.5 } ],  // t = seconds in audio file, sorted ascending
  "camera": [ { "t": 0, "shot": "wide", "ease": 0 },        // show-camera cues, sorted ascending (optional)
              { "t": 21.24, "shot": "front", "ease": 1.9 },
              { "t": 51.7, "shot": "low_left", "ease": 0 } ]
}
```

#### Camera shots (`camera[].shot`)
A cue switches the 3D camera to a preset at time `t`; `ease` = transition seconds (0 = hard cut on the
beat, typically 0.5–2 s glide). Every shot has a gentle built-in motion (drift/dolly/orbit) so it never
looks static, and every shot must keep the jumbotron (player camera feed) readable; HUD stays an overlay.
Fixed preset ids (implemented by the app in one presets table, tunable there):

| shot | description |
|---|---|
| `front` | default gameplay framing (cue-rail-v2 camera), slow breathing dolly |
| `wide` | far back, whole stage + crowd + beams, slow drift |
| `close` | pushed in on the jumbotron + avatar, slight handheld sway |
| `low_left` / `low_right` | crowd-eye level from the front corners, looking up at the stage |
| `high` | crane shot from above the crowd, looking down |
| `orbit` | slow arc around the stage across the shot duration |
| `drop` | fast push-in synced to the beat (for drops / chorus hits) |

Charts for one song share the same camera track. Generator places cues on section boundaries and every
4–8 bars inside long sections (on downbeats); cuts on high-energy entries, glides in calm parts; no cue
changes faster than every 2 bars. Overrides can pin cues.

### Pose module API (`src/pose/index.js`) — implemented by the Pose agent, consumed by Codex

```js
// Starts MediaPipe PoseLandmarker on an already-playing <video> (webcam stream owned by the game).
export async function createPoseTracker({ video, onStatus }) // onStatus('loading'|'ready'|'error', detail)
  → { update(nowMs) : PoseFrame|null,   // call once per rAF; returns latest frame (null until first result)
      close() }

// PoseFrame
{
  t,                    // performance.now() ms timestamp of the camera frame that was analysed
  tracked,              // a person is detected
  upperBody, fullBody,  // visibility of shoulders+elbows+wrists / plus hips+knees+ankles
  landmarks,            // 33 × {x,y,z,visibility}, normalized, ALREADY MIRRORED (x' = 1 - x), or null
  arms: { left:  { shoulder:[x,y], elbow:[x,y], wrist:[x,y] },   // mirrored normalized image coords
          right: { … } },
  scores: { up, down, clap, split_lu, split_ld, overhead, low },  // 0..1 static-pose confidences
                                                                   // overhead/low = straight-arms-above-head / arms-at-hips (sweep ends)
  armAngle: { left, right },       // radians, shoulder→wrist vs torso-down: 0 = arm hanging, π = straight overhead
  elbowStraight: { left, right },  // 0..1
  energy,               // movement intensity, smoothed: ~0 still, ~0.5 dancing, ~1 vigorous
}

// Keyboard/debug input produces the same shape so there is ONE judging path:
export function createSyntheticPose()   // → { press(move), release(move), update(nowMs): PoseFrame }
//   keys 1..6 = up, down, clap, split_lu, split_ld, sweep (held key → sweep follows the ideal arc)

// Judge: consumes frames + notes, returns resolved judgements. Pure logic, unit-tested.
export function createJudge({ perfect = 0.15, good = 0.30, latency = 0 })
  → { update(frame, songTime, notes) : Judgement[],  // songTime = song time (s) at frame.t; notes = chart notes (mutable objects, judge may set fields like n.judged)
      reset() }
// Judgement: { note, result: 'perfect'|'good'|'miss', off /*s, - early + late*/, progress? /*sweep 0..1*/ }
// Tap notes: hit when the pose's confidence crosses threshold within the window; off = onset time - note.t.
// Holding a pose through the whole window counts as 'good' (no free perfects for statues).
// Sweep: must start near overhead at ~note.t, track the ideal arc down to low by note.t+dur with straight elbows;
//   resolved at note.t + dur (+grace); result from tracking accuracy; emits progress while active
//   (Judgement objects with result null + progress, for HUD feedback — Codex should handle result==null as "in progress").

// Calories (MET model driven by measured movement energy). Pure, unit-tested.
export function createCalorieMeter({ weightKg = 70 })
  → { update(dtSec, energy) : kcalTotal, get kcal(), reset() }
```

## Gameplay rules (Codex)
- Audio: Web Audio (`AudioContext` + `decodeAudioData` + `AudioBufferSourceNode`). Song clock from
  `ctx.currentTime` (minus `outputLatency`), NOT from rAF accumulation. Provide `perfToSongTime(ms)` so pose
  frames (timestamped in performance.now ms) map to song time. User calibration offset (ms) in settings.
- Scoring like the reference: perfect 100 / good 50 × multiplier (combo/8, max ×4); sweep = 300 × accuracy × mult.
  Stars at 25/50/75 % of max. Crowd meter (hype).
- Calories panel (kcal, live) next to/inside the score panel; results screen shows score, stars, max combo,
  perfect/good/miss counts, kcal, duration. Best score + weight stored in localStorage.
- Jumbotron shows the webcam as the shaded LED feed (reference shader). Add a subtle pose-skeleton overlay
  on the jumbotron (voxel dots on joints) when tracked.
- Avatar mirrors the player's arms live from `PoseFrame.arms` when tracking; otherwise performs cued moves.
- Menus navigated with moves: `split_lu` (LEFT UP) = previous, `split_ld` (RIGHT UP / left down) = next, `clap` = choose/confirm + keyboard + mouse. Countdown cancel = `split_lu`.
  Title screen gates on pose `upperBody` visible (real check, replacing the reference's simulated checklist).
- Two difficulties only: chart ids `easy` / `normal`, displayed as **"Warm-up"** / **"Showtime"**.
- Keyboard fallback is always available (keys 1–6, also ↑ ↓ Space for up/down/clap) via `createSyntheticPose`.
- Pause with Esc / P. Works without a camera (avatar cam fallback, keyboard play).

---

# Round 3 additions (2026-10-10)

## Ownership update
| Area | Owner | Paths |
|---|---|---|
| Game app | **Codex** | `index.html`, `src/**` except `src/pose/**` and `src/net/**`, `vite.config.js` |
| Pose / judge / calories | **Pose agent** | `src/pose/**`, `tests/pose/**`, `pose-debug.html`, `public/models/**`, `public/mediapipe/**` |
| Scoreboard backend + client data layer | **Backend agent** | `supabase/**`, `src/net/**`, `tests/net/**` |
| Charts | **Chart agent** | `tools/**`, `tests/chart/**`, `public/songs/**` |

## Calibration removed
No calibration UI or setting. Judge latency stays at its internal default.

## Sweep redesign (pose + judge + app)
The sweep was hard to understand and hard to detect, partly because hands leave the frame at the top.
New definition: **arms raised high, then lowered OUT TO THE SIDES down to hanging, passing through a T at shoulder height.**
- Detection uses **shoulders + elbows only** (the upper-arm angle shoulder→elbow vs torso-down: ~0 hanging, ~π/2 T, ≥ ~2.2 rad high). Wrists are optional and may leave the frame. Forearm/elbow straightness is NOT required.
- Judging is **phase-based and lenient**: HIGH (at the start, within ±good of note.t) → passes through T → LOW by note.t+dur (+0.4 s grace), descending on the player's own side (signed angle, no crossing the midline). Perfect = all phases in order and the T crossing within ±25% of mid-duration; good = all phases in order but with loose timing, or LOW reached late within the grace; miss = never HIGH, never LOW, or wrong direction. `progress` = descent fraction 0..1 for the HUD.
- The app explains it better: animated rail pictogram (3-frame loop high→T→down), a live arc gauge while a sweep is active, and the moves tutorial (below).
- PoseFrame adds `upperArmAngle: {left, right}` (signed, radians) and `elbowVis: {left, right}`.

## Two-player local versus
- The tracker supports `maxPlayers` 1 or 2: `createPoseTracker({ video, onStatus, maxPlayers = 1 })` →
  `{ update(nowMs) → PoseFrame|null (P1), updateAll(nowMs) → [PoseFrame|null, PoseFrame|null], setMaxPlayers(n), close() }`.
- **P1 = the person on screen-LEFT** (mirrored view) and P2 = screen-RIGHT. Identity is sticky (nearest-centroid tracking with hysteresis): no swapping on jitter, re-acquire when someone steps back in. With only one person visible in 2P mode they keep their slot.
- Each PoseFrame gets `player: 0|1`; `source` is `camera:0` / `camera:1` / `synthetic:0` / `synthetic:1`.
- Each player has their own `createJudge()`, `createCalorieMeter()`, score, combo and stars. They share one chart and one cue rail.
- Keyboard: P1 = 1–6 (plus ↑ ↓ Space); P2 = 7 8 9 0 - = (up, down, clap, split_lu, split_ld, sweep). `createSyntheticPose({ player })`.
- Results: both players' stats, winner banner (tie possible); each player saves their own scoreboard entry (mode `versus`, `versus_rank` 1|2).
- Colours: P1 accent = `--up` cyan, P2 accent = `--clap` magenta (panels, avatar pad, judgement side).

## Hero shots
- During play the app captures candidate frames of the **shaded jumbotron feed** (the posterized LED look, no HUD) into an offscreen canvas of 640×360 (16:9) → `canvas.toBlob('image/webp', 0.8)` (target < 60 KB each).
- Moments: perfect hits during high-energy sections, chorus commands, sweep completions, max-combo milestones. At most one candidate per 2 bars. At the end keep the **best 4**, spread ≥ 15 s apart. Subtle shutter flash plus a non-melodic shutter SFX when a shot is taken.
- Captured with the avatar cam too (fun), but the scoreboard upload of photos is only offered when shots came from the real camera.

## Save flow (results screen)
For each player: name (≤16 chars, prefilled from localStorage), country picker (prefilled with `guessCountry()`), a hero-shot grid (toggle each shot), and three choices: **Post score + photos** (requires a consent checkbox: "I'm OK with these photos appearing on the public wall"), **Post score only**, or **Don't post**. A **Download** button saves a branded photo strip (4 shots + WAWA HERO + name + flag + score + kcal + date) as WebP, plus the individual shots. Must work fully offline (download yes, posting disabled with a note).

## Home: wall of players + scoreboard
The title screen gets a **Hall of Fame** panel (top 10 for the highlighted song/difficulty: rank, flag, name, score, kcal, stars) and a **wall of players**: recent shared hero shots as polaroid-style tiles (name + flag + score) cycling on the stage (e.g. the side LED panels or a gallery wall in the 3D scene, and/or a HUD mosaic), without hiding the title UI or the jumbotron. Degrades gracefully when offline or when the scoreboard is not configured.

## Moves tutorial
"How to play" screen (from the title and song select, auto-shown before the first song ever): the avatar demonstrates each of the 6 moves in a loop with its pictogram, name and a one-line instruction. With the camera live, show a ✓ when the player performs it (from frame scores; for the sweep, from the sweep judge in practice mode). Navigable with moves/keyboard/mouse.

## Scoreboard data (Supabase, self-hosted at VITE_SUPABASE_URL)
Table `public.wawa_hero_scores` (all objects prefixed `wawa_hero_`; storage bucket `wawa-hero`):
`id uuid pk, created_at timestamptz, song_id text, difficulty text (easy|normal), mode text (solo|versus), versus_rank smallint null,
player_name text (1–16), country char(2) null, score int, stars smallint, max_combo int, perfect int, good int, miss int,
kcal numeric(6,1), duration_s int, shots text[] (≤4 storage paths), share_shots boolean, hidden boolean default false, client_version text`.
Anon: insert (validated by CHECK constraints + RLS) and select where `hidden = false` (shots only exposed when `share_shots`). No update/delete for anon.
Storage: public-read bucket `wawa-hero`; anon may upload only `shots/<uuid>.webp`, image/webp, ≤ 200 KB, with no overwrite.

Client module `src/net/scoreboard.js` (fetch-based, no supabase-js):
```js
export const scoreboardEnabled            // env vars present
export async function submitScore(entry, shotBlobs = [])  // uploads shots (if entry.share_shots) then inserts → { id, shots }
export async function fetchLeaderboard({ songId, difficulty, limit = 10 })  // best entries, not hidden
export async function fetchWall({ limit = 24 })            // recent rows with share_shots && shots.length
export function shotUrl(path)                               // public URL
```
`src/net/countries.js`: `COUNTRIES` ([{code, name}], ISO 3166-1 alpha-2), `guessCountry()` (navigator.languages region → Intl timezone fallback → null), `flagEmoji(code)`.

## Photo cues ("strike a pose") — round 3b
- New chart note kind: `{ "t": 66.6, "move": "photo" }`, a free pose with no judging. The player does whatever they want.
- Each chart has exactly **4 photo cues** (all difficulties share the same times), placed at fun moments (e.g. end of chorus 1 "Overload", bridge, the drop, the outro). Each needs ≥ 2 beats free of other notes before and ≥ 1 beat after, so arms are free. The first is not before ~30 s; they're spread across the song.
- App: the cue scrolls on the rail like a move (camera pictogram, label "PHOTO!", white/fg colour with a flash-bulb accent). From ~1.5 s before, the jumbotron shows "STRIKE A POSE!" + 3-2-1 dots on the beat, then at `t` a flash + non-melodic shutter SFX + a brief freeze-frame tilt "polaroid" pop of the captured shot. No score impact, no combo break, no miss. Optional tiny "SNAP!" pop.
- The shot taken at each photo cue IS that run's hero shot (capture the shaded jumbotron feed at exactly `t`, 640×360 WebP). The automatic "best moments" capture is only a fallback for charts without photo cues (top up to 4).
- In 2P one photo has both players in it.
- Not counted in note totals, max score, accuracy or the perfect/good/miss stats.

---

# Round 4: UX polish (2026-10-10) — supersedes earlier sections where they conflict

## One chart per song (no difficulty)
- Difficulty selection is removed from the game. Each song has ONE chart: `public/songs/<id>/chart.json` (same format; `"difficulty"` field dropped or "default").
- index.json: `"chart": "songs/<id>/chart.json"` replaces `"charts"`. The song's `energy` pips (1–3) communicate difficulty in song select.
- System Online's chart = the former normal ("Showtime") chart, with the double clap fix below.
- Scoreboard: the app sends `difficulty: "normal"` for every entry (the DB constraint stays as is); the leaderboard is per song.
- Flow: `title → songs → count → play → results → songs`. No level screen.

## Double clap on the vocal
"Clap. Clap." is sung half a beat apart (~0.24 s). The chart places both claps ON the vocal. Clap→clap pairs at ≥ half a beat are allowed (the judge supports them); the 0.4 s rule still applies to every other pair.

## Easier splits + sweep (pose)
LEFT UP / RIGHT UP feel too strict, and the sweep is still hard to land. Loosen tolerances without creating confusions between moves (tests must prove no cross-talk). Allow one arm with low visibility during the sweep if the other arm is clear. Add a recorder to pose-debug.html (record N seconds of landmarks + scores → download JSON) so real failing attempts can be captured and turned into regression tests.

## Screens
- **Title** (minimal): WAWA HERO wordmark; two big choices **1 PLAYER** (LEFT UP) / **2 PLAYERS** (RIGHT UP), then **CLAP** to start (mouse click works too); the "Get ready" body check stays as a small status. A light **Wall of Heroes** (a few recent shared hero shots, e.g. 3–4 tiles, hidden when empty). **No Hall of Fame / leaderboard** on the title. A small, unobtrusive "How to play" link (the tutorial still auto-shows before the first song ever). No "Play with keyboard" button.
- **Song select**: the song list + selected song detail + preview loop. Legend = LEFT UP previous / RIGHT UP next / CLAP choose, plus a visible **Back** button to the title (mouse/Esc; with moves, a held LEFT UP for ~1.2 s with a fill indicator). No mode toggle, no how-to-play, **no settings panel** (body weight, music/SFX volume and the preview indicator are gone; defaults: 70 kg, music 80%, SFX 70%), no difficulty.
- **Camera status panel** ("Big screen: your camera …") removed. Only show a camera prompt when the camera is NOT live (requesting/blocked/unavailable), e.g. a centred "Allow camera to play" card with a retry button.
- **No keyboard hints anywhere in the UI** ("Keys 1–6…", the bottom key line, the "Autoplay demo · keys" chip). Keyboard keys keep working silently as a dev shortcut; autoplay stays behind `?autoplay`.
- Overall: fewer panels and less text. It shouldn't feel overwhelming.
