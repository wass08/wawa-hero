// Round the total first, so minute boundaries never render as 0:60.
export function formatTime(seconds, precision = 0) {
  const scale = 10 ** precision, units = Math.round(Math.max(0, Number(seconds) || 0) * scale);
  const minutes = Math.floor(units / (60 * scale)), whole = Math.floor(units / scale) % 60;
  return `${minutes}:${String(whole).padStart(2, '0')}${precision ? `.${String(units % scale).padStart(precision, '0')}` : ''}`;
}
