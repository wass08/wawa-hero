export const GAME_FONT = '"Chakra Petch", system-ui, sans-serif';
export const FONT_WEIGHTS = Object.freeze([400, 500, 600, 700]);
const fontLoads = new WeakMap();

// Start once during boot, also awaited by standalone photo exports. Canvas
// textures retain their pixels, so display:swap alone cannot fix a first paint.
export function loadGameFonts() {
  const fonts = globalThis.document?.fonts;
  if (!fonts?.load) return Promise.resolve();
  if (!fontLoads.has(fonts)) {
    fontLoads.set(fonts, Promise.allSettled(FONT_WEIGHTS.map(weight =>
      fonts.load(`${weight} 32px "Chakra Petch"`),
    )).then(() => {})); // Offline waits for every weight, then uses the declared fallback.
  }
  return fontLoads.get(fonts);
}

const numericRuns = /(\d+(?:[.,:/–-]\d+)*)/g;
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
// Mixed labels keep their original font; only the numeric runs get the token.
export function numeralHTML(text) {
  return String(text).split(numericRuns).map(part => /^\d/.test(part)
    ? `<span class="num">${escape(part)}</span>` : escape(part)).join('');
}

export function drawNumeralText(ctx, text, x, y, { spacing = .02, maxWidth } = {}) {
  const labelFont = ctx.font, align = ctx.textAlign || 'left', oldSpacing = ctx.letterSpacing || '0px';
  const size = Number(labelFont.match(/([\d.]+)px/)?.[1] || 20);
  const parts = String(text).split(/(\d+(?:[.,:/–-]\d+)*)/g).filter(Boolean);
  const runs = parts.map(part => {
    const numeric = /^\d/.test(part), font = numeric ? `700 ${size}px ${GAME_FONT}` : labelFont;
    ctx.font = font;
    if ('letterSpacing' in ctx) ctx.letterSpacing = numeric ? `${size * spacing}px` : oldSpacing;
    return { text: part, numeric, font, width: ctx.measureText(part).width };
  });
  const width = runs.reduce((sum, run) => sum + run.width, 0), scale = maxWidth && width > maxWidth ? maxWidth / width : 1;
  let cursor = x - (align === 'center' ? width * scale / 2 : align === 'right' || align === 'end' ? width * scale : 0);
  ctx.textAlign = 'left';
  for (const run of runs) {
    ctx.font = scale === 1 ? run.font : run.font.replace(`${size}px`, `${size * scale}px`);
    if ('letterSpacing' in ctx) ctx.letterSpacing = run.numeric ? `${size * scale * spacing}px` : oldSpacing;
    ctx.fillText(run.text, cursor, y);
    cursor += run.width * scale;
  }
  ctx.font = labelFont; ctx.textAlign = align;
  if ('letterSpacing' in ctx) ctx.letterSpacing = oldSpacing;
  return width * scale;
}
