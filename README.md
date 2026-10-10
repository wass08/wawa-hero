# WAWA HERO

A webcam dance rhythm game: a voxel concert stage in Three.js, with your moves tracked by MediaPipe Pose. Dance the cues on the rail, strike a pose at the photo cues, burn calories, and post to the Wall of Heroes. 1 or 2 players (local versus).

## Run
```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (optional: offline works without)
npm run dev
```
Stand ~2 m from the screen with your shoulders and elbows in frame.

Dev flags: `?autoplay` (bot plays), `?mute`, `?shot=<preset>` (freeze a camera shot). `/pose-debug.html` shows live pose scores, has a 1P/2P toggle and a recorder.

## Moves
Arms up · arms down · clap · left up · right up (elbows at shoulder height, forearms at 90°) · sweep (arms high, then down the sides) · photo (strike any pose).

## Layout
- `src/`: game app (stage, HUD, menus, audio, results)
- `src/pose/`: pose tracking, move classification, judging, calories
- `src/net/`: scoreboard client (Supabase REST, no SDK) and the countries list
- `tools/chart/`: song importer and chart generator (`uv run tools/chart/make_chart.py song.mp3 --id my-song`)
- `public/songs/`: song catalogue, audio, charts (chart JSON includes the camera track and photo cues)
- `supabase/`: scoreboard migration, rollback and verification script
- `SPEC.md`: the design contract · `reference/`, `design/`: visual references and mockups

## Tests
```bash
npx vitest run                                              # app + pose + net
uv run --with pytest --with numpy pytest -q tests/chart     # charts
```
