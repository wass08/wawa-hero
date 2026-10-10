import {numeralHTML} from '../typography.js';
import { CUES, iconSVG, token } from '../moves.js';
import { fmtDigits, starsHTML, popJudge } from './helpers.js';
import { sweepDescent } from '../game/versus.js';
const $ = id => document.getElementById(id);
const icons = Object.fromEntries(Object.keys(CUES).map(m => [m, iconSVG(m)]));
export function createGameplayHUD() {
  const track = $('railTrack'), ring = $('ring'), meter = $('meter');
  meter.innerHTML = '<b></b>'.repeat(12); const segs = [...meter.children];
  $('flame').innerHTML = iconSVG('flame');
  const ticks = Array.from({length:32}, () => { const el = document.createElement('div'); el.className = 'tick'; track.insertBefore(el,ring); return el; });
  const cues = Array.from({length:32}, () => {
    const el = document.createElement('div'); el.className = 'cue'; el.style.display='none';
    const tail = document.createElement('span'); tail.className='hold-tail'; tail.innerHTML='<i></i>';
    const head=document.createElement('span'); head.className='cue-head';
    el.append(tail,head); track.append(el); return {el,tail,head,note:null};
  });
  let flash=0, width=innerWidth, cursor=0, chart, previous={},count=1;
  addEventListener('resize',()=>width=track.clientWidth);
  return {
    setSong(song, nextChart, players=1) {
      count=players;$('scoreLabel').innerHTML=count===2?'P<span class="num">1</span> · SCORE':'Score';
      chart=nextChart; cursor=0; previous={}; flash=0; ring.style.setProperty('--f',0); width=track.clientWidth;
      $('songTitle').textContent=song.title;
      $('songMeta').innerHTML=`${numeralHTML(song.bpm.toFixed(0))} BPM`;
      for(const cue of cues) { cue.note=null; cue.el.style.display='none'; }
      $('judgeLayer').replaceChildren();
    },
    judgement(j,player=0) {
      const rect=ring.getBoundingClientRect(), unit=Math.min(innerWidth/100,innerHeight/56.25);
      // Keep the latest verdict readable when closely spaced notes are judged.
      const layer=$('judgeLayer');
      for(const el of layer.querySelectorAll(`[data-player="${player}"]`))el.remove();
      popJudge(layer,j,player?innerWidth*.86:rect.left+rect.width/2,rect.top-unit*2.4);
      layer.lastElementChild.dataset.player=player;
      if(j.result!=='miss') { flash=1; ring.style.setProperty('--c',`var(--${token(j.note.move)})`); }
    },
    update(st, time, duration, kcal, dt, second=null, first=null) {
      const lookahead=2, ringX=width*0.14, pps=(width-ringX)/lookahead;
      if(chart) {
        const beat=60/chart.bpm, beat0=Math.ceil((time-0.3-(chart.offset||0))/beat);
        // Detected beat times retain their audio-file positions if provided.
        let index=0;
        if(chart.beats?.length) {
          let lo=0,hi=chart.beats.length;
          while(lo<hi){const m=(lo+hi)>>1;if(chart.beats[m]<time-0.3)lo=m+1;else hi=m;}
          for(let b=lo;b<chart.beats.length&&index<ticks.length;b++) {
            const t=chart.beats[b]; if(t>time+lookahead+0.4)break;
            const el=ticks[index++]; el.style.display='';el.style.left=`${ringX+(t-time)*pps}px`;
            el.classList.toggle('bar',chart.downbeats?.some(d=>Math.abs(d-t)<0.03)??b%4===0);
          }
        } else for(let i=0;i<ticks.length;i++) {
          const b=beat0+i,t=(chart.offset||0)+b*beat;
          if(t>time+lookahead+0.4)break;
          const el=ticks[index++];el.style.display='';el.style.left=`${ringX+(t-time)*pps}px`;el.classList.toggle('bar',b%4===0);
        }
        for(;index<ticks.length;index++)ticks[index].style.display='none';
        const notes=chart.notes;
        while(cursor<notes.length && time>notes[cursor].t+(notes[cursor].dur||0)+0.6)cursor++;
        let k=0,next=false;
        for(let i=cursor;i<notes.length;i++) {
          const n=notes[i],d=n.t-time;if(d>lookahead+0.3)break;
          if(n.photoTaken||n.uiResult&&n.uiResult!=='miss')continue;
          const cue=cues[k++];if(!cue)break;
          if(cue.note!==n) {
            cue.note=n;cue.head.innerHTML=icons[n.move]+`<b>${CUES[n.move].label}</b>`;
            cue.el.style.setProperty('--c',`var(--${token(n.move)})`);
            cue.el.classList.toggle('photo-cue',n.move==='photo');cue.el.classList.toggle('hold',!!n.dur);cue.tail.hidden=!n.dur;
          }
          const active=!next&&!n.uiResult;if(active)next=true;
          cue.el.classList.toggle('next',active);cue.el.classList.toggle('missed',n.uiResult==='miss');
          cue.el.style.display='';
          const x=ringX+(n.dur&&n.uiProgress>0?Math.max(0,d):d)*pps;
          cue.el.style.transform=`translate3d(${x}px,-50%,0) translateX(-50%) scale(${active?1.1:1})`;
          if(n.dur) {cue.el.style.setProperty('--length',`${n.dur*pps*(1-Math.min(1,n.uiProgress||0))/1.1}px`);cue.el.style.setProperty('--progress',`${(n.uiProgress||0)*100}%`);}
        }
        for(;k<cues.length;k++)cues[k].el.style.display='none';
      }
      flash=Math.max(0,flash-dt*4);ring.style.setProperty('--f',flash);
      if(previous.score!==st.score)$('score').innerHTML=fmtDigits(st.score);
      if(previous.combo!==st.combo)$('combo').textContent=st.combo;
      if(previous.mult!==st.mult){$('mult').textContent='×'+st.mult;$('mult').dataset.m=st.mult;}
      if(previous.stars!==st.stars)$('stars').innerHTML=starsHTML(st.stars);
      const hype=Math.round(st.hype*12);
      if(previous.hype!==hype)for(let i=0;i<segs.length;i++){segs[i].classList.toggle('on',i<hype);segs[i].style.setProperty('--lv',st.hype<0.3?'var(--miss)':st.hype<0.7?'var(--down)':'var(--perfect)');}
      previous.score=st.score;previous.combo=st.combo;previous.mult=st.mult;previous.stars=st.stars;previous.hype=hype;
      const kc=kcal.toFixed(1); if(previous.kcal!==kc){$('kcal').textContent=kc;previous.kcal=kc;}
      if(second){
        const s=second.score;if(previous.score2!==s.score)$('score2').innerHTML=fmtDigits(s.score);
        if(previous.stars2!==s.stars)$('stars2').innerHTML=starsHTML(s.stars);
        if(previous.combo2!==s.combo)$('combo2').textContent=s.combo;
        if(previous.mult2!==s.mult){$('mult2').textContent='×'+s.mult;$('mult2').dataset.m=s.mult;}
        const kcal2=second.calories.kcal.toFixed(1);if(previous.kcal2!==kcal2)$('kcal2').textContent=kcal2;
        previous.score2=s.score;previous.stars2=s.stars;previous.combo2=s.combo;previous.mult2=s.mult;previous.kcal2=kcal2;
      }
      for(let p=0;p<count;p++){
        const session=p?second:first,el=$(p?'sweepGauge2':'sweepGauge');
        const active=session?.notes.find(n=>n.move==='sweep'&&!n.uiResult&&time>=n.t-.12&&time<=n.t+n.dur+.4);
        el.hidden=!active;
        if(active){const progress=active.uiProgress??sweepDescent(session.frame)??0;$(p?'arc2':'arc1').style.strokeDasharray=`${progress*100} 100`;}
      }
      $('songBar').style.width=`${Math.max(0,Math.min(1,time/duration))*100}%`;
    },
  };
}
