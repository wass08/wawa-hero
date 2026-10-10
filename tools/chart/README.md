# Chart tools

## Import a song

```sh
uv run tools/chart/make_chart.py ~/Music/my-song.mp3 --id my-song        # [--title T] [--artist A] [--difficulty easy|hard]
uv run tools/chart/make_chart.py public/songs/system-online/audio.mp3 --id system-online   # re-generate
uv run --with pytest --with numpy pytest -q tests/chart                   # validate every chart
```

Requirements: `uv`, `ffmpeg`/`ffprobe`. Python dependencies (librosa, numpy, scipy, soundfile) are
declared inline (PEP 723), so `uv run` builds the env. The script only imports stdlib and those packages,
so `python -I` works too: `uv run --with librosa --with soundfile python -I tools/chart/make_chart.py …`.

What it does:

1. Copies the mp3 to `public/songs/<id>/audio.mp3` (refuses to replace a different existing file without
   `--force`). If there's no `cover.jpg`, it extracts the embedded art, or writes a placeholder if the file
   has none. The title comes from the tags (ffprobe). The artist is never copied from the tags (Suno writes the account
   name there). index.json only gets an `"artist"` when you pass `--artist` or set `"artist"` in overrides.json. An existing `audio.mp3`/`cover.jpg` is never rewritten.
2. Analysis (decoded through ffmpeg, the same gapless handling as the browser):
   - **BPM**: comb-filter fit of the onset envelope over 60–200 BPM. The winner is folded into the
     dance range 90–150 to settle half/double-time ambiguity, then refined to 0.01 BPM and rounded to an integer
     if it's within 0.06. A rigid grid is used unless the tempo drifts. Generated songs often wander section by section,
     so the check compares librosa's tracked beats with the rigid grid in 32-beat windows. If any window is > 30 ms off, the chart
     follows the tracked beats (glitches > 25 ms off a local fit are repaired), and `bpm` is the mean tempo. All beat-based
     rules (gaps, sweep lengths, camera spacing, preview bars) are then measured on the local beat, not the median BPM.
   - **Downbeats**: the beat phase (mod 4) with the most chroma change, low-band (kick) onsets and loudness jumps.
     The chart's `offset` is the first downbeat.
   - **Sections**: bar-level MFCC+chroma self-similarity (Foote novelty) plus loudness novelty. Boundaries
     are snapped to the 2-bar phrase grid and are ≥ 4 bars apart. Each section gets an energy level of 0/1/2 (song-relative
     loudness + onset density) and a label (intro/verse/chorus/break/outro). Sections that sound alike get the same routine key.
   - **Play window**: first to last bar with a clear drum pulse (on-beat vs off-beat onset ratio ≥ 2). This
     skips ambient or spoken intros and the fade-out. Bars without drums (ratio < 1.4) get half-bar hits at most.
3. Choreography (deterministic, seeded by the song id). The game has **one chart per song** (no difficulty select). It's
   generated at the "normal" density. `--difficulty easy|hard` swaps that density for an experiment and is not meant for the
   shipped catalogue. Each density has its own random stream.
   Each section gets a routine. That's an "A" and a "B"
   8-beat phrase, each a rhythm template plus a move motif, played A A B A … and re-used by every section with the same key
   (so choruses repeat their dance).
   - easy (opt-in): every 2 beats (every 4 in low sections), up/down/clap only, at most one sweep per long high-energy section.
   - normal (the default, shipped): low = 1–2 hits per bar, mid = every 2 beats with fills, high = on the beats with rests. All 6 moves; sweeps
     close sections and long phrases (transitions).
   - hard (opt-in): denser, syncopated half-beat **claps**, motifs biased to split_lu/split_ld alternations.
4. Overrides (`public/songs/<id>/overrides.json`, below) are applied, then the **ergonomics pass**.
5. **Camera track** (one track, shared by every chart of the song). The first cue is `wide` at t=0, and the last is a `wide` 2 s glide at
   the last bar with drums. Cues fall on section boundaries, then every 4 bars in high-energy sections and every 8 in the rest,
   always on downbeats and never closer than 2 bars. Entering a high-energy section from a calmer one = `drop` hard cut (ease 0).
   High-energy sections cut (ease 0) between front/low_left/close/low_right. Mid-energy sections glide (ease 1.2 s)
   between front/low_right/high/low_left. Calm sections glide (ease 2 s) between orbit/high/wide. The same shot is never
   used twice in a row. Ease is clamped to half the time until the next cue.
6. **Photo cues** (`{"t", "move": "photo"}`, a free "strike a pose" moment, never judged). There are exactly 4 per chart, at the
   same times in every difficulty, on the beat grid (auto-placed ones on downbeats; pinned ones on the nearest beat, e.g. a
   sung "Strike a POSE"), the first not before 30 s, ≥ 15 s apart. Auto placement splits the
   play window into 4 parts. In each part it takes the best downbeat (high-energy section entry > last bar of a section > 4-bar
   phrase start), as long as it doesn't crowd a hand-pinned note. Photos are inserted as pinned notes, so the ergonomics pass clears
   generated notes around them (≥ 2 beats free before, ≥ 1 beat after, ≥ 0.9 s on easy). They are left out of the density
   rules and of `moves` in index.json. Index gets `"photos": 4` instead.
7. **Preview** loop for song select. The length is the bar count closest to 8 bars that lands within 12–20 s (whole bars, so it loops
   seamlessly), starting on a downbeat. It's taken from the highest-energy section, preferring the most-repeated one, earliest first.
8. Writes `public/songs/<id>/chart.json` (`version`, `songId`, `bpm`, `offset`, `beats`, `downbeats`, `sections`,
   `notes`, `camera`; no `difficulty`) and deletes an old per-difficulty `charts/` dir. It upserts the song into
   `public/songs/index.json` with `"chart": "songs/<id>/chart.json"`, `moves` used, duration, `photos`, `preview`
   and `energy`. Energy is 1–3 pips telling players how demanding the chart is. The **difficulty score** is the physical
   load per second: each move weighs by kind (tap 1, split 1.6, sweep 2), and counts again when it follows the previous move
   within about 1 beat (clap→clap clapping along excluded). Below 1.0 is 1 pip, below 1.35 is 2, anything higher is 3. `"energy"` in overrides pins the pips (the 3 shipped songs
   pin the user's ranking; tests check the measured scores still increase in that order). index.json is sorted by energy,
   easiest first (ties keep their order).

### Ergonomic rules (enforced by the generator, checked by `tests/chart`)

| rule | value |
|---|---|
| min gap between notes (start → start, or sweep end → next) | 0.4 s (easy 0.9 s) |
| exception: clap → clap ("Clap. Clap.") | ≥ ½ beat (0.24 s at 126 BPM; not on easy). Every other pair keeps 0.4 s |
| sweep duration | 2–4 beats |
| before a sweep | ≥ 2 beats from the previous note (one whole free beat to get the arms overhead) |
| after a sweep | ≥ 1 beat |
| normal: consecutive notes without a rest (gap ≥ 2 beats) | ≤ 6 (hard ≤ 8); clap→clap pairs (clapping along) don't extend the run |
| easy/normal: split_lu ↔ split_ld flip (both forearms reverse) | ≥ 2 beats apart (generated flips become claps) |
| photo cue | ≥ 2 beats free before, ≥ 1 beat after (and the 0.4 s / easy 0.9 s gap); no other density rules |
| photo on the song's final hit (the chart's last note, e.g. a hard stop) | ≥ 1 beat free before (instead of 2) |
| first note / last note | ≥ 2 s into the song, inside the play window, not in local silence |

Pinned notes always win over generated ones. If two *pinned* notes break a rule, the tool prints a warning and keeps both,
and then `tests/chart` will fail. So fix the override.

## overrides.json

All times are seconds in `audio.mp3`. Any key can be left out. Keys starting with `_`, plus `why`/`lyric`/`label`, are comments.

```jsonc
{
  "version": 1,
  "analysis": { "bpm": 126.0, "offset": 0.284 },   // force tempo and/or the first downbeat
  "energy": 2,                                      // pin the song-select pips (else computed, see above)
  "sectionMap": [                                   // REPLACE the detected structure (starts snapped to downbeats)
    { "start": 0, "label": "intro", "level": 0 },     // intro + level 0 = no notes
    { "start": 6.5, "label": "groove", "level": 0, "moves": ["up", "down", "clap"] },  // optional move whitelist
    { "start": 43.2, "label": "chorus", "level": 2 }  // same label = same routine (key)
  ],
  "sections": [                                     // relabel / re-level detected sections (matched by midpoint)
    { "start": 112.7, "end": 124.1, "label": "bridge", "level": 0, "key": "chorus" }
  ],
  "noNotes": [ { "start": 0, "end": 21.0, "why": "spoken intro" } ],   // generator places nothing here
  "preview": { "start": 51.7, "bars": 8 },          // song-select loop: start snapped to the nearest downbeat;
                                                    // length in "bars" (or "dur" seconds, rounded to whole bars)
  "photos": [                                       // photo cues, snapped to the nearest beat ("snap":
                                                    // "downbeat" | "half" | false to change that); if fewer than 4
    { "t": 65.0, "why": "after 'Overload'" }        // are given, the rest are auto-placed. They must leave 2 beats
  ],                                                // before / 1 after free of *pinned* notes (warned otherwise)
  "camera": [                                       // pinned camera cues (t snapped to the nearest downbeat; t=0 stays 0)
    { "t": 51.7, "shot": "close", "ease": 0, "until": 61.2, "why": "chorus commands" }
  ],                                                // shots: front wide close low_left low_right high orbit drop
                                                    // generated cues < 2 bars from a pin, or inside [t, until), are dropped
  "pins": [                                         // time range [start, end) replaced by hand-authored notes
    {
      "label": "chorus 1", "start": 51.236, "end": 65.998,
      "snap": "half",                               // optional: snap times to the beat grid: beat | half | quarter;
                                                    // a note with "snap": false keeps its exact time (sung off the grid)
      "notes":  [ { "t": 51.951, "move": "up" },     // the chart's notes in this range
                  { "t": 62.189, "move": "sweep", "durBeats": 4 } ],  // sweep length: "durBeats" or "dur" (s)
      "easy":   [ … ]                               // optional, only used with --difficulty easy (wins over "notes");
                                                    // a string value is an alias: "hard": "normal"
    },
    {
      "start": 140.0, "end": 147.0,                 // pattern pin: cycle moves over the grid (null = rest)
      "pattern": { "moves": ["up", null, "down", "clap"], "stepBeats": 1, "sweepBeats": 3,
                   "difficulties": ["normal", "hard"] }
    }
  ]
}
```

If a pin has nothing for the density being generated (no `notes`, no matching per-density list, pattern not listed),
the generated notes in that range are kept. Generated notes just outside a pin that would break a gap rule are dropped.

## Finding vocal cues (songs that call out moves)

`tools/chart/align_lyrics.py` isolates the vocals with demucs (cached in `~/.cache/wawa-hero-align/`). It then
transcribes them with faster-whisper word timestamps, and/or forced-aligns known lyrics in a window
(torchaudio MMS_FA). Each word is printed with its beat number and the half-beat snapped time from `chart.json`.

```sh
uv run tools/chart/align_lyrics.py public/songs/<id>/audio.mp3 --whisper
uv run tools/chart/align_lyrics.py public/songs/<id>/audio.mp3 --range 51 60 --text "arms up arms down clap clap"
```

Scores below 0.3 are low confidence. Cross-check them against the other chorus, the whisper times, or a
spectrogram of the vocal stem. The heavy deps (torch 2.5.1, demucs) download on first use. Separation is forced onto the CPU
(MPS fails on demucs' conv sizes). All analysis is offline: nothing plays audio.

### system-online notes

126 BPM, first downbeat 0.284 s. The chorus commands land on a 2-beat call pattern starting at beat 108
(51.71 s). Chorus 2 is the same pattern exactly 152 beats (72.381 s) later. Two claps are sung half a beat apart
(0.24 s). Both claps are charted on the vocal (53.617 + 53.855 s, 125.998 + 126.236 s, on the half-beat grid), which
uses the clap-pair exception. `analysis.offset` is pinned at 0.284 s so those grid times can't drift. The pins in
`public/songs/system-online/overrides.json` carry a `lyric` comment on every note.

### arms-up-arms-down / wawa-hero notes

Both have **drifting tempos** (136→139.7 BPM and 123–126 BPM), so their charts follow the tracked beats. Callout
times were found with `align_lyrics.py` (whisper medium with the lyrics as `--prompt`, plus forced alignment). Then
vocal attacks (300–3000 Hz onsets on the demucs stem) were measured near each word. A note stays on the beat
grid when the attack is within 30 ms, and otherwise uses the attack (`"snap": false`, with the offset in `why`). The demucs stems
of these mixes keep a lot of instrument bleed, so forced-alignment scores were low. The attacks plus "chorus 2 = chorus 1 shifted
by N beats" are what confirm the times. Wawa Hero's chorus 2 drops the callouts after "Left up!", and "(Clap clap!)" is not
audible in either chorus. The routine is kept there anyway (marked in `lyric`).

