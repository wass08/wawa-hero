import {moveBadge,buttonClasses} from './button.js';
import {GAME_FONT,drawNumeralText,numeralHTML} from '../typography.js';
import { songArtist } from '../song-meta.js';
import { MOVES, iconSVG, drawIcon, token, P, css } from '../moves.js';
import { getBest } from '../settings.js';
export const $ = id => document.getElementById(id);
export { formatTime as fmtTime } from '../time.js';
import { formatTime as fmtTime } from '../time.js';
const LEGENDS={songs:[['split_lu','Previous'],['split_ld','Next'],['clap','Choose']],count:[['down','Cancel']],tutorial:[['split_lu','Previous'],['split_ld','Next'],['clap','Ready']]};
export function createMenuHUD(songs,onSong,onMove=()=>{}) {
  $('rows').innerHTML=songs.map((s,i)=>`<li class="row ${buttonClasses('choice')}" tabindex="0" role="button" data-i="${i}"><span class="no">${String(i+1).padStart(2,'0')}</span><span><span class="t"></span><span class="m">${numeralHTML(Math.round(s.bpm))} BPM · ${numeralHTML(fmtTime(s.duration))}</span></span><span class="pips">${[1,2,3].map(n=>`<i class="${n<=s.energy?'on':''}"></i>`).join('')}</span></li>`).join('');
  const rows=[...$('rows').children];rows.forEach((r,i)=>{r.querySelector('.t').textContent=songs[i].title;r.addEventListener('click',()=>onSong(i));r.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(!e.repeat)onSong(i);}});});
  return {
    render(state,sel) {
      $('hud').dataset.state=state;$('hud').classList.toggle('playing',state==='play'||state==='pause');
      rows.forEach((r,i)=>r.classList.toggle('sel',i===sel));
      const s=songs[sel];$('dTitle').textContent=s.title;const artist=songArtist(s);$('dArtist').textContent=artist;$('dArtist').hidden=!artist;
      $('dBpm').textContent=Math.round(s.bpm);$('dLen').textContent=fmtTime(s.duration);
      const best=getBest(s.id);$('dBest').textContent=best?best.toLocaleString():'—';
      $('dMoves').innerHTML=s.moves.map(m=>`<i style="--c:var(--${token(m)})" title="${MOVES[m].label}">${iconSVG(m)}</i>`).join('');
      $('dEnergy').innerHTML=[1,2,3].map(n=>`<i class="${n<=s.energy?'on':''}"></i>`).join('');
      $('legend').innerHTML=(LEGENDS[state]||[]).map(([m,a])=>`<button type="button" class="key ${buttonClasses('secondary')}" data-m="${m}">${moveBadge(m)}<span class="button-label">${a}</span></button>`).join('');for(const button of $('legend').children)button.addEventListener('click',()=>onMove(button.dataset.m));
    },
    flash(m) { const el=$('legend').querySelector(`[data-m="${m}"]`);if(el){el.classList.add('hit');setTimeout(()=>el.classList.remove('hit'),260);} },
  };
}
export function createWallPainter(getState) {
  const maskCanvas=document.createElement('canvas');maskCanvas.width=maskCanvas.height=6;
  const mc=maskCanvas.getContext('2d');mc.fillStyle=css([0.05,0.02,285],0.4);mc.fillRect(4,0,2,6);mc.fillRect(0,4,6,2);
  let mask;
  const FONT=GAME_FONT;
  return (ctx,W,H,st)=>{
    mask??=ctx.createPattern(maskCanvas,'repeat');
    const {state,song,countAt,menuCamera}=getState(),acc=MOVES.up.c;
    const pulse=Math.max(0,1-st.beatPhase*3),t=performance.now()/1000;
    if(menuCamera)ctx.clearRect(0,0,W,H);else{ctx.fillStyle=css([0.11,0.06,285]);ctx.fillRect(0,0,W,H);}
    const cols=44,cell=W/cols,rows=Math.floor(H/cell);
    for(let c=0;c<cols;c++){if(c>=8&&c<cols-8)continue;const lit=Math.round((0.2+0.5*Math.abs(Math.sin(t*1.3+c*0.6))+pulse*0.25)*rows);for(let r=0;r<rows;r++){ctx.fillStyle=r<lit?css(acc,0.85):css(P.fg,0.04);ctx.fillRect(c*cell+2,H-(r+1)*cell+2,cell-4,cell-4);}}
    ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.letterSpacing='0px';const cx=W/2;
    if(state==='count') {
      const e=(performance.now()-countAt)/1000,n=3-Math.floor(e/0.8),txt=n>0?String(n):'GO!',k=1+Math.max(0,0.25-(e%0.8))*1.2;
      ctx.save();ctx.translate(cx,H*0.62);ctx.scale(k,k);ctx.font=`700 ${n>0?300:220}px ${FONT}`;ctx.fillStyle=n>0?css(P.fg):css(acc);if(n>0){ctx.strokeStyle=css(P.dark);ctx.lineWidth=12;ctx.strokeText(txt,0,0);}ctx.fillText(txt,0,0);ctx.restore();
      ctx.font=`700 40px ${FONT}`;ctx.fillStyle=css(P.fg,0.75);ctx.fillText(song.title.toUpperCase(),cx,H*0.8);
    } else if(state==='title') {
      ctx.font=`700 136px ${FONT}`;ctx.fillStyle=css(P.fg);ctx.fillText('WAWA HERO',cx,H*.36);
      ctx.font=`500 36px ${FONT}`;ctx.fillStyle=css(P.fg,.85);ctx.fillText('The rhythm game you play with your arms',cx,H*.5);
      ctx.font=`600 34px ${FONT}`;ctx.fillStyle=css(acc);ctx.fillText('CLAP TO START',cx,H*.6);
    } else {
      ctx.font=`600 34px ${FONT}`;ctx.fillStyle=css(acc);ctx.fillText(state==='results'?'SET COMPLETE':'NOW SELECTED',cx,H*0.17);
      ctx.save();ctx.translate(cx,H*0.43);ctx.scale(1+pulse*0.025,1+pulse*0.025);ctx.font=`700 ${song.title.length>15?100:136}px ${FONT}`;ctx.fillStyle=css(P.fg);ctx.fillText(song.title.toUpperCase(),0,0);ctx.restore();
ctx.font=`600 40px ${FONT}`;ctx.fillStyle=css(P.fg,0.7);drawNumeralText(ctx,`${Math.round(song.bpm)} BPM`,cx,H*0.57);song.moves.forEach((m,i)=>drawIcon(ctx,m,cx+(i-(song.moves.length-1)/2)*110,H*0.7,74,css(MOVES[m].c)));
    }
    ctx.fillStyle=mask;ctx.fillRect(0,0,W,H);
  };
}
