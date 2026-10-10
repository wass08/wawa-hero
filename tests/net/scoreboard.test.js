import { describe, expect, it, vi } from 'vitest';
import {
  LIMITS, SHOT_PATH_RE, ScoreboardError, checkShotBlob, createScoreboard, errorFromResponse,
  sanitizeName, validateEntry,
} from '../../src/net/scoreboard.js';

const URL_BASE = 'https://sb.example.test';
const JWT_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
const WEBP_1PX = Uint8Array.from(atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='), c => c.charCodeAt(0));
const webp = (bytes = WEBP_1PX) => new Blob([bytes], { type: 'image/webp' });

const UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
];

const ENTRY = {
  song_id: 'system-online', difficulty: 'normal', mode: 'solo', player_name: 'Wawa', country: 'FR',
  score: 48200, stars: 3, max_combo: 120, perfect: 100, good: 20, miss: 4, kcal: 15.44, duration_s: 183,
};

function json(status, body) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

/** fetch mock: routes by URL; records calls. */
function mockFetch(route) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    calls.push({ url, init, headers: init.headers || {} });
    return route(url, init, calls.length - 1);
  });
  fn.calls = calls;
  return fn;
}

function insertEcho(url, init) {
  if (url.includes('/rest/v1/wawa_hero_scores')) {
    const body = JSON.parse(init.body);
    return json(201, [{ id: '99999999-9999-4999-8999-999999999999', hidden: false, ...body }]);
  }
  return json(200, { Key: 'wawa-hero/x' });
}

function client(fetchImpl, extra = {}) {
  let i = 0;
  return createScoreboard({
    url: `${URL_BASE}/`, anonKey: JWT_KEY, fetch: fetchImpl, uuid: () => UUIDS[i++ % UUIDS.length],
    isOnline: () => true, ...extra,
  });
}

// ---------------------------------------------------------------------------
describe('sanitizeName', () => {
  it('trims, collapses whitespace and strips control / invisible / bidi characters', () => {
    expect(sanitizeName('  Wawa   Sensei \n')).toBe('Wawa Sensei');
    expect(sanitizeName('Wa\u0007wa')).toBe('Wa wa');
    expect(sanitizeName('\u202eevil\u202c')).toBe('evil');
    expect(sanitizeName('a\u200bb\ufeff')).toBe('a b');
    expect(sanitizeName('\u2066\u2069')).toBe('');
    expect(sanitizeName(null)).toBe('');
    expect(sanitizeName(42)).toBe('42');
  });

  it('keeps at most 16 code points (not UTF-16 units) and re-trims', () => {
    expect(sanitizeName('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnop');
    const emoji = '🕺'.repeat(20);
    expect(Array.from(sanitizeName(emoji))).toHaveLength(16);
    expect(sanitizeName('abcdefghijklmno pq')).toBe('abcdefghijklmno');
  });

  it('normalises to NFC', () => {
    expect(sanitizeName('Zoe\u0308')).toBe('Zo\u00eb');
  });
});

describe('validateEntry', () => {
  it('accepts a full entry and normalises it to the column set', () => {
    const { ok, errors, value } = validateEntry({ ...ENTRY, country: 'fr', duration_s: 183.4 });
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    expect(value).toMatchObject({
      song_id: 'system-online', difficulty: 'normal', mode: 'solo', versus_rank: null, player_name: 'Wawa',
      country: 'FR', score: 48200, stars: 3, kcal: 15.4, duration_s: 183, shots: [], share_shots: false,
    });
    expect(typeof value.client_version).toBe('string');
  });

  it('never carries id, created_at or hidden', () => {
    const { value } = validateEntry({ ...ENTRY, id: 'x', created_at: '2020-01-01', hidden: true, shots: ['evil'] });
    expect(value).not.toHaveProperty('id');
    expect(value).not.toHaveProperty('created_at');
    expect(value).not.toHaveProperty('hidden');
    expect(value.shots).toEqual([]);
  });

  it('fills optional counters with 0 and empty country with null', () => {
    const { ok, value } = validateEntry({ song_id: 'a', difficulty: 'easy', player_name: 'x', score: 0, country: '' });
    expect(ok).toBe(true);
    expect(value).toMatchObject({ stars: 0, max_combo: 0, perfect: 0, good: 0, miss: 0, kcal: 0, duration_s: 0, country: null });
  });

  it('handles versus consistency', () => {
    expect(validateEntry({ ...ENTRY, versus_rank: 2 }).value.versus_rank).toBeNull(); // solo drops it
    expect(validateEntry({ ...ENTRY, mode: 'versus', versus_rank: 2 }).ok).toBe(true);
    expect(validateEntry({ ...ENTRY, mode: 'versus' }).ok).toBe(false);
    expect(validateEntry({ ...ENTRY, mode: 'versus', versus_rank: 3 }).ok).toBe(false);
    expect(validateEntry({ ...ENTRY, mode: 'coop' }).ok).toBe(false);
  });

  it.each([
    ['song_id', '../etc'], ['song_id', ''], ['song_id', 'Upper'], ['difficulty', 'hard'],
    ['player_name', '   '], ['player_name', '\u202e'], ['country', 'FRA'], ['country', 'F1'],
    ['score', -1], ['score', 2_000_001], ['score', undefined], ['score', 'abc'], ['score', Infinity],
    ['stars', 4], ['max_combo', 20_001], ['perfect', -1], ['good', NaN], ['miss', 20_001],
    ['kcal', 2000.1], ['kcal', -0.5], ['kcal', 'x'], ['duration_s', 3601], ['duration_s', -1],
  ])('rejects %s = %j', (field, v) => {
    const { ok, errors } = validateEntry({ ...ENTRY, [field]: v });
    expect(ok).toBe(false);
    expect(errors.map(e => e.field)).toContain(field);
  });

  it('rejects perfect + good + miss over the cap', () => {
    const { ok, errors } = validateEntry({ ...ENTRY, perfect: 10_000, good: 10_000, miss: 1 });
    expect(ok).toBe(false);
    expect(errors[0].field).toBe('miss');
  });

  it('accepts the exact bounds', () => {
    const { ok } = validateEntry({ ...ENTRY, score: 2_000_000, stars: 3, kcal: 2000, duration_s: 3600, max_combo: 20_000, perfect: 20_000, good: 0, miss: 0 });
    expect(ok).toBe(true);
  });

  it('sanitises a long or dirty name instead of rejecting it', () => {
    const { ok, value } = validateEntry({ ...ENTRY, player_name: '  The\tVery Long Dancer Name  ' });
    expect(ok).toBe(true);
    expect(value.player_name).toBe('The Very Long Da');
  });

  it('caps client_version at 32 characters', () => {
    expect(validateEntry({ ...ENTRY, client_version: 'v'.repeat(40) }).value.client_version).toHaveLength(32);
  });

  it('copes with garbage input', () => {
    expect(validateEntry(null).ok).toBe(false);
    expect(validateEntry('x').ok).toBe(false);
  });
});

describe('checkShotBlob', () => {
  it('accepts a real WebP', async () => {
    expect(await checkShotBlob(webp())).toBeNull();
  });
  it('rejects PNG (Safari toBlob fallback), wrong magic, empty, oversize and non-blobs', async () => {
    expect(await checkShotBlob(new Blob(['\x89PNG'], { type: 'image/png' }))).toBe('bad_type');
    expect(await checkShotBlob(new Blob(['not a webp at all'], { type: 'image/webp' }))).toBe('bad_type');
    expect(await checkShotBlob(new Blob([], { type: 'image/webp' }))).toBe('empty');
    const big = new Uint8Array(LIMITS.shotBytes);
    big.set(WEBP_1PX);
    expect(await checkShotBlob(webp(big))).toBe('too_large');
    expect(await checkShotBlob(webp(big.subarray(0, LIMITS.shotBytes - 1)))).toBeNull();
    expect(await checkShotBlob('nope')).toBe('not_blob');
    expect(await checkShotBlob(null)).toBe('not_blob');
  });
});

// ---------------------------------------------------------------------------
describe('submitScore request shapes', () => {
  it('uploads shots then inserts with Prefer: return=representation', async () => {
    const f = mockFetch(insertEcho);
    const sb = client(f);
    const res = await sb.submitScore({ ...ENTRY, share_shots: true }, [webp(), webp()]);

    expect(f.calls).toHaveLength(3);
    const [up1, up2, ins] = f.calls;
    expect(up1.url).toBe(`${URL_BASE}/storage/v1/object/wawa-hero/shots/${UUIDS[0]}.webp`);
    expect(up2.url).toBe(`${URL_BASE}/storage/v1/object/wawa-hero/shots/${UUIDS[1]}.webp`);
    for (const up of [up1, up2]) {
      expect(up.init.method).toBe('POST');
      expect(up.headers).toMatchObject({
        apikey: JWT_KEY, Authorization: `Bearer ${JWT_KEY}`, 'Content-Type': 'image/webp', 'x-upsert': 'false',
      });
      expect(up.init.body).toBeInstanceOf(Blob);
      expect(up.init.signal).toBeDefined();
    }

    expect(ins.url).toBe(`${URL_BASE}/rest/v1/wawa_hero_scores`);
    expect(ins.init.method).toBe('POST');
    expect(ins.headers).toMatchObject({
      apikey: JWT_KEY, Authorization: `Bearer ${JWT_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    });
    const body = JSON.parse(ins.init.body);
    expect(body.shots).toEqual([`shots/${UUIDS[0]}.webp`, `shots/${UUIDS[1]}.webp`]);
    expect(body.share_shots).toBe(true);
    expect(body).not.toHaveProperty('hidden');
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('created_at');
    for (const p of body.shots) expect(p).toMatch(SHOT_PATH_RE);

    expect(res.id).toBe('99999999-9999-4999-8999-999999999999');
    expect(res.shots).toEqual(body.shots);
    expect(res.shotErrors).toEqual([]);
    expect(res.row.player_name).toBe('Wawa');
  });

  it('does not upload anything when share_shots is false', async () => {
    const f = mockFetch(insertEcho);
    const res = await client(f).submitScore({ ...ENTRY, share_shots: false }, [webp(), webp()]);
    expect(f.calls).toHaveLength(1);
    expect(JSON.parse(f.calls[0].init.body).shots).toEqual([]);
    expect(res.shots).toEqual([]);
  });

  it('uploads at most 4 shots', async () => {
    const f = mockFetch(insertEcho);
    const res = await client(f).submitScore({ ...ENTRY, share_shots: true }, [webp(), webp(), webp(), webp(), webp(), webp()]);
    expect(f.calls.filter(c => c.url.includes('/storage/'))).toHaveLength(4);
    expect(res.shots).toHaveLength(4);
    expect(res.shotErrors.map(e => e.code)).toEqual(['too_many', 'too_many']);
  });

  it('skips invalid shots without a request and still posts the score', async () => {
    const f = mockFetch(insertEcho);
    const png = new Blob(['\x89PNG'], { type: 'image/png' });
    const res = await client(f).submitScore({ ...ENTRY, share_shots: true }, [png, webp()]);
    expect(f.calls.filter(c => c.url.includes('/storage/'))).toHaveLength(1);
    expect(res.shots).toHaveLength(1);
    expect(res.shotErrors).toEqual([expect.objectContaining({ index: 0, code: 'bad_type' })]);
  });

  it('keeps going when one upload fails', async () => {
    const f = mockFetch((url, init, n) => (url.includes('/storage/') && n === 0
      ? json(500, { statusCode: '500', error: 'internal', message: 'boom' })
      : insertEcho(url, init)));
    const res = await client(f).submitScore({ ...ENTRY, share_shots: true }, [webp(), webp()]);
    expect(res.shots).toEqual([`shots/${UUIDS[1]}.webp`]);
    expect(res.shotErrors).toEqual([expect.objectContaining({ index: 0, code: 'server' })]);
  });

  it('sends only apikey (no Bearer) for non-JWT publishable keys', async () => {
    const f = mockFetch(insertEcho);
    await client(f, { anonKey: 'sb_publishable_abc' }).submitScore(ENTRY);
    expect(f.calls[0].headers.apikey).toBe('sb_publishable_abc');
    expect(f.calls[0].headers).not.toHaveProperty('Authorization');
  });
});

describe('submitScore errors', () => {
  const expectReject = async (promise, code) => {
    const err = await promise.then(() => null, e => e);
    expect(err).toBeInstanceOf(ScoreboardError);
    expect(err.code).toBe(code);
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(5);
    return err;
  };

  it('rejects invalid entries before any request', async () => {
    const f = mockFetch(insertEcho);
    const err = await expectReject(client(f).submitScore({ ...ENTRY, country: 'FRA', score: -5 }), 'invalid');
    expect(err.errors.map(e => e.field).sort()).toEqual(['country', 'score']);
    expect(f).not.toHaveBeenCalled();
  });

  it('not configured / offline', async () => {
    const f = mockFetch(insertEcho);
    await expectReject(createScoreboard({ url: '', anonKey: '', fetch: f }).submitScore(ENTRY), 'not_configured');
    await expectReject(client(f, { isOnline: () => false }).submitScore(ENTRY), 'offline');
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    [429, { code: 'PT429', details: 'ip', hint: 'Too many', message: 'wawa_hero_rate_limited' }, 'rate_limited', true],
    [400, { code: '23514', message: 'new row violates check constraint "wawa_hero_scores_score_chk"' }, 'rejected', false],
    [401, { code: '42501', message: 'permission denied for table wawa_hero_scores' }, 'forbidden', false],
    [404, { code: 'PGRST205', message: "Could not find the table 'public.wawa_hero_scores' in the schema cache" }, 'not_configured', false],
    [503, { message: 'upstream down' }, 'server', true],
  ])('maps HTTP %i to %s', async (status, body, code, retryable) => {
    const f = mockFetch(() => json(status, body));
    const err = await expectReject(client(f).submitScore(ENTRY), code);
    expect(err.status).toBe(status);
    expect(err.retryable).toBe(retryable);
    expect(err.details).toEqual(body);
  });

  it('network failure', async () => {
    const f = mockFetch(() => { throw new TypeError('Failed to fetch'); });
    await expectReject(client(f).submitScore(ENTRY), 'network');
  });

  it('times out with AbortController', async () => {
    const f = vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const err = await expectReject(client(f, { timeoutMs: 20 }).submitScore(ENTRY), 'timeout');
    expect(err.retryable).toBe(true);
  });

  it('a malformed success body is a server error', async () => {
    const f = mockFetch(() => json(201, []));
    await expectReject(client(f).submitScore(ENTRY), 'server');
  });
});

describe('errorFromResponse (storage bodies come back as HTTP 400 with statusCode inside)', () => {
  it.each([
    [{ statusCode: '415', error: 'invalid_mime_type', message: 'mime type text/plain is not supported' }, 'bad_type'],
    [{ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }, 'too_large'],
    [{ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 'duplicate'],
    [{ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 'forbidden'],
    [{ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }, 'not_configured'],
  ])('%j -> %s', (body, code) => {
    expect(errorFromResponse(400, body).code).toBe(code);
  });
  it('handles text and empty bodies', () => {
    expect(errorFromResponse(502, '<html>bad gateway</html>').code).toBe('server');
    expect(errorFromResponse(418, null).code).toBe('http');
  });
});

// ---------------------------------------------------------------------------
describe('fetchLeaderboard', () => {
  const rows = [
    { rank: 1, id: 'a', player_name: 'Wawa', country: 'FR', score: 3000, kcal: 12.3 },
    { rank: 2, id: 'b', player_name: 'Kai', country: null, score: 2000, kcal: null },
  ];

  it('calls the RPC with GET and the anon headers', async () => {
    const f = mockFetch(() => json(200, rows));
    const out = await client(f).fetchLeaderboard({ songId: 'system-online', difficulty: 'normal' });
    expect(f.calls).toHaveLength(1);
    const u = new URL(f.calls[0].url);
    expect(u.origin + u.pathname).toBe(`${URL_BASE}/rest/v1/rpc/wawa_hero_leaderboard`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ p_song_id: 'system-online', p_difficulty: 'normal', p_limit: '10' });
    expect(f.calls[0].init.method).toBe('GET');
    expect(f.calls[0].headers).toMatchObject({ apikey: JWT_KEY, Authorization: `Bearer ${JWT_KEY}` });
    expect(out).toHaveLength(2);
    expect(out.error).toBeNull();
    expect(out[1].kcal).toBe(0);
    expect(Object.keys(out)).toEqual(['0', '1']); // .error is not enumerable
  });

  it('clamps the limit', async () => {
    const f = mockFetch(() => json(200, []));
    await client(f).fetchLeaderboard({ songId: 'a', difficulty: 'easy', limit: 5000 });
    expect(new URL(f.calls[0].url).searchParams.get('p_limit')).toBe('100');
  });

  it('never throws: errors come back as [] + .error', async () => {
    const boom = mockFetch(() => { throw new TypeError('offline'); });
    const a = await client(boom).fetchLeaderboard({ songId: 'a', difficulty: 'easy' });
    expect(a).toEqual([]);
    expect(a.error.code).toBe('network');

    const missing = mockFetch(() => json(404, { code: 'PGRST202', message: 'Could not find the function' }));
    const b = await client(missing).fetchLeaderboard({ songId: 'a', difficulty: 'easy' });
    expect(b.error.code).toBe('not_configured');

    const hang = vi.fn((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const c = await client(hang, { timeoutMs: 20 }).fetchLeaderboard({ songId: 'a', difficulty: 'easy' });
    expect(c).toEqual([]);
    expect(c.error.code).toBe('timeout');

    const none = await createScoreboard({}).fetchLeaderboard({ songId: 'a', difficulty: 'easy' });
    expect(none.error.code).toBe('not_configured');

    const off = await client(boom, { isOnline: () => false }).fetchLeaderboard({ songId: 'a', difficulty: 'easy' });
    expect(off.error.code).toBe('offline');
  });

  it('rejects bad arguments without a request', async () => {
    const f = mockFetch(() => json(200, []));
    const out = await client(f).fetchLeaderboard({ songId: '../x', difficulty: 'easy' });
    expect(out.error.code).toBe('invalid');
    expect((await client(f).fetchLeaderboard()).error.code).toBe('invalid');
    expect(f).not.toHaveBeenCalled();
  });

  it('caches for 30 s, dedupes, bypasses with fresh, and does not cache failures', async () => {
    let t = 0;
    let fail = false;
    const f = mockFetch(() => (fail ? json(500, {}) : json(200, rows)));
    const sb = client(f, { now: () => t });
    const q = { songId: 'a', difficulty: 'easy' };
    await Promise.all([sb.fetchLeaderboard(q), sb.fetchLeaderboard(q)]);
    expect(f).toHaveBeenCalledTimes(1);
    t = 29_000; await sb.fetchLeaderboard(q);
    expect(f).toHaveBeenCalledTimes(1);
    await sb.fetchLeaderboard({ ...q, fresh: true });
    expect(f).toHaveBeenCalledTimes(2);
    t = 70_000; fail = true;
    expect((await sb.fetchLeaderboard(q)).error.code).toBe('server');
    fail = false;
    expect((await sb.fetchLeaderboard(q)).error).toBeNull();
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('a successful submit invalidates that board', async () => {
    const f = mockFetch((url, init) => (url.includes('/rpc/') ? json(200, rows) : insertEcho(url, init)));
    const sb = client(f);
    const q = { songId: 'system-online', difficulty: 'normal' };
    await sb.fetchLeaderboard(q);
    await sb.submitScore(ENTRY);
    await sb.fetchLeaderboard(q);
    expect(f.calls.filter(c => c.url.includes('/rpc/'))).toHaveLength(2);
  });
});

describe('fetchWall', () => {
  it('queries recent shared rows and adds public URLs', async () => {
    const good = `shots/${UUIDS[0]}.webp`;
    const f = mockFetch(() => json(200, [
      { id: 'a', player_name: 'Wawa', country: 'FR', score: 1, kcal: 2.5, shots: [good, 'evil/../x.webp'] },
      { id: 'b', player_name: 'Bad', country: 'US', score: 1, kcal: 1, shots: ['https://evil.example/x.webp'] },
    ]));
    const out = await client(f).fetchWall({});
    const u = new URL(f.calls[0].url);
    expect(u.origin + u.pathname).toBe(`${URL_BASE}/rest/v1/wawa_hero_scores`);
    expect(u.searchParams.get('share_shots')).toBe('is.true');
    expect(u.searchParams.get('shots')).toBe('neq.{}');
    expect(u.searchParams.get('order')).toBe('created_at.desc');
    expect(u.searchParams.get('limit')).toBe('24');
    expect(u.searchParams.get('select')).toContain('shots');
    expect(u.searchParams.get('select')).not.toContain('hidden');
    expect(out).toHaveLength(1);
    expect(out[0].shots).toEqual([good]);
    expect(out[0].urls).toEqual([`${URL_BASE}/storage/v1/object/public/wawa-hero/${good}`]);
    expect(out.error).toBeNull();
  });

  it('never throws', async () => {
    const f = mockFetch(() => json(500, { message: 'down' }));
    const out = await client(f).fetchWall({ limit: 3 });
    expect(out).toEqual([]);
    expect(out.error.code).toBe('server');
  });
});

describe('shotUrl', () => {
  it('builds the public URL only for valid shot paths', () => {
    const sb = client(mockFetch(insertEcho));
    const p = `shots/${UUIDS[2]}.webp`;
    expect(sb.shotUrl(p)).toBe(`${URL_BASE}/storage/v1/object/public/wawa-hero/${p}`);
    expect(sb.shotUrl('shots/../../secret.webp')).toBe('');
    expect(sb.shotUrl('https://evil.example/x.webp')).toBe('');
    expect(sb.shotUrl(null)).toBe('');
    expect(createScoreboard({}).shotUrl(p)).toBe('');
  });

  it('module exports exist with the SPEC names', async () => {
    const mod = await import('../../src/net/scoreboard.js');
    expect(typeof mod.scoreboardEnabled).toBe('boolean');
    for (const fn of ['submitScore', 'fetchLeaderboard', 'fetchWall', 'shotUrl']) expect(typeof mod[fn]).toBe('function');
  });
});
