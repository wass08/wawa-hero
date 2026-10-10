// Replays every recording in tests/pose/recordings/*.json that has an `expect` block through the
// analyzer + judge (see src/pose/replay.js and the comment at the top of pose-debug.html).
// To add a regression test: record in pose-debug.html, drop the JSON here, add
//   "expect": { "player": 0, "songStart": 0, "notes": [{ "t": 1.2, "move": "split_lu" }], "results": ["perfect"] }
// (results[i] = allowed result or array of allowed results for notes[i]; times are seconds from the first frame).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createPoseRecorder, replayRecording } from '../../src/pose/index.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'recordings');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('pose recordings (replay → judge)', () => {
  it('has at least the synthetic fixture', () => expect(files.length).toBeGreaterThan(0));
  for (const file of files) {
    const rec = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!rec.expect) continue;
    it(file, () => {
      const { player = 0, songStart = 0, notes, results } = rec.expect;
      const r = replayRecording(rec, { player, notes, songStart });
      for (let i = 0; i < notes.length; i++) {
        const j = r.judgements.find((x) => x.note.t === notes[i].t && x.note.move === notes[i].move);
        const allowed = [].concat(results[i]);
        expect(j, `${file}: note ${i} (${notes[i].move}@${notes[i].t}) judged`).toBeTruthy();
        expect(allowed, `${file}: note ${i} (${notes[i].move}@${notes[i].t}) got ${j.result}`).toContain(j.result);
      }
    });
  }

  it('recorder round-trips (pack → replay gives the same scores as live)', () => {
    const rec = JSON.parse(readFileSync(join(dir, 'synthetic-split-sweep.json'), 'utf8'));
    const live = replayRecording(rec).frames;
    // re-record the replayed frames and replay again → identical classification
    const rr = createPoseRecorder({ aspect: rec.aspect });
    rec.frames.forEach((f, i) => rr.add(f.t, [f.players[0].raw.map(([x, y, z, visibility]) => ({ x, y, z, visibility }))], [live[i]]));
    const again = replayRecording(rr.finish()).frames;
    expect(again.map((f) => f.scores.split_lu)).toEqual(live.map((f) => f.scores.split_lu));
    expect(rr.finish().frames[30].players[0].scores).toBeTruthy();
  });
});
