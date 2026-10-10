// Tracker lifecycle (audit #8) with a mocked @mediapipe/tasks-vision.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctl = vi.hoisted(() => ({ instances: [], create: null }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: { createFromOptions: (_fs, opts) => ctl.create(opts.baseOptions.delegate) },
}));

import { createPoseTracker } from '../../src/pose/tracker.js';

function fakeLandmarker(delegate, { warmThrows = false, detectThrows = false } = {}) {
  const lm = {
    delegate, closed: 0, calls: 0,
    close() { this.closed++; },
    detectForVideo() {
      this.calls++;
      if (this.calls === 1 && warmThrows) throw new Error(`${delegate} warm-up failed`);
      if (this.calls > 1 && detectThrows) throw new Error(`${delegate} detect failed`);
      return { landmarks: [] };
    },
  };
  ctl.instances.push(lm);
  return lm;
}

function fakeVideo() {
  let h = 0;
  return {
    readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0, pending: new Set(),
    requestVideoFrameCallback() { const id = ++h; this.pending.add(id); return id; },
    cancelVideoFrameCallback(id) { this.pending.delete(id); },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  ctl.instances = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('tracker lifecycle (audit #8)', () => {
  it('happy path: ready once, one rVFC scheduled; close() is idempotent and releases everything', async () => {
    ctl.create = async (d) => fakeLandmarker(d);
    const video = fakeVideo();
    const statuses = [];
    const t = await createPoseTracker({ video, onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(['loading', 'ready']);
    expect(t.stats.delegate).toBe('GPU');
    expect(video.pending.size).toBe(1);
    t.close();
    t.close();
    expect(ctl.instances[0].closed).toBe(1);
    expect(video.pending.size).toBe(0);
    expect(t.update(0)).toBeNull();
  });

  it('GPU warm-up fails → CPU; CPU warm-up also fails → both closed, no callbacks, error', async () => {
    ctl.create = async (d) => fakeLandmarker(d, { warmThrows: true });
    const video = fakeVideo();
    const statuses = [];
    const t = await createPoseTracker({ video, onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(['loading', 'error']);
    expect(ctl.instances.map((i) => [i.delegate, i.closed])).toEqual([['GPU', 1], ['CPU', 1]]);
    expect(video.pending.size).toBe(0);
    expect(t.update(0)).toBeNull();
    t.close();
    expect(ctl.instances.every((i) => i.closed === 1)).toBe(true);
  });

  it('GPU warm-up fails → CPU fallback succeeds; GPU instance closed', async () => {
    ctl.create = async (d) => fakeLandmarker(d, { warmThrows: d === 'GPU' });
    const video = fakeVideo();
    const t = await createPoseTracker({ video });
    expect(t.stats.delegate).toBe('CPU');
    expect(ctl.instances.map((i) => [i.delegate, i.closed])).toEqual([['GPU', 1], ['CPU', 0]]);
    expect(video.pending.size).toBe(1);
    t.close();
    expect(ctl.instances[1].closed).toBe(1);
  });

  it('close() during a pending runtime CPU fallback: new landmarker is closed, no ready after close', async () => {
    let resolveCpu;
    ctl.create = (d) => (d === 'GPU'
      ? Promise.resolve(fakeLandmarker('GPU', { detectThrows: true }))
      : new Promise((r) => { resolveCpu = () => r(fakeLandmarker('CPU')); }));
    const video = fakeVideo();
    const statuses = [];
    const t = await createPoseTracker({ video, onStatus: (s) => statuses.push(s) });
    video.currentTime = 1;
    t.update(1000); // GPU detect throws → async CPU fallback starts
    await flush();
    expect(typeof resolveCpu).toBe('function');
    t.close();
    resolveCpu();
    await flush(); await flush();
    expect(statuses).toEqual(['loading', 'ready']); // nothing after close
    expect(ctl.instances.map((i) => [i.delegate, i.closed])).toEqual([['GPU', 1], ['CPU', 1]]);
    expect(video.pending.size).toBe(0);
    expect(t.update(2000)).toBeNull();
  });

  it('runtime CPU fallback whose warm-up fails → error, closed, callbacks stopped', async () => {
    ctl.create = async (d) => fakeLandmarker(d, d === 'GPU' ? { detectThrows: true } : { warmThrows: true });
    const video = fakeVideo();
    const statuses = [];
    const t = await createPoseTracker({ video, onStatus: (s) => statuses.push(s) });
    video.currentTime = 1;
    t.update(1000);
    await flush(); await flush();
    expect(statuses).toEqual(['loading', 'ready', 'error']);
    expect(ctl.instances.every((i) => i.closed === 1)).toBe(true);
    expect(video.pending.size).toBe(0);
    expect(t.update(2000)).toBeNull();
  });

  it('abort signal during init releases the landmarker and emits no ready', async () => {
    const ac = new AbortController();
    ctl.create = async (d) => { ac.abort(); return fakeLandmarker(d); };
    const video = fakeVideo();
    const statuses = [];
    const t = await createPoseTracker({ video, signal: ac.signal, onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(['loading']);
    expect(ctl.instances[0].closed).toBe(1);
    expect(video.pending.size).toBe(0);
    expect(t.update(0)).toBeNull();
  });
});
