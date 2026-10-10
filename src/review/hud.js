import {numeralHTML,drawNumeralText} from '../typography.js';
import { reviewSongMeta } from '../song-meta.js';
import { CUES, iconSVG, css } from '../moves.js';
import { formatTime } from '../time.js';
import { REVIEW_RATES, createBeatGrid, cueAt, reviewCopy, reviewLink } from './logic.js';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createReviewIndex(songs, params) {
  document.getElementById('hud').hidden = true;
  const root = document.createElement('main'); root.className = 'review-index';
  root.innerHTML = `<div class="review-index-panel"><div class="review-brand">WAWA HERO</div><p class="review-kicker">CHART REVIEW</p><h1>Find your moment.</h1><p class="review-intro">Play, slow down and loop a few bars. Copy a cue to share an adjustment.</p><nav aria-label="Review songs">${songs.map((s, i) => `<a href="${escape(reviewLink(params,s.id))}"><span class="review-index-no">0${i+1}</span><span><strong>${escape(s.title)}</strong><small>${numeralHTML(reviewSongMeta(s))}</small></span><span>${numeralHTML(formatTime(s.duration))} ↗</span></a>`).join('')}</nav><p class="review-index-tip">Add <code>&t=83.4&rate=0.75</code> to open a specific moment.</p></div>`;
  document.body.append(root); document.title = 'Chart review · Wawa Hero';
}
export function createReviewHUD({ song, chart, duration, cameraCues, params, onToggle, onSeek, onRate, onLoop, onCamera, onSfx, getState }) {
  const grid = createBeatGrid(chart, duration), notes = chart.notes;
  const root = document.createElement('section'); root.className = 'review-ui';
  root.innerHTML = `<header class="review-heading"><a class="key panel hud-back" href="${escape(reviewLink(params))}"><svg class="pixel-arrow" viewBox="0 0 13 11" aria-hidden="true"><path d="M5 1h2v2H5V1ZM3 3h2v2H3V3ZM1 5h11v1H1V5ZM1 6h4v1H1V6ZM3 7h2v2H3V7ZM5 9h2v1H5V9Z"/></svg><div><b>REVIEW SONGS</b><span>Choose a track</span></div></a><span>CHART REVIEW</span><strong>${escape(song.title)}</strong><button type="button" id="reviewCamera">Enable camera</button></header>
    <aside class="review-inspector"><button type="button" class="review-inspector-toggle" aria-expanded="true" aria-controls="reviewInspectorBody">CUE INSPECTOR <span>−</span></button><div id="reviewInspectorBody"><div class="review-context"><span>SECTION <b id="reviewSection"></b></span><span>CAMERA <b id="reviewShot"></b></span></div><div class="review-note-heading"><span># / TIME / BAR</span><span>MOVE · COPY</span></div><div class="review-note-list"></div><p class="review-inspector-tip">Click a cue to start one bar before it.</p></div></aside>
    <div class="review-transport"><div class="review-timeline"><canvas aria-hidden="true"></canvas><input id="reviewScrubber" type="range" min="0" max="${duration}" step="0.001" value="0" aria-label="Seek song time"><div class="review-loop-band" hidden></div><div class="review-playhead"></div></div><div class="review-controls"><button type="button" id="reviewPlay">▶ Play</button><div class="review-jumps"><button type="button" data-step="-4" title="Shift + Left">−<span class="num">1</span> bar</button><button type="button" data-step="-1" title="Left">−<span class="num">1</span> beat</button><button type="button" data-step="1" title="Right">+<span class="num">1</span> beat</button><button type="button" data-step="4" title="Shift + Right">+<span class="num">1</span> bar</button></div><div class="review-readout"><output id="reviewTime"></output><button type="button" id="reviewCopy" title="Copy moment (C)" aria-label="Copy current moment">Copy</button></div><div class="review-rates" aria-label="Playback speed">${REVIEW_RATES.map(rate => `<button type="button" data-rate="${rate}" aria-pressed="false"><span class="num">${rate}</span>×</button>`).join('')}</div><button type="button" id="reviewLoop" aria-pressed="false" title="Loop current four bars (L)">↻ Loop <span class="num">4</span> bars</button><button type="button" id="reviewSfx" aria-pressed="true" title="Toggle sound effects">SFX on</button><span class="review-duration num">${formatTime(duration)}</span></div><div class="review-footer"><span id="reviewStatus" role="status">Paused · press Play to listen</span><span>SPACE play / pause · ← → beat · SHIFT bar · [ ] speed · L loop · C copy</span></div></div>`;
  document.getElementById('hud').append(root);
  const $ = selector => root.querySelector(selector), scrubber = $('#reviewScrubber'), canvas = $('canvas'), ctx = canvas.getContext('2d');
  const list = $('.review-note-list'), pool = [], timeOutput = $('#reviewTime');
  let open = true, lastWindow = '', lastTime = 0, error = '', copiedUntil = 0;
  const icons = Object.fromEntries(Object.keys(CUES).map(id => [id, iconSVG(id)]));
  function copyText(note, index, time = note?.t ?? lastTime) {
    const camera = cueAt(cameraCues, time)?.shot;
    return reviewCopy({ songId: song.id, time, grid, note, index, camera });
  }
  async function copy(note, index, time) {
    const value = copyText(note, index, time);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else { const el=document.createElement('textarea');el.value=value;document.body.append(el);el.select();document.execCommand('copy');el.remove(); }
      copiedUntil = performance.now() + 1800; $('#reviewStatus').textContent = 'Copied: ' + value;
    } catch { error = 'Clipboard unavailable. Select the time readout to copy it.'; }
  }
  function currentNote(time) { const i=notes.findIndex(n=>n.t+(n.dur||.2)>=time-.02); return i<0?null:{note:notes[i],index:i}; }
  function copyCurrent() { const current=currentNote(lastTime); return copy(current?.note,current?.index,lastTime); }
  $('#reviewPlay').onclick = onToggle;
  $('#reviewCamera').onclick = onCamera;
  $('#reviewCopy').onclick = copyCurrent;
  root.querySelectorAll('[data-step]').forEach(button => button.onclick = () => onSeek(grid.step(lastTime, Number(button.dataset.step))));
  root.querySelectorAll('[data-rate]').forEach(button => button.onclick = () => onRate(Number(button.dataset.rate)));
  $('#reviewLoop').onclick = onLoop;
  $('#reviewSfx').onclick = onSfx;
  // Seeking preserves the prior play/pause state. In-flight resumes are
  // generation-guarded by the transport, including rapid scrub input.
  scrubber.oninput = () => onSeek(Number(scrubber.value));
  $('.review-inspector-toggle').onclick = () => {open=!open;$('#reviewInspectorBody').hidden=!open;$('.review-inspector-toggle').setAttribute('aria-expanded',String(open));$('.review-inspector-toggle span').textContent=open?'−':'+';};
  function drawTimeline() {
    const width=$('.review-timeline').clientWidth, height=56, dpr=devicePixelRatio||1;
    canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const x=t=>t/duration*width;
    for(const section of chart.sections||[]){const sx=x(section.t),end=x(section.end??duration);ctx.fillStyle=['#222038','#173947','#472140','#534725'][section.level||0]||'#222038';ctx.fillRect(sx,0,end-sx,22);ctx.fillStyle='#bdbaca';ctx.font='10px "Chakra Petch",system-ui,sans-serif';if(end-sx>40)drawNumeralText(ctx,section.label.toUpperCase(),sx+5,14,{spacing:0,maxWidth:end-sx-8});}
    ctx.fillStyle='#29273f';ctx.fillRect(0,22,width,34);
    for(const note of notes){ctx.fillStyle=css(CUES[note.move]?.c||CUES.photo.c);const nx=x(note.t);if(note.move==='photo'){ctx.fillRect(nx-3,25,6,7);ctx.fillStyle='#fff1a0';ctx.fillRect(nx-1,23,2,3);}else{ctx.fillRect(nx,34,2,12);if(note.dur){ctx.globalAlpha=.4;ctx.fillRect(nx,37,Math.max(2,x(note.dur)),6);ctx.globalAlpha=1;}}}
    for(const cue of cameraCues){ctx.fillStyle='#9a94c7';const nx=x(cue.t);ctx.beginPath();ctx.moveTo(nx-3,53);ctx.lineTo(nx+3,53);ctx.lineTo(nx,48);ctx.fill();}
  }
  const observer = new ResizeObserver(drawTimeline); observer.observe($('.review-timeline'));drawTimeline();
  function renderNotes(time) {
    let start = notes.findIndex(n=>n.t+(n.dur||0)>=time-4);if(start<0)start=Math.max(0,notes.length-8);
    let end = start;while(end<notes.length&&notes[end].t<=time+8)end++;
    if(end<=start)end=Math.min(notes.length,start+3);
    const key=`${start}:${end}`;
    if(key!==lastWindow){lastWindow=key;for(let slot=0;slot<Math.max(pool.length,end-start);slot++){
      let row=pool[slot];if(!row){row=document.createElement('div');row.className='review-note';row.innerHTML='<button type="button" class="review-note-seek"><span class="review-note-number num"></span><span class="review-note-time"></span><span class="review-note-icon"></span><span class="review-note-move"></span></button><button type="button" class="review-note-copy" aria-label="Copy cue">⧉</button>';list.append(row);pool.push(row);row.querySelector('.review-note-seek').onclick=()=>onSeek(grid.step(row.note.t,-4));row.querySelector('.review-note-copy').onclick=()=>copy(row.note,row.index);}
      row.hidden=slot>=end-start;if(row.hidden)continue;const index=start+slot,note=notes[index],pos=grid.at(note.t);row.note=note;row.index=index;row.style.setProperty('--cue',css(CUES[note.move]?.c||CUES.photo.c));row.querySelector('.review-note-number').textContent=`#${index+1}`;row.querySelector('.review-note-time').innerHTML=`${formatTime(note.t,3)}<small>${numeralHTML(`${pos.bar}.${pos.beat}`)}</small>`;row.querySelector('.review-note-icon').innerHTML=icons[note.move]||'';row.querySelector('.review-note-move').innerHTML=`${escape(CUES[note.move]?.label || note.move)}${note.dur?`<small>${numeralHTML(note.dur.toFixed(2))} s</small>`:''}`;
    }}
    const next=notes.findIndex(n=>n.t>=time-.001);
    for(const row of pool){if(row.hidden)continue;row.classList.toggle('next',row.index===next);row.classList.toggle('current',row.note.t<=time&&time<=row.note.t+(row.note.dur||.25));}
  }
  return {
    grid,
    update(time) {
      lastTime=time;const state=getState(),pos=grid.at(time);scrubber.value=time;scrubber.setAttribute('aria-valuetext',`${formatTime(time,3)}, bar ${pos.bar}, beat ${pos.beat}`);$('.review-playhead').style.left=`${time/duration*100}%`;
      const band=$('.review-loop-band');band.hidden=!state.loop;if(state.loop){band.style.left=`${state.loop.start/duration*100}%`;band.style.width=`${(state.loop.end-state.loop.start)/duration*100}%`;}
      timeOutput.textContent=`${formatTime(time,3)} · bar ${pos.bar}.${pos.beat}`;
      $('#reviewPlay').textContent=state.playing||state.pending?'Ⅱ Pause':'▶ Play';root.classList.toggle('review-paused',!state.playing);
      root.querySelectorAll('[data-rate]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.rate)===state.rate)));
      $('#reviewLoop').setAttribute('aria-pressed',String(!!state.loop));$('#reviewLoop').innerHTML=numeralHTML(state.loop?`↻ Bars ${state.loop.bar}–${state.loop.endBar}`:'↻ Loop 4 bars');
      if(performance.now()>copiedUntil)$('#reviewStatus').textContent=error||(state.pending?'Starting audio…':state.playing?'Playing · pitch preserved':'Paused · press Play to listen');
      $('#reviewShot').textContent=cueAt(cameraCues,time)?.shot||'front';$('#reviewSection').textContent=cueAt(chart.sections,time)?.label||'intro';
      $('#reviewSfx').setAttribute('aria-pressed',String(state.sfx!==false));$('#reviewSfx').textContent=state.sfx===false?'SFX off':'SFX on';
      $('#reviewCamera').textContent=state.camera==='live'?'Camera live':state.camera==='requesting'?'Requesting camera…':'Enable camera';$('#reviewCamera').disabled=['live','requesting'].includes(state.camera);
      if(open)renderNotes(time);
    },
    error(message) {error=message||'';},
    keydown(e) {
      if(e.ctrlKey||e.metaKey||e.altKey||['TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
      const action={Space:onToggle,ArrowLeft:()=>onSeek(grid.step(lastTime,e.shiftKey?-4:-1)),ArrowRight:()=>onSeek(grid.step(lastTime,e.shiftKey?4:1)),KeyL:onLoop,KeyC:copyCurrent,BracketLeft:()=>onRate(REVIEW_RATES[Math.max(0,REVIEW_RATES.indexOf(getState().rate)-1)]),BracketRight:()=>onRate(REVIEW_RATES[Math.min(2,REVIEW_RATES.indexOf(getState().rate)+1)])}[e.code];
      if(action){e.preventDefault();if(!e.repeat||e.code.startsWith('Arrow'))action();}
    },
  };
}
