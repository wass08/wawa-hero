// MediaPipe PoseLandmarker wrapper. Assets are served locally from public/mediapipe (wasm) and
// public/models (*.task). @mediapipe/tasks-vision is imported dynamically so the game bundle
// (and vitest) only pay for it when the camera is actually used.
import { POSE_CONFIG } from './config.js';
import { createPoseAnalyzer } from './analyzer.js';
import { createPlayerAssigner } from './players.js';

const baseUrl = () => {
  let b = (import.meta.env && import.meta.env.BASE_URL) || '/';
  if (!b.endsWith('/')) b += '/';
  return b;
};

/**
 * @param {object} o
 * @param {HTMLVideoElement} o.video  playing webcam <video> (owned by the caller)
 * @param {(status:'loading'|'ready'|'error', detail?:any)=>void} [o.onStatus]
 * @param {1|2} [o.maxPlayers=1] number of tracked players (MediaPipe numPoses); see players.js for identity
 * @param {'full'|'lite'} [o.model]
 * @param {'GPU'|'CPU'} [o.delegate] preferred delegate (falls back to CPU)
 * @param {AbortSignal} [o.signal] optional: abort initialisation (resources are released, no 'ready' emitted)
 * Never rejects: on failure it reports onStatus('error', err) and returns a tracker whose update() returns null.
 */
export async function createPoseTracker({ video, onStatus = () => {}, maxPlayers = 1, model = 'full', delegate = 'GPU', config = POSE_CONFIG, signal } = {}) {
  let numPlayers = maxPlayers === 2 ? 2 : 1;
  // Lifecycle: `closed` is checked after EVERY await; every failure path closes any landmarker it
  // created and stops the rVFC callbacks; close() is idempotent; no status is emitted after close.
  let closed = false;
  let landmarker = null;
  let rvfcHandle = 0;
  const isClosed = () => closed || !!(signal && signal.aborted);
  const status = (s, d) => { if (closed) return; try { onStatus(s, d); } catch (e) { console.error(e); } };
  const stats = { delegate: null, model, maxPlayers: numPlayers, poses: 0, detectMs: 0, fps: 0, frames: 0, warmupMs: 0 };
  const dead = {
    update: () => null, updateAll: () => [null, null], setMaxPlayers() {}, close() {}, stats,
    get lastFrame() { return null; }, get lastFrames() { return [null, null]; }, get closed() { return true; },
  };
  const safeClose = (lm) => { try { lm && lm.close(); } catch { /* ignore */ } };
  const stopCallbacks = () => {
    if (rvfcHandle && typeof video.cancelVideoFrameCallback === 'function') {
      try { video.cancelVideoFrameCallback(rvfcHandle); } catch { /* ignore */ }
    }
    rvfcHandle = 0;
  };
  const shutdown = () => {
    stopCallbacks();
    const lm = landmarker; landmarker = null;
    safeClose(lm);
  };
  const fail = (err) => {
    console.error('[pose] PoseLandmarker failed', err);
    status('error', err);
    shutdown();
    closed = true;
    return dead;
  };
  const aborted = () => { shutdown(); closed = true; return dead; };

  status('loading', { model });

  let PoseLandmarker, fileset;
  const base = baseUrl();
  const modelAssetPath = `${base}models/pose_landmarker_${model}.task`;
  const make = (d) => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath, delegate: d },
    runningMode: 'VIDEO',
    numPoses: numPlayers,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });

  let lastMpTs = 0;
  // Warm-up: the first detect compiles GPU shaders / allocates buffers and can block for seconds.
  // Do it now (while the game shows "loading") instead of on the first gameplay frame.
  const warmup = (lm) => {
    let src = null;
    if (video.readyState >= 2 && video.videoWidth) src = video;
    else if (typeof document !== 'undefined') {
      src = document.createElement('canvas'); src.width = 640; src.height = 480;
      src.getContext('2d').fillRect(0, 0, 640, 480);
    }
    if (!src) return;
    const t0 = performance.now();
    lastMpTs = Math.max(lastMpTs + 1, Math.round(t0));
    lm.detectForVideo(src, lastMpTs);
    stats.warmupMs = performance.now() - t0;
  };
  /** Create + warm up; returns null if closed meanwhile (the new instance is closed). Throws on failure (instance closed). */
  const createWarm = async (d) => {
    const lm = await make(d);
    if (isClosed()) { safeClose(lm); return null; }
    try { warmup(lm); } catch (e) { safeClose(lm); throw e; }
    return lm;
  };

  try {
    const vision = await import('@mediapipe/tasks-vision');
    if (isClosed()) return aborted();
    PoseLandmarker = vision.PoseLandmarker;
    fileset = await vision.FilesetResolver.forVisionTasks(`${base}mediapipe`);
    if (isClosed()) return aborted();
  } catch (err) {
    return fail(err);
  }
  try {
    landmarker = await createWarm(delegate);
    if (isClosed()) return aborted();
    stats.delegate = delegate;
  } catch (e) {
    if (delegate === 'CPU') return fail(e);
    console.warn('[pose] GPU delegate failed (create or warm-up), falling back to CPU', e);
    if (isClosed()) return aborted();
    try {
      landmarker = await createWarm('CPU');
      if (isClosed()) return aborted();
      stats.delegate = 'CPU';
    } catch (e2) {
      return fail(e2);
    }
  }

  const analyzers = [0, 1].map((player) => createPoseAnalyzer({ config, player }));
  const assigner = createPlayerAssigner({ maxPlayers: numPlayers });
  let lastVideoTime = -1;
  let lastFrames = [null, null];
  let lastRaw = [null, null];
  let lastAspect = 16 / 9;
  let optionsPending = null;
  let fallingBack = false;
  let fpsT0 = performance.now(), fpsN = 0;

  // requestVideoFrameCallback gives a better capture timestamp (captureTime for camera streams,
  // already in the performance.now() timebase). Detection itself runs in update() so the game loop
  // owns the scheduling; rVFC only records metadata. Registered only after successful init.
  let rvfc = null;
  const hasRvfc = typeof video.requestVideoFrameCallback === 'function';
  const onVideoFrame = (now, meta) => {
    if (closed) return;
    let tc = Number.isFinite(meta.captureTime) ? meta.captureTime
      : Number.isFinite(meta.presentationTime) ? meta.presentationTime : now;
    if (!(tc <= now + 1) || now - tc > 500) tc = now; // sanity: must be recent and not in the future
    rvfc = { t: tc, mediaTime: meta.mediaTime, fresh: true };
    rvfcHandle = video.requestVideoFrameCallback(onVideoFrame);
  };
  if (hasRvfc) rvfcHandle = video.requestVideoFrameCallback(onVideoFrame);

  const fallbackToCpu = async (err) => {
    if (closed || fallingBack || stats.delegate === 'CPU') return;
    fallingBack = true;
    console.warn('[pose] GPU detect failed, recreating on CPU', err);
    const old = landmarker; landmarker = null;
    safeClose(old);
    let lm;
    try {
      lm = await createWarm('CPU');
    } catch (e) {
      if (!closed) fail(e);
      return;
    }
    if (closed || !lm) { safeClose(lm); return; }
    landmarker = lm;
    stats.delegate = 'CPU';
    fallingBack = false;
    status('ready', { delegate: 'CPU', model, warmupMs: stats.warmupMs });
  };

  // Runs detection if the video has a new frame; updates lastFrames. Never throws.
  const step = () => {
    if (closed || !landmarker || optionsPending) return;
    if (video.readyState < 2 || !video.videoWidth) return;
    const vt = video.currentTime;
    if (vt === lastVideoTime) return;
    lastVideoTime = vt;

    const now = performance.now();
    let tCap = now;
    if (rvfc && rvfc.fresh) { tCap = rvfc.t; rvfc.fresh = false; }

    const mpTs = Math.max(lastMpTs + 1, Math.round(now));
    lastMpTs = mpTs;
    let res;
    const t0 = performance.now();
    try {
      res = landmarker.detectForVideo(video, mpTs);
    } catch (err) {
      if (stats.delegate === 'GPU') fallbackToCpu(err);
      else console.error('[pose] detect failed', err);
      return;
    }
    const ms = performance.now() - t0;
    stats.detectMs = stats.frames ? stats.detectMs * 0.9 + ms * 0.1 : ms;
    stats.frames++;
    fpsN++;
    if (now - fpsT0 >= 1000) { stats.fps = (fpsN * 1000) / (now - fpsT0); fpsN = 0; fpsT0 = now; }

    const poses = (res && res.landmarks) || [];
    stats.poses = poses.length;
    const aspect = video.videoWidth / video.videoHeight;
    const { poses: slots, reacquired } = assigner.assign(poses, tCap);
    lastRaw = [slots[0], slots[1]]; lastAspect = aspect;
    const next = [null, null];
    for (let i = 0; i < numPlayers; i++) {
      if (reacquired[i]) analyzers[i].reacquire(); // never carry smoothing across bodies
      next[i] = analyzers[i].process(slots[i], tCap, aspect);
    }
    lastFrames = next;
  };

  status('ready', { delegate: stats.delegate, model, warmupMs: stats.warmupMs });

  return {
    stats,
    get closed() { return closed; },
    get maxPlayers() { return numPlayers; },
    /** Latest P1 frame (null until the first result). */
    get lastFrame() { return closed ? null : lastFrames[0]; },
    get lastFrames() { return closed ? [null, null] : [lastFrames[0], lastFrames[1]]; },
    /** Raw (unmirrored) MediaPipe landmarks per player slot from the latest detection (for the recorder). */
    get lastRaw() { return [lastRaw[0], lastRaw[1]]; },
    get aspect() { return lastAspect; },
    /** Call once per rAF. Detects only on a new video frame. Returns the latest P1 PoseFrame or null. */
    update(nowMs = performance.now()) {
      if (closed) return null;
      step();
      return lastFrames[0];
    },
    /**
     * Call once per rAF instead of update() in 2-player mode. Returns [P1, P2]: a PoseFrame
     * (tracked:false when that player is not visible) for each active slot, null for slots
     * ≥ maxPlayers or before the first detection.
     */
    updateAll(nowMs = performance.now()) {
      if (closed) return [null, null];
      step();
      return [lastFrames[0], lastFrames[1]];
    },
    /** Switch between 1 and 2 players (MediaPipe numPoses). Resets player identity. Returns a Promise. */
    async setMaxPlayers(n) {
      const k = n === 2 ? 2 : 1;
      if (closed || k === numPlayers) return;
      numPlayers = k;
      stats.maxPlayers = k;
      assigner.setMaxPlayers(k);
      for (const a of analyzers) a.reset();
      lastFrames = [null, null];
      if (!landmarker) return; // a pending CPU fallback will pick up numPlayers via make()
      const lm = landmarker;
      const p = Promise.resolve(lm.setOptions({ numPoses: k })).catch((e) => console.warn('[pose] setOptions failed', e));
      optionsPending = p;
      await p;
      if (optionsPending === p) optionsPending = null;
    },
    /** Idempotent. Stops rVFC callbacks and releases the landmarker (also one being created by a pending fallback). */
    close() {
      if (closed) return;
      closed = true;
      shutdown();
    },
  };
}
