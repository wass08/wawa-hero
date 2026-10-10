import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTRIES, TIMEZONE_COUNTRY, countryName, emojiFlagsSupported, flagDataUrl, flagEmoji, flagSvg,
  guessCountry, normalizeCountry, regionOfLanguageTag,
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
