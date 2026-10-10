// Wawa Hero scoreboard client: plain fetch against a (self-hosted) Supabase
// gateway with the public anon key. No supabase-js.
//
//   scoreboardEnabled                 true when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set
//   submitScore(entry, shotBlobs)     uploads shots (only if entry.share_shots), inserts the row.
//                                     Resolves { id, shots, row, shotErrors }.
//                                     Rejects with a ScoreboardError (friendly .message, .code).
//   fetchLeaderboard({ songId, difficulty, limit })   never throws: array (+ .error)
//   fetchWall({ limit })                              never throws: array (+ .error)
//   shotUrl(path)                     public URL of a stored shot ('' if invalid)
//
// Server-side rules live in supabase/migrations/20261010000000_wawa_hero_scoreboard.sql;
// validateEntry() mirrors them so problems surface before a round trip.

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const BUCKET = 'wawa-hero';
export const TABLE = 'wawa_hero_scores';
export const LEADERBOARD_RPC = 'wawa_hero_leaderboard';
export const CLIENT_VERSION = `web/${ENV.VITE_APP_VERSION || '0.1.0'}`.slice(0, 32);

export const LIMITS = Object.freeze({
  nameMax: 16,
  scoreMax: 2_000_000,
  starsMax: 3,
  countMax: 20_000,     // each of max_combo, perfect, good, miss, and perfect+good+miss
  kcalMax: 2000,
  durationMax: 3600,
  shotsMax: 4,
  shotBytes: 200 * 1024, // each shot must be strictly smaller
  clientVersionMax: 32,
  leaderboardMax: 100,
  wallMax: 100,
});

export const DIFFICULTIES = Object.freeze(['easy', 'normal']);
export const MODES = Object.freeze(['solo', 'versus']);
export const SONG_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const SHOT_PATH_RE = /^shots\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
// Same set the database rejects: C0/C1 controls, zero-width space, LRM/RLM,
// line/paragraph separators, bidi embeddings/overrides/isolates, word joiner, BOM.
// eslint-disable-next-line no-control-regex
const BAD_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/g;

const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const FRIENDLY = {
  not_configured: 'The online scoreboard is not available right now.',
  offline: "You're offline. Your score was not posted.",
  invalid: 'Some details need fixing before posting.',
  timeout: 'The scoreboard took too long to answer. Try again.',
  network: "Couldn't reach the scoreboard. Check your connection and try again.",
  rate_limited: 'Lots of dancers are posting right now. Try again in a minute.',
  rejected: 'The scoreboard rejected this score.',
  forbidden: 'The scoreboard refused this request.',
  duplicate: 'That photo was already uploaded.',
  too_large: 'That photo is too large.',
  bad_type: 'Photos must be WebP images.',
  server: 'The scoreboard is having trouble. Try again later.',
  http: 'Something went wrong with the scoreboard.',
};

export class ScoreboardError extends Error {
  /**
   * @param {string} code    machine code (keys of FRIENDLY)
   * @param {object} [extra] { status, details, errors, cause }
   */
  constructor(code, extra = {}) {
    super(extra.message || FRIENDLY[code] || FRIENDLY.http);
    this.name = 'ScoreboardError';
    this.code = code;
    this.status = extra.status ?? 0;
    this.details = extra.details ?? null;   // raw server error body (for logs)
    this.errors = extra.errors ?? null;     // validation errors [{ field, message }]
    this.retryable = ['timeout', 'network', 'rate_limited', 'server'].includes(code);
    if (extra.cause) this.cause = extra.cause;
  }
  toJSON() {
    return { code: this.code, message: this.message, status: this.status, retryable: this.retryable, errors: this.errors };
  }
}

/** Maps an HTTP status + parsed body (PostgREST or Storage shape) to a ScoreboardError. */
export function errorFromResponse(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  const pgCode = typeof b.code === 'string' ? b.code : '';
  const text = [b.message, b.error, b.details, b.hint, typeof body === 'string' ? body : '']
    .filter(x => typeof x === 'string').join(' ');
  const storageStatus = Number(b.statusCode) || 0;
  const extra = { status, details: body ?? null };
  if (status === 429 || /wawa_hero_rate_limited/.test(text)) return new ScoreboardError('rate_limited', extra);
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(pgCode) || /Bucket not found/i.test(text)) {
    return new ScoreboardError('not_configured', extra);
  }
  if (status === 413 || storageStatus === 413 || /too large|maximum allowed size|exceeded the maximum/i.test(text)) {
    return new ScoreboardError('too_large', extra);
  }
  if (status === 415 || storageStatus === 415 || /mime type|invalid_mime_type/i.test(text)) return new ScoreboardError('bad_type', extra);
  if (status === 409 || storageStatus === 409 || /duplicate|already exists/i.test(text)) return new ScoreboardError('duplicate', extra);
  if (/^(23|22)/.test(pgCode)) return new ScoreboardError('rejected', extra); // check / not-null / data errors
  if (status === 401 || status === 403 || storageStatus === 403 || pgCode === '42501' || /row-level security|unauthorized/i.test(text)) {
    return new ScoreboardError('forbidden', extra);
  }
  if (status === 404) return new ScoreboardError('not_configured', extra);
  if (status >= 500) return new ScoreboardError('server', extra);
  if (status === 400) return new ScoreboardError('rejected', extra);
  return new ScoreboardError('http', extra);
}

// ---------------------------------------------------------------------------
// Validation (mirrors the CHECK constraints)
// ---------------------------------------------------------------------------

/**
 * Makes a display name safe: NFC, strips control/invisible/bidi characters,
 * collapses whitespace, trims, keeps at most 16 characters (code points).
 */
export function sanitizeName(raw) {
  let s = String(raw ?? '');
  try { s = s.normalize('NFC'); } catch { /* old engines */ }
  s = s.replace(BAD_CHARS_RE, ' ').replace(/\s+/gu, ' ').trim();
  s = Array.from(s).slice(0, LIMITS.nameMax).join('').trim();
  return s;
}

function toInt(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/**
 * Validates and normalises a score entry (snake_case column names).
 * Fields that are never sent: id, created_at, hidden, shots (built by submitScore).
 * @returns {{ ok: boolean, errors: {field: string, message: string}[], value: object }}
 */
export function validateEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const errors = [];
  const bad = (field, message) => errors.push({ field, message });
  const value = {};

  value.song_id = typeof e.song_id === 'string' ? e.song_id.trim() : '';
  if (!SONG_ID_RE.test(value.song_id)) bad('song_id', 'Unknown song.');

  value.difficulty = e.difficulty;
  if (!DIFFICULTIES.includes(value.difficulty)) bad('difficulty', 'Difficulty must be easy or normal.');

  value.mode = e.mode == null ? 'solo' : e.mode;
  if (!MODES.includes(value.mode)) bad('mode', 'Mode must be solo or versus.');
  if (value.mode === 'versus') {
    value.versus_rank = toInt(e.versus_rank, null);
    if (value.versus_rank !== 1 && value.versus_rank !== 2) bad('versus_rank', 'Versus rank must be 1 or 2.');
  } else {
    value.versus_rank = null;
  }

  value.player_name = sanitizeName(e.player_name);
  if (!value.player_name) bad('player_name', 'Enter a name (1 to 16 characters).');

  if (e.country == null || e.country === '') {
    value.country = null;
  } else {
    value.country = String(e.country).trim().toUpperCase();
    if (!COUNTRY_RE.test(value.country)) bad('country', 'Pick a country from the list.');
  }

  const ints = [
    ['score', LIMITS.scoreMax, undefined],
    ['stars', LIMITS.starsMax, 0],
    ['max_combo', LIMITS.countMax, 0],
    ['perfect', LIMITS.countMax, 0],
    ['good', LIMITS.countMax, 0],
    ['miss', LIMITS.countMax, 0],
    ['duration_s', LIMITS.durationMax, 0],
  ];
  for (const [field, max, fallback] of ints) {
    const n = toInt(e[field], fallback);
    value[field] = n;
    if (n === undefined) bad(field, `${field} is required.`);
    else if (!Number.isFinite(n) || n < 0 || n > max) bad(field, `${field} must be between 0 and ${max}.`);
  }
  if (errors.every(x => !['perfect', 'good', 'miss'].includes(x.field))
      && value.perfect + value.good + value.miss > LIMITS.countMax) {
    bad('miss', `perfect + good + miss must be at most ${LIMITS.countMax}.`);
  }

  const kcal = e.kcal == null || e.kcal === '' ? 0 : Number(e.kcal);
  value.kcal = Number.isFinite(kcal) ? Math.round(kcal * 10) / 10 : NaN;
  if (!Number.isFinite(value.kcal) || value.kcal < 0 || value.kcal > LIMITS.kcalMax) {
    bad('kcal', `kcal must be between 0 and ${LIMITS.kcalMax}.`);
  }

  value.share_shots = e.share_shots === true;
  value.shots = [];

  const cv = e.client_version == null ? CLIENT_VERSION : String(e.client_version);
  value.client_version = cv.replace(BAD_CHARS_RE, '').slice(0, LIMITS.clientVersionMax) || null;

  return { ok: errors.length === 0, errors, value };
}

/**
 * Checks one shot blob before upload. Resolves null when fine, else an error
 * code: 'not_blob' | 'empty' | 'too_large' | 'bad_type'.
 * (Safari's canvas.toBlob('image/webp') silently returns PNG: that is 'bad_type'.)
 */
export async function checkShotBlob(blob) {
  if (!blob || typeof blob.size !== 'number' || typeof blob.slice !== 'function') return 'not_blob';
  if (blob.size <= 0) return 'empty';
  if (blob.size >= LIMITS.shotBytes) return 'too_large';
  if (blob.type && blob.type !== 'image/webp') return 'bad_type';
  try {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const ascii = String.fromCharCode(...head);
    if (ascii.slice(0, 4) !== 'RIFF' || ascii.slice(8, 12) !== 'WEBP') return 'bad_type';
  } catch {
    return 'bad_type';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function randomUUID() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for non-secure contexts (randomUUID needs https/localhost).
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function defaultIsOnline() {
  return !(typeof navigator !== 'undefined' && navigator && navigator.onLine === false);
}

function withError(rows, error) {
  const out = Array.isArray(rows) ? rows : [];
  Object.defineProperty(out, 'error', { value: error || null, enumerable: false, writable: true });
  return out;
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/**
 * Creates a scoreboard client. The module-level exports use one built from
 * import.meta.env; tests and tools can build their own.
 * @param {{ url?: string, anonKey?: string, fetch?: typeof fetch, timeoutMs?: number,
 *           isOnline?: () => boolean, uuid?: () => string, now?: () => number, cacheTtlMs?: number }} cfg
 */
export function createScoreboard(cfg = {}) {
  const base = typeof cfg.url === 'string' ? cfg.url.trim().replace(/\/+$/, '') : '';
  const key = typeof cfg.anonKey === 'string' ? cfg.anonKey.trim() : '';
  const enabled = /^https?:\/\/[^\s]+$/i.test(base) && key.length > 0;
  const doFetch = cfg.fetch || (typeof fetch === 'function' ? (...a) => fetch(...a) : null);
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isOnline = cfg.isOnline || defaultIsOnline;
  const uuid = cfg.uuid || randomUUID;
  const now = cfg.now || (() => Date.now());
  const ttl = cfg.cacheTtlMs ?? CACHE_TTL_MS;
  const cache = new Map(); // key -> { at, promise }

  // Legacy anon keys are JWTs and go in both headers; new publishable keys
  // (sb_publishable_...) are not JWTs and must only be sent as apikey.
  const authHeaders = () => (key.startsWith('eyJ')
    ? { apikey: key, Authorization: `Bearer ${key}` }
    : { apikey: key });

  /** fetch with timeout; resolves parsed JSON (or null), throws ScoreboardError. */
  async function request(path, init = {}) {
    if (!doFetch) throw new ScoreboardError('network', { message: 'fetch is not available.' });
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl?.abort(); }, timeoutMs);
    try {
      let res;
      try {
        res = await doFetch(`${base}${path}`, {
          ...init,
          headers: { ...authHeaders(), ...(init.headers || {}) },
          signal: ctrl?.signal,
        });
      } catch (err) {
        throw new ScoreboardError(timedOut ? 'timeout' : 'network', { cause: err });
      }
      let text = '';
      try { text = await res.text(); } catch (err) {
        throw new ScoreboardError(timedOut ? 'timeout' : 'network', { status: res.status, cause: err });
      }
      let body = null;
      if (text) { try { body = JSON.parse(text); } catch { body = text; } }
      if (!res.ok) throw errorFromResponse(res.status, body);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  function guard() {
    if (!enabled) return new ScoreboardError('not_configured');
    if (!isOnline()) return new ScoreboardError('offline');
    return null;
  }

  function cached(cacheKey, fresh, load) {
    const hit = cache.get(cacheKey);
    if (!fresh && hit && now() - hit.at < ttl) return hit.promise;
    const promise = load().then(rows => {
      if (rows.error) cache.delete(cacheKey); // never cache failures
      return rows;
    });
    cache.set(cacheKey, { at: now(), promise });
    return promise;
  }

  function shotUrl(path) {
    if (!enabled || typeof path !== 'string' || !SHOT_PATH_RE.test(path)) return '';
    return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
  }

  async function uploadShot(blob) {
    const path = `shots/${uuid()}.webp`;
    await request(`/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/webp',
        'x-upsert': 'false',                 // never overwrite (the server forbids it anyway)
        'cache-control': 'max-age=31536000', // names are unique, files immutable
      },
      body: blob,
    });
    return path;
  }

  async function submitScore(entry, shotBlobs = []) {
    const blocked = guard();
    if (blocked) throw blocked;
    const { ok, errors, value } = validateEntry(entry);
    if (!ok) {
      throw new ScoreboardError('invalid', {
        errors,
        message: `${FRIENDLY.invalid} ${errors.map(x => x.message).join(' ')}`.trim(),
      });
    }

    const shotErrors = [];
    if (value.share_shots) {
      const list = Array.from(shotBlobs || []).filter(b => b != null);
      list.slice(LIMITS.shotsMax).forEach((_, i) => shotErrors.push({ index: LIMITS.shotsMax + i, code: 'too_many', message: `Only ${LIMITS.shotsMax} photos can be posted.` }));
      const results = await Promise.all(list.slice(0, LIMITS.shotsMax).map(async (blob, index) => {
        const problem = await checkShotBlob(blob);
        if (problem) {
          shotErrors.push({ index, code: problem, message: FRIENDLY[problem] || 'That photo cannot be posted.' });
          return null;
        }
        try {
          return await uploadShot(blob);
        } catch (err) {
          shotErrors.push({ index, code: err.code || 'http', message: err.message });
          return null;
        }
      }));
      value.shots = results.filter(Boolean);
      shotErrors.sort((a, b) => a.index - b.index);
    }

    const data = await request(`/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(value),
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object' || !row.id) throw new ScoreboardError('server', { details: data });

    for (const k of [...cache.keys()]) {
      if (k.startsWith(`lb|${value.song_id}|${value.difficulty}|`) || k.startsWith('wall|')) cache.delete(k);
    }
    return { id: row.id, shots: Array.isArray(row.shots) ? row.shots : value.shots, row, shotErrors };
  }

  function fetchLeaderboard({ songId, difficulty, limit = 10, fresh = false } = {}) {
    const blocked = guard();
    if (blocked) return Promise.resolve(withError([], blocked));
    if (typeof songId !== 'string' || !SONG_ID_RE.test(songId) || !DIFFICULTIES.includes(difficulty)) {
      return Promise.resolve(withError([], new ScoreboardError('invalid', { message: 'Unknown song or difficulty.' })));
    }
    const n = clampInt(limit, 1, LIMITS.leaderboardMax, 10);
    return cached(`lb|${songId}|${difficulty}|${n}`, fresh, async () => {
      try {
        const qs = new URLSearchParams({ p_song_id: songId, p_difficulty: difficulty, p_limit: String(n) });
        const data = await request(`/rest/v1/rpc/${LEADERBOARD_RPC}?${qs}`, {
          method: 'GET', headers: { Accept: 'application/json' },
        });
        const rows = (Array.isArray(data) ? data : []).map(r => ({
          ...r,
          country: r.country ? String(r.country).trim() : null,
          kcal: r.kcal == null ? 0 : Number(r.kcal),
        }));
        return withError(rows, null);
      } catch (err) {
        return withError([], err instanceof ScoreboardError ? err : new ScoreboardError('http', { cause: err }));
      }
    });
  }

  function fetchWall({ limit = 24, fresh = false } = {}) {
    const blocked = guard();
    if (blocked) return Promise.resolve(withError([], blocked));
    const n = clampInt(limit, 1, LIMITS.wallMax, 24);
    return cached(`wall|${n}`, fresh, async () => {
      try {
        const qs = new URLSearchParams({
          select: 'id,created_at,song_id,difficulty,mode,player_name,country,score,stars,kcal,shots',
          share_shots: 'is.true',
          shots: 'neq.{}',
          order: 'created_at.desc',
          limit: String(n),
        });
        const data = await request(`/rest/v1/${TABLE}?${qs}`, {
          method: 'GET', headers: { Accept: 'application/json' },
        });
        const rows = (Array.isArray(data) ? data : [])
          .map(r => {
            const shots = (Array.isArray(r.shots) ? r.shots : []).filter(p => SHOT_PATH_RE.test(p));
            return {
              ...r,
              country: r.country ? String(r.country).trim() : null,
              kcal: r.kcal == null ? 0 : Number(r.kcal),
              shots,
              urls: shots.map(shotUrl),
            };
          })
          .filter(r => r.shots.length > 0);
        return withError(rows, null);
      } catch (err) {
        return withError([], err instanceof ScoreboardError ? err : new ScoreboardError('http', { cause: err }));
      }
    });
  }

  return {
    enabled,
    submitScore,
    fetchLeaderboard,
    fetchWall,
    shotUrl,
    clearCache: () => cache.clear(),
  };
}

const defaultClient = createScoreboard({
  url: ENV.VITE_SUPABASE_URL,
  anonKey: ENV.VITE_SUPABASE_ANON_KEY,
});

/** True when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are configured. */
export const scoreboardEnabled = defaultClient.enabled;

/**
 * Posts one player's result. Uploads up to 4 WebP shots first when
 * entry.share_shots is true (failed/invalid shots are skipped and listed in
 * shotErrors; the score is still posted).
 * entry: { song_id, difficulty: 'easy'|'normal', mode?: 'solo'|'versus', versus_rank?: 1|2,
 *          player_name, country?: 'FR'|null, score, stars, max_combo, perfect, good, miss,
 *          kcal, duration_s, share_shots?: boolean, client_version? }
 * @returns {Promise<{ id: string, shots: string[], row: object, shotErrors: {index, code, message}[] }>}
 * @throws {ScoreboardError} codes: not_configured | offline | invalid | timeout | network |
 *         rate_limited | rejected | forbidden | server | http  (err.message is user-friendly)
 */
export const submitScore = (entry, shotBlobs = []) => defaultClient.submitScore(entry, shotBlobs);

/**
 * Top entries for a song/difficulty: best per (name, country), ranked.
 * Never throws; resolves an array (rows: rank, id, created_at, player_name, country,
 * score, stars, kcal, max_combo, perfect, good, miss, duration_s, mode, ...) with a
 * non-enumerable .error (null or ScoreboardError). Cached 30 s; pass fresh: true to bypass.
 */
export const fetchLeaderboard = opts => defaultClient.fetchLeaderboard(opts);

/**
 * Recent rows that shared photos, newest first. Never throws; array (+ .error).
 * Rows: id, created_at, song_id, difficulty, mode, player_name, country, score, stars,
 * kcal, shots (storage paths), urls (public URLs). Cached 30 s; fresh: true bypasses.
 */
export const fetchWall = opts => defaultClient.fetchWall(opts);

/** Public URL for a stored shot path ('shots/<uuid>.webp'); '' when invalid or unconfigured. */
export const shotUrl = path => defaultClient.shotUrl(path);
