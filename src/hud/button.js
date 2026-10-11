import { iconSVG, CUES, token } from '../moves.js';
import { numeralHTML } from '../typography.js';
export function moveBadge(move) {
  if (!CUES[move]) return '';
  return `<span class="move-badge" data-move="${move}" style="--badge-color:var(--${token(move)})"><span class="move-badge-icon">${iconSVG(move)}</span><span class="move-badge-name">${CUES[move].label}</span></span>`;
}
export function buttonClasses(variant='secondary',size='md') {
  return `btn btn--${['primary','secondary','choice'].includes(variant)?variant:'secondary'} btn--${size==='lg'?'lg':'md'}`;
}
export function setButtonContent(el,label,{variant,size,move=el?.dataset?.move}={}) {
  if(!el)return;
  const classes=(el.className||'').split(/\s+/).filter(c=>c&&!c.startsWith('btn--')&&c!=='btn');
  el.className=[...classes,buttonClasses(variant||el.dataset?.variant,size||el.dataset?.size)].join(' ');
  el.innerHTML=moveBadge(move)+`<span class="button-label">${numeralHTML(label)}</span>`;
}
export function hydrateButtons(root=document) {
  for(const el of root.querySelectorAll('[data-button]'))setButtonContent(el,el.textContent.trim(),el.dataset);
}
