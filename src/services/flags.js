import {flagSvg} from '../net/countries.js';
export function badgeSvg(code){const svg=flagSvg(code);if(!svg)return '';const hue=((code.charCodeAt(0)-65)*26+code.charCodeAt(1)-65)*47%360;return svg.replace(/<rect[^>]*\/>/,'<path d="M2 .5H30V2H31.5V22H30V23.5H2V22H.5V2H2Z" fill="oklch(0.45 0.12 '+hue+')" stroke="rgba(255,255,255,.5)"/>').replace('system-ui,Segoe UI,Arial,sans-serif','Rubik,Arial,sans-serif');}
export const badgeDataUrl=code=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(badgeSvg(code));
export function badgeElement(code){const el=document.createElement(code?'img':'span');if(code){el.src=badgeDataUrl(code);el.alt=code;el.className='country-flag';}return el;}
