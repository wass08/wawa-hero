import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTRIES, FLAG_IMAGE_SIZE, TIMEZONE_COUNTRY, clearFlagImageCache, countryName, emojiFlagsSupported,
  flagDataUrl, flagEmoji, flagSvg, flagUrl, guessCountry, loadFlagImage, normalizeCountry, regionOfLanguageTag,
} from '../../src/net/countries.js';

describe('COUNTRIES', () => {
  it('has all 249 ISO 3166-1 alpha-2 codes, unique and well-formed', () => {
    expect(COUNTRIES).toHaveLength(249);
    const codes = COUNTRIES.map(c => c.code);
    expect(new Set(codes).size).toBe(249);
    for (const { code, name } of COUNTRIES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(1);
    }
  });

  it('is sorted by English name', () => {
    const names = COUNTRIES.map(c => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
    expect(names).toEqual(sorted);
  });

  it('contains the usual suspects and no pseudo-codes', () => {
    const byCode = Object.fromEntries(COUNTRIES.map(c => [c.code, c.name]));
    expect(byCode.FR).toBe('France');
    expect(byCode.US).toBe('United States');
    expect(byCode.GB).toBe('United Kingdom');
    expect(byCode.JP).toBe('Japan');
    expect(byCode.CI).toBe("Côte d'Ivoire");
    for (const fake of ['UK', 'EU', 'XK', 'ZZ', 'UN', 'EZ']) expect(byCode[fake]).toBeUndefined();
  });

  it('every time-zone mapping points at a known code', () => {
    const codes = new Set(COUNTRIES.map(c => c.code));
    expect(Object.keys(TIMEZONE_COUNTRY).length).toBeGreaterThanOrEqual(120);
    for (const code of Object.values(TIMEZONE_COUNTRY)) expect(codes.has(code)).toBe(true);
  });

  it('normalizeCountry / countryName', () => {
    expect(normalizeCountry(' fr ')).toBe('FR');
    expect(normalizeCountry('UK')).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    expect(countryName('de')).toBe('Germany');
    expect(countryName('??')).toBe('');
  });
});

describe('regionOfLanguageTag', () => {
  it.each([
    ['fr-FR', 'FR'], ['en-US', 'US'], ['en', null], ['zh-Hant-TW', 'TW'], ['es-419', null],
    ['en_GB', 'GB'], ['pt-br', 'BR'], ['', null], [null, null], ['xx-QQ', null],
  ])('%s -> %s', (tag, region) => {
    expect(regionOfLanguageTag(tag)).toBe(region);
  });
});

describe('guessCountry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    // [languages, timeZone, expected]
    [['fr-FR', 'fr', 'en'], 'Europe/Paris', 'FR'],
    [['fr-FR'], null, 'FR'],
    [['en', 'fr-CA'], 'America/Toronto', 'CA'],
    [['en'], 'Europe/Paris', 'FR'],          // bare 'en' ignored -> time zone
    [['en'], null, null],
    [[], 'Asia/Tokyo', 'JP'],
    [[], 'Etc/UTC', null],
    [['en-US'], 'America/New_York', 'US'],
    [['en-US'], null, 'US'],
    [['en-US', 'en'], 'Europe/Berlin', 'DE'],  // default en-US UI on a German machine
    [['en-GB'], 'Europe/Paris', 'GB'],       // explicit non-default region wins
    [['de-DE', 'fr-FR'], 'Europe/Paris', 'FR'], // time zone agrees with a listed region
    [['zh-Hant-TW'], 'Asia/Taipei', 'TW'],
    [['es-419'], 'America/Mexico_City', 'MX'],
    [['pt-BR'], 'Europe/Lisbon', 'BR'],
    [['ja'], 'Asia/Tokyo', 'JP'],
    [['en_US'], 'America/Chicago', 'US'],
  ])('%j + %s -> %s', (languages, timeZone, expected) => {
    expect(guessCountry({ languages, timeZone })).toBe(expected);
  });

  it('reads navigator.languages when not injected', () => {
    vi.stubGlobal('navigator', { languages: ['ko-KR', 'en'], language: 'ko-KR' });
    expect(guessCountry({ timeZone: null })).toBe('KR');
  });

  it('falls back to navigator.language', () => {
    vi.stubGlobal('navigator', { languages: [], language: 'it-IT' });
    expect(guessCountry({ timeZone: null })).toBe('IT');
  });

  it('survives a missing navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(guessCountry({ timeZone: 'Australia/Sydney' })).toBe('AU');
  });
});

describe('flags', () => {
  it('flagEmoji builds regional-indicator pairs', () => {
    expect(flagEmoji('FR')).toBe('\u{1F1EB}\u{1F1F7}');
    expect(flagEmoji('jp')).toBe('\u{1F1EF}\u{1F1F5}');
    expect([...flagEmoji('US')]).toHaveLength(2);
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji('FRA')).toBe('');
    expect(flagEmoji('F1')).toBe('');
    expect(flagEmoji(null)).toBe('');
  });

  it('flagSvg renders a text badge', () => {
    const svg = flagSvg('fr');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('>FR</text>');
    expect(svg).toContain('aria-label="France"');
    expect(flagSvg('nope')).toBe('');
    expect(flagSvg(undefined)).toBe('');
    expect(flagSvg('FR')).toBe(flagSvg('FR')); // stable colour
    expect(flagDataUrl('FR')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    expect(flagDataUrl('x')).toBe('');
  });

  it('emojiFlagsSupported detects Windows', () => {
    expect(emojiFlagsSupported('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe(false);
    expect(emojiFlagsSupported('Windows')).toBe(false);
    expect(emojiFlagsSupported('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605')).toBe(true);
  });
});

describe('flagUrl (flag-icons 4x3 SVG assets)', () => {
  it.each(['fr', 'us', 'gb', 'jp', 'br'])('%s resolves to its own SVG, any case', code => {
    const url = flagUrl(code);
    expect(url).toMatch(new RegExp(`(^|/)${code}(-[\\w-]+)?\\.svg(\\?|$)`));
    expect(flagUrl(code.toUpperCase())).toBe(url);
    expect(flagUrl(` ${code} `)).toBe(url);
  });

  it('distinct codes give distinct URLs', () => {
    expect(new Set(['fr', 'us', 'gb', 'jp', 'br'].map(flagUrl)).size).toBe(5);
  });

  it('every ISO country has a flag', () => {
    const missing = COUNTRIES.filter(c => !flagUrl(c.code)).map(c => c.code);
    expect(missing).toEqual([]);
  });

  it.each([null, undefined, '', 'X', 'FRA', 'UK', 'EU', 'XK', 'ZZ', 42])('%j -> null', code => {
    expect(flagUrl(code)).toBeNull();
  });
});

describe('loadFlagImage', () => {
  const created = [];
  class FakeImage {
    constructor() { created.push(this); this.onload = null; this.onerror = null; this._src = ''; }
    set src(v) {
      this._src = v;
      queueMicrotask(() => (FakeImage.fail ? this.onerror?.(new Event('error')) : this.onload?.()));
    }
    get src() { return this._src; }
  }

  function setup({ fetchOk = true } = {}) {
    created.length = 0;
    FakeImage.fail = false;
    clearFlagImageCache();
    const fetchMock = vi.fn(async () => new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" id="flag-icons-fr" viewBox="0 0 640 480"><path/></svg>',
      { status: fetchOk ? 200 : 404 },
    ));
    const blobs = [];
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { blobs.push(b); return `blob:flag-${blobs.length}`; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { fetchMock, blobs };
  }

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearFlagImageCache(); });

  it('loads once per code and caches the image (case-insensitive)', async () => {
    const { fetchMock } = setup();
    const [a, b] = await Promise.all([loadFlagImage('fr'), loadFlagImage('FR')]);
    expect(a).toBeInstanceOf(FakeImage);
    expect(b).toBe(a);
    expect(await loadFlagImage(' fr ')).toBe(a);
    expect(created).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(flagUrl('fr'));
    const other = await loadFlagImage('jp');
    expect(other).not.toBe(a);
    expect(created).toHaveLength(2);
  });

  it('gives the SVG an intrinsic size and loads it from a same-origin blob URL', async () => {
    const { blobs } = setup();
    const img = await loadFlagImage('fr');
    expect(img.src).toBe('blob:flag-1');
    const text = await blobs[0].text();
    expect(blobs[0].type).toBe('image/svg+xml');
    expect(text).toContain(`width="${FLAG_IMAGE_SIZE.width}" height="${FLAG_IMAGE_SIZE.height}"`);
    expect(text).toContain('viewBox="0 0 640 480"');
  });

  it('falls back to the asset URL when the fetch fails', async () => {
    setup({ fetchOk: false });
    const img = await loadFlagImage('br');
    expect(img.src).toBe(flagUrl('br'));
  });

  it('resolves null for unknown codes without loading anything', async () => {
    const { fetchMock } = setup();
    expect(await loadFlagImage('XK')).toBeNull();
    expect(await loadFlagImage(null)).toBeNull();
    expect(created).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not cache failures', async () => {
    setup();
    FakeImage.fail = true;
    expect(await loadFlagImage('us')).toBeNull();
    FakeImage.fail = false;
    expect(await loadFlagImage('us')).toBeInstanceOf(FakeImage);
    expect(created).toHaveLength(2);
  });

  it('resolves null outside a browser (no Image)', async () => {
    clearFlagImageCache();
    vi.stubGlobal('Image', undefined);
    expect(await loadFlagImage('fr')).toBeNull();
  });
});
