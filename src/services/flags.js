import * as countries from '../net/countries.js';
// Monograms are a bounded, last-resort fallback for a missing flag asset.
export function badgeSvg(code){const svg=countries.flagSvg(code);if(!svg)return '';const c=String(code).trim().toUpperCase();const hue=((c.charCodeAt(0)-65)*26+c.charCodeAt(1)-65)*47%360;return svg.replace(/<rect[^>]*\/>/,'<path d="M2 .5H30V2H31.5V22H30V23.5H2V22H.5V2H2Z" fill="oklch(0.45 0.12 '+hue+')" stroke="rgba(255,255,255,.5)"/>').replace('system-ui,Segoe UI,Arial,sans-serif','Chakra Petch,system-ui,sans-serif');}
export function badgeDataUrl(code){const svg=badgeSvg(code);return svg?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg):null;}
const fallbackImages=new Map();
function loadBadge(code){const url=badgeDataUrl(code);if(!url||typeof Image==='undefined')return Promise.resolve(null);if(!fallbackImages.has(url))fallbackImages.set(url,new Promise(resolve=>{const image=new Image();image.width=32;image.height=24;image.onload=()=>resolve(image);image.onerror=()=>{fallbackImages.delete(url);resolve(null);};image.src=url;}));return fallbackImages.get(url);}
export function createFlags(data=countries){
  const url=code=>data.flagUrl(code)||badgeDataUrl(code);
  return {
    url,
    async image(code){return await data.loadFlagImage(code)||await loadBadge(code);},
    element(code){
      const src=code&&url(code),el=document.createElement(src?'img':'span');
      if(src){el.src=src;el.alt=data.countryName?.(code)||code;el.className='country-flag';el.width=24;el.height=18;el.onerror=async()=>{el.onerror=null;const loaded=await data.loadFlagImage(code),fallback=loaded?.src||(!loaded?badgeDataUrl(code):null);if(fallback&&fallback!==src)el.src=fallback;};}
      return el;
    },
  };
}
