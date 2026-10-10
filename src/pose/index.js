// Pose module public API — see SPEC.md "Pose module API".
//
//   createPoseTracker({ video, onStatus, maxPlayers?: 1|2, model?: 'full'|'lite' })
//     → { update(nowMs): PoseFrame|null (P1), updateAll(nowMs): [P1|null, P2|null], setMaxPlayers(n), close(), stats }
//   createSyntheticPose({ player? }) → { press(move, opts?), release(move), releaseAll(), update(nowMs): PoseFrame }
//   createJudge({ perfect, good, latency, missDelay }) → { update(frame, songTime, notes): Judgement[], reset() }
//   createCalorieMeter({ weightKg }) → { update(dtSec, energy): kcal, kcal, reset() }
//
// Thresholds live in POSE_CONFIG (config.js).
export { MOVES, TAP_MOVES, SCORE_KEYS, MOVE_KEYS, MOVE_KEYS_P2, PLAYER_KEYS, POSE_CONFIG } from './config.js';
export { createPlayerAssigner, poseCentroidX, poseSignature } from './players.js';
export { createPoseTracker } from './tracker.js';
export { createSyntheticPose } from './synthetic.js';
export { createJudge } from './judge.js';
export { createCalorieMeter, metFromEnergy, kcalPerMinute, MET_ANCHORS } from './calories.js';
export { createPoseAnalyzer, createEnergyMeter } from './analyzer.js';
export { classifyLandmarks, mirrorLandmarks, emptyScores, argmaxMove, LM } from './features.js';
export { POSES, bodyLandmarks } from './body.js';
export { sweepPhaseOf, createSweepPractice } from './practice.js';
export { createPoseRecorder, replayRecording } from './replay.js';
