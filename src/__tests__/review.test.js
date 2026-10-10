import {describe,it,expect} from 'vitest';
import {createBeatGrid,createSeekState,reviewCopy,reviewRate,reviewLink} from '../review/logic.js';
import {formatTime} from '../time.js';
import {createPhotoCueScheduler} from '../game/photo-cues.js';
import {createShotScheduler,SHOTS} from '../engine/shots.js';
const chart={bpm:120,beats:[.1,.5,.95,1.43,1.94,2.5,3.03,3.59,4.12,4.7,5.3,5.88,6.49,7.1],downbeats:[.5,2.5,4.7,7.1]};
describe('review beat grid',()=>{
  const grid=createBeatGrid(chart,10);
  it('anchors the first bar to a downbeat, ignoring the pickup',()=>{expect(grid.at(.5)).toMatchObject({bar:1,beat:1});expect(grid.at(.1)).toMatchObject({bar:0,beat:4});expect(grid.at(2.5)).toMatchObject({bar:2,beat:1});});
  it('maps measured beats and fractional beats both ways as tempo drifts',()=>{expect(grid.time(2,3)).toBe(3.59);expect(grid.at(5.88)).toMatchObject({bar:3,beat:3});for(const t of [.1,.5,1.29,2.5,3.75,5.88,8.9])expect(grid.beatTime(grid.beatPosition(t))).toBeCloseTo(t,7);});
  it('steps by beats/bars while retaining the within-beat fraction',()=>{expect(grid.step(1.43,1)).toBeCloseTo(1.94);expect(grid.step(.5,4)).toBeCloseTo(2.5);expect(grid.step(2.5,-4)).toBeCloseTo(.5);expect(grid.step(.1,-4)).toBe(0);expect(grid.step(9.9,4)).toBe(10);});
  it('follows downbeats if beats are missing, and BPM if the entire grid is missing',()=>{expect(createBeatGrid({bpm:60,downbeats:[1,5.2]},10).time(1,3)).toBeCloseTo(3.1);expect(createBeatGrid({bpm:120,offset:.25},10).time(2,1)).toBeCloseTo(2.25);});
  it('uses four measured bars, clamps the tail, and never loops a pickup',()=>{const long=createBeatGrid(chart,20);expect(long.loop(2.7)).toMatchObject({start:2.5,bar:2,endBar:5});expect(long.loop(2.7).end).toBeCloseTo(long.time(6));expect(grid.loop(7.2).end).toBe(10);expect(grid.loop(0).start).toBe(.5);const exact=createBeatGrid({bpm:120},10).loop(10);expect(exact.start).toBe(8);expect(exact.end).toBe(10);});
});
describe('review seek reset',()=>{
  it('creates fresh notes and excludes stale judgements/photos from the new judge',()=>{
    const source=[{t:1,move:'up',judged:true,uiProgress:.6,botOffset:.2},{t:2,move:'photo',photoTaken:true},{t:3,move:'sweep',dur:1.3,uiResult:'miss'}];
    const first=createSeekState(source,2.5);expect(first.notes).toEqual([{t:3,move:'sweep',dur:1.3}]);expect(first.visualNotes[0].uiResult).toBe('good');expect(first.resolved.size).toBe(0);expect(first.botCursor).toBe(0);expect(first.botMove).toBeNull();
    first.notes[0].judged=true;const again=createSeekState(source,0);expect(again.notes).toHaveLength(2);expect(again.notes.every(n=>!n.judged)).toBe(true);expect(again.notes[0]).not.toBe(first.visualNotes[0]);expect(source[0].judged).toBe(true);
  });
  it('keeps an active sweep while dropping completed cues on seek',()=>{const state=createSeekState([{t:1,move:'down'},{t:2,move:'sweep',dur:2},{t:5,move:'clap'}],3);expect(state.notes.map(n=>n.move)).toEqual(['sweep','clap']);expect(state.notes[0].uiResult).toBeUndefined();expect(state.notes[0].uiProgress).toBeUndefined();});
  it('hard sets the new camera shot inside an unfinished glide, then freezes it',()=>{
    const shots=createShotScheduler({bpm:120,camera:[{t:0,shot:'front',ease:0},{t:10,shot:'wide',ease:4}]});
    const gliding=structuredClone(shots.sample(10));expect(Math.abs(gliding.pos[2]-SHOTS.front.pos[2])).toBeLessThan(.2);
    const cut=structuredClone(shots.seek(10));expect(cut.pos[2]).toBe(SHOTS.wide.pos[2]);shots.pause(10);expect(shots.sample(12)).toEqual(cut);shots.resume();expect(shots.sample(11).pos[2]).toBe(SHOTS.wide.pos[2]);shots.reset();expect(shots.sample(10)).toEqual(gliding);
  });
  it('fires a loop-boundary photo once, including a shutter without pre-countdown',()=>{let sounds=0,snaps=0;const photo=createPhotoCueScheduler([{t:10,move:'photo'}],{onSchedule:()=>sounds++,onSnap:()=>snaps++});photo.reset(10,true);photo.update(10,false,0);photo.update(10.01,true,.01);photo.update(10.02,true,.02);expect(snaps).toBe(1);expect(sounds).toBe(1);});
  it('never re-fires a photo/shutter on seek, but permits it after seeking back',()=>{
    let snaps=0,sounds=0;const cue={t:10,move:'photo'},photo=createPhotoCueScheduler([cue],{onSnap:()=>snaps++,onSchedule:()=>{sounds++;}});
    photo.reset(10);photo.update(10,true);photo.update(11,true);expect(snaps).toBe(0);expect(sounds).toBe(0);
    photo.reset(8);photo.update(9,true,0);photo.update(10,true,1);photo.update(10.1,true,1.1);expect(snaps).toBe(1);expect(sounds).toBe(1);
  });
});
describe('review copy and URL helpers',()=>{
  it('formats precise timestamp, bar, indexed cue, sweep duration and camera context',()=>{
    const grid=createBeatGrid({bpm:96,offset:.331},200);
    expect(reviewCopy({songId:'wawa-hero',time:83.456,grid,note:{move:'clap'},index:56})).toBe('wawa-hero @ 1:23.456 · bar 34.2 · note #57 clap');
    expect(reviewCopy({songId:'system-online',time:83.456,grid,note:{move:'sweep',dur:1.31},index:56,camera:'drop'})).toBe('system-online @ 1:23.456 · bar 34.2 · note #57 sweep (sweep dur 1.31) · camera drop');
  });
  it('rounds catalog durations everywhere and carries milliseconds across minutes',()=>{expect(formatTime(105.96)).toBe('1:46');expect(formatTime(59.9996,3)).toBe('1:00.000');expect(formatTime(83.456,3)).toBe('1:23.456');expect(formatTime(NaN)).toBe('0:00');});
  it('validates speed and preserves muted/offline flags in review links',()=>{expect(reviewRate('.75')).toBe(.75);expect(reviewRate(4)).toBe(1);const link=reviewLink(new URLSearchParams('review&mute&offline&t=50&state=play&shot=close'),'wawa-hero');const p=new URLSearchParams(link.slice(1));expect(p.has('mute')).toBe(true);expect(p.has('offline')).toBe(true);expect(p.get('song')).toBe('wawa-hero');expect(p.has('t')).toBe(false);expect(p.has('shot')).toBe(false);});
});
