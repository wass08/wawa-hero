import {sweepMissTip} from '../game/posting.js';
import { iconSVG } from '../moves.js';
export function fmtDigits(n, pad = 7) {
  const s = String(n).padStart(pad, '0'), lead = s.search(/[1-9]/);
  return [...s].map((d, i) => `<span${lead === -1 || i < lead ? ' class="z"' : ''}>${d}</span>`).join('');
}
export function popJudge(layer, j, x, y) {
  const el = document.createElement('div');
  el.className = `judge ${j.result}${j.note.move==='sweep'&&j.result==='miss'?' sweep-miss':''}`;
  const timing = j.note.move==='sweep'&&j.result==='miss'?sweepMissTip(j.reason):j.result==='good'?(j.off<0?'EARLY':'LATE'):'';
  el.innerHTML = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' }[j.result] + (timing ? `<small>${timing}</small>` : '');
  el.style.left = typeof x === 'number' ? x + 'px' : x;
  el.style.top = typeof y === 'number' ? y + 'px' : y;
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), {once:true});
}
export function starsHTML(n) {
  return [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}">${iconSVG('star')}</i>`).join('');
}
