import { afterEach, expect, it, vi } from 'vitest';
import { FONT_WEIGHTS, loadGameFonts, drawNumeralText, numeralHTML } from '../typography.js';
import { renderStrip } from '../game/photos.js';
import { createPolaroidTexture } from '../hud/polaroid.js';
afterEach(() => vi.unstubAllGlobals());

it('loads all four used weights once and does not export a canvas before they resolve', async () => {
  let finish;
  const ready = new Promise(resolve => { finish = resolve; });
  const fonts = { load: vi.fn(() => ready) }, canvas = {
    getContext: vi.fn(() => ({ fillRect() {}, fillText() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, measureText: text => ({ width: text.length * 10 }) })),
    toBlob: callback => callback(new Blob(['test'], { type: 'image/webp' })),
  };
  vi.stubGlobal('document', { fonts, createElement: () => canvas });
  const first = loadGameFonts();
  expect(loadGameFonts()).toBe(first);
  const exporting = renderStrip([], { score: 42650, kcal: 12.8 });
  expect(canvas.getContext).not.toHaveBeenCalled();
  expect(fonts.load.mock.calls.map(([font]) => font)).toEqual(FONT_WEIGHTS.map(weight => `${weight} 32px "Chakra Petch"`));
  finish([]); await exporting;
  expect(canvas.getContext).toHaveBeenCalledOnce(); expect(fonts.load).toHaveBeenCalledTimes(4);
});

it('defers the first polaroid paint even if its image or flag arrives before fonts', async () => {
  let finish;
  const ready = new Promise(resolve => { finish = resolve; });
  const fonts = { load: () => ready };
  const ctx = { clearRect: vi.fn(), fillRect() {}, fillText() {}, drawImage() {}, save() {}, restore() {}, measureText: () => ({ width: 50 }) };
  const canvas = { getContext: () => ctx }, onUpdate = vi.fn(), image = {};
  vi.stubGlobal('document', { fonts, createElement: () => canvas });
  createPolaroidTexture({ score: 42650, country: null }, { photoUrl: '/local.webp', imageFactory: () => image, onUpdate });
  image.width = 640; image.height = 360; image.onload();
  expect(onUpdate).not.toHaveBeenCalled(); expect(ctx.clearRect).not.toHaveBeenCalled();
  finish([]); await loadGameFonts(); await Promise.resolve();
  expect(onUpdate).toHaveBeenCalledOnce();
});

it('keeps canvas labels at their weight and numbers at 700, preserving centred placement', () => {
  const painted = [], ctx = {
    font: '600 40px "Chakra Petch",system-ui,sans-serif', textAlign: 'center', letterSpacing: '0px',
    measureText: text => ({ width: text.length * 20 }),
    fillText(text, x, y) { painted.push({ text, x, y, font: this.font, spacing: this.letterSpacing }); },
  };
  drawNumeralText(ctx, '126 BPM', 100, 50);
  expect(painted).toEqual([
    { text: '126', x: 30, y: 50, font: '700 40px "Chakra Petch", system-ui, sans-serif', spacing: '0.8px' },
    { text: ' BPM', x: 90, y: 50, font: '600 40px "Chakra Petch",system-ui,sans-serif', spacing: '0px' },
  ]);
  expect(ctx.textAlign).toBe('center'); expect(ctx.letterSpacing).toBe('0px');
});

it('escapes mixed HTML values while marking scores, times and ranks as numerals', () => {
  expect(numeralHTML('126 BPM · 1:46 · #4 <Hero>')).toBe('<span class="num">126</span> BPM · <span class="num">1:46</span> · #<span class="num">4</span> &lt;Hero&gt;');
});

it('keeps escaped apostrophes and quotes intact rather than styling entity digits', () => {
  expect(numeralHTML("Couldn't save. Retry in 60 s."))
    .toBe("Couldn&#39;t save. Retry in <span class=\"num\">60</span> s.");
  expect(numeralHTML('Hero "07" & <8>'))
    .toBe('Hero &quot;<span class="num">07</span>&quot; &amp; &lt;<span class="num">8</span>&gt;');
});
