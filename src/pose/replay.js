// Pose recordings: capture raw landmarks (+ the live scores for reference) in pose-debug.html and
// replay them through the analyzer + judge offline (vitest), so real failing attempts become
// regression tests. Pure JS, no DOM / MediaPipe.
//
// Recording format (kind 'wawa-hero-pose-recording', version 1):
// {
//   kind, version, createdAt, aspect, model, maxPlayers, note,
//   frames: [ { t /* performance.now ms of the camera frame */,
//               players: [ { raw: [[x, y, z, visibility] × 33] (RAW MediaPipe, NOT mirrored) | null,
//                            scores, upperArmAngle } | null, … ] } ],
//   expect?: { player: 0, songStart: 0, notes: [{ t, move, dur? }], results: ['perfect' | ['perfect','good'] | …] }
// }
// `expect` is optional; add it by hand to turn a recording into a regression test
// (tests/pose/recordings/*.json are replayed by tests/pose/recordings.test.js).
import { POSE_CONFIG } from './config.js';
import { createPoseAnalyzer } from './analyzer.js';
import { createJudge } from './judge.js';

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const packRaw = (raw) => (raw ? raw.map((p) => [r4(p.x), r4(p.y), r4(p.z ?? 0), r4(p.visibility ?? 1)]) : null);
const unpackRaw = (arr) => (arr ? arr.map(([x, y, z, visibility]) => ({ x, y, z, visibility })) : null);
const packAngles = (o) => (o ? { left: r4(o.left), right: r4(o.right) } : null);
const packScores = (s) => (s ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r4(v)])) : null);

/** Collects frames; finish() returns the recording object (JSON-serialisable). */
export function createPoseRecorder({ aspect = 16 / 9, model = 'full', maxPlayers = 1, note = '' } = {}) {
  const frames = [];
  let lastT = -Infinity;
  return {
    get count() { return frames.length; },
    /** add(tMs, raws: [raw|null, raw|null], poseFrames?: [PoseFrame|null, …]); repeated t is ignored. */
    add(tMs, raws, poseFrames = []) {
      if (!(tMs > lastT)) return false;
      lastT = tMs;
      frames.push({
        t: r4(tMs),
        players: (raws || []).map((raw, i) => {
          const f = poseFrames[i];
          if (!raw && !f) return null;
          return { raw: packRaw(raw), scores: packScores(f?.scores), upperArmAngle: packAngles(f?.upperArmAngle) };
        }),
      });
      return true;
    },
    finish(extra = {}) {
      return {
        kind: 'wawa-hero-pose-recording', version: 1, createdAt: new Date().toISOString(),
        aspect, model, maxPlayers, note, ...extra, frames,
      };
    },
  };
}

/**
 * Replays one player of a recording through a fresh analyzer + judge.
 * @param {object} rec recording object
 * @param {object} [o]
 * @param {number} [o.player=0]
 * @param {Array}  [o.notes]   chart snippet, times in song seconds
 * @param {number} [o.songStart=0] song time of the recording's first frame
 * @param {object} [o.judge]   createJudge options
 * @returns {{ frames: PoseFrame[], judgements: Judgement[] (final only), progress: Judgement[], notes }}
 */
export function replayRecording(rec, { player = 0, notes = [], songStart = 0, judge: judgeOpts = {}, config = POSE_CONFIG } = {}) {
  if (!rec || rec.kind !== 'wawa-hero-pose-recording') throw new Error('not a wawa-hero pose recording');
  const analyzer = createPoseAnalyzer({ config, player });
  const judge = createJudge({ config, ...judgeOpts });
  const ns = notes.map((n) => ({ ...n }));
  const t0 = rec.frames.length ? rec.frames[0].t : 0;
  const frames = [], judgements = [], progress = [];
  for (const fr of rec.frames) {
    const p = fr.players?.[player];
    const f = analyzer.process(unpackRaw(p?.raw ?? null), fr.t, rec.aspect || 16 / 9);
    frames.push(f);
    const songTime = songStart + (fr.t - t0) / 1000;
    for (const j of judge.update(f, songTime, ns)) (j.result === null ? progress : judgements).push(j);
  }
  // flush expiry past the end of the recording
  const tEnd = songStart + (rec.frames.length ? (rec.frames.at(-1).t - t0) / 1000 : 0);
  for (let k = 1; k <= 60; k++) for (const j of judge.update(null, tEnd + k / 10, ns)) if (j.result) judgements.push(j);
  return { frames, judgements, progress, notes: ns };
}
