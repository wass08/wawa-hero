import { describe, expect, it, vi } from 'vitest';
import { createSfx,playJudgementSfx,SFX_SOUNDS,makeSfxBuffer } from '../sfx.js';
import {createPhotoCueScheduler} from '../game/photo-cues.js';
function setup(){
 const sources=[],gains=[],panners=[],ctx={currentTime:5,sampleRate:48000,state:'running',
  createBuffer:(_,size)=>({getChannelData:()=>new Float32Array(size)}),
  createBufferSource:()=>{const node={connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};sources.push(node);return node;},
  createGain:()=>{const node={gain:{setValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};gains.push(node);return node;},
  createStereoPanner:()=>{const node={pan:{setValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};panners.push(node);return node;},
 };
 const audio={ctx,sfxBus:{},musicLevel:()=>.2,duckMusic:vi.fn(),resetMusicDuck:vi.fn(),setSfxEnabled(value){this.sfxEnabled=value;}};return {sources,gains,panners,audio,sfx:createSfx(audio)};
}
describe('procedural SFX',()=>{
 it('keeps menu, countdown and photo sounds, with no hit or sweep definitions',()=>{expect(Object.keys(SFX_SOUNDS)).toEqual(['tick','confirm','back','three','two','one','go','miss','shutter']);});
 it('uses a 200 ms detuned error buzzer on the shared clock and bus',()=>{
  const {sfx,sources,gains,panners,audio}=setup();sfx.miss({at:6.125});expect(sources[0].buffer).toBeDefined();expect(sources[0].start).toHaveBeenCalledWith(6.125);expect(panners[0].connect).toHaveBeenCalledWith(audio.sfxBus);
  expect(gains[0].gain.setValueAtTime.mock.calls[0][0]).toBeCloseTo(.2*10**(-10/20)*Math.SQRT2/.7);expect(SFX_SOUNDS.miss.dur).toBe(.20);
  expect(audio.duckMusic).toHaveBeenCalledExactlyOnceWith({at:6.125,players:1});
 });
 it.each([[1,0,0],[2,0,-.65],[2,1,.65]])('uses %sP player %s pan %s', (players,player,pan)=>{const {sfx,panners,audio}=setup();sfx.miss({player,players});expect(panners[0].pan.setValueAtTime).toHaveBeenCalledExactlyOnceWith(pan,5.003);expect(audio.duckMusic).toHaveBeenCalledExactlyOnceWith({at:5.003,players});});
 it('normalises filtered envelopes to unit RMS before the final gain',()=>{
  const context={sampleRate:48000,createBuffer:(_,size)=>{const data=new Float32Array(size);return {getChannelData:()=>data};}};
  for(const sound of Object.values(SFX_SOUNDS)){const data=makeSfxBuffer(context,sound).getChannelData(0);expect(Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length)).toBeCloseTo(1,5);expect(Math.max(...data.map(Math.abs))).toBeLessThan(sound.kind==='shutter'?7:4);}
 });
 it('schedules feedback upstream of the mute master even during a silent-clock demo',()=>{const {sfx,audio,sources}=setup();audio.musicLevel=()=>0;audio.muted=true;sfx.miss();expect(sources).toHaveLength(1);expect(sfx.counts.miss.scheduled).toBe(1);});
 it('schedules countdown 3-2-1-GO and cancels queued voices together',()=>{const {sfx,sources}=setup();sfx.countdown();expect(sources.map(s=>s.start.mock.calls[0][0])).toEqual([5.003,5.8,6.6,7.4]);sfx.cancel();expect(['three','two','one','go'].every(name=>sfx.counts[name].cancelled===1)).toBe(true);});
 it('review off suppresses the clunk AND duck and clears pending feedback',()=>{const {sfx,audio,sources}=setup(),bus=audio.sfxBus;sfx.setEnabled(false);sfx.miss();expect(sources).toHaveLength(0);expect(audio.duckMusic).not.toHaveBeenCalled();expect(audio.resetMusicDuck).toHaveBeenCalledOnce();sfx.setEnabled(true);sfx.miss();expect(sources).toHaveLength(1);expect(audio.sfxBus).toBe(bus);});
 it('does not start feedback on a suspended real context',()=>{const {sfx,audio,sources}=setup();audio.ctx.state='suspended';sfx.miss();expect(sources).toHaveLength(0);expect(audio.duckMusic).not.toHaveBeenCalled();});
 it('a shared photo cue still triggers exactly one timed shutter, without a duck',()=>{
  const {sfx,audio,sources}=setup(),snaps=vi.fn(),scheduler=createPhotoCueScheduler([{t:10,move:'photo'}],{onSchedule:cue=>sfx.play('shutter',cue.t),onSnap:snaps});
  for(const time of [8.5,9,9.5,10,10.1,10.5])scheduler.update(time);
  expect(sfx.counts.shutter.scheduled).toBe(1);expect(sources).toHaveLength(1);expect(sources[0].start).toHaveBeenCalledWith(10);expect(snaps).toHaveBeenCalledOnce();expect(audio.duckMusic).not.toHaveBeenCalled();
 });
});
describe('judge to miss-only feedback',()=>{
 it.each([['up','perfect'],['clap','good'],['down','miss'],['sweep','perfect'],['sweep','good'],['sweep','miss']])('commits %s %s once; only misses make feedback', (move,result)=>{
  const {sfx,audio,sources}=setup(),note={t:4,dur:2,move},resolved=new Set();
  expect(playJudgementSfx(sfx,audio,{note,result:null,progress:.5},resolved)).toBe(false);
  expect(playJudgementSfx(sfx,audio,{note,result,held:true,source:'camera:1'},resolved,{player:1,players:2})).toBe(true);
  expect(playJudgementSfx(sfx,audio,{note,result},resolved)).toBe(false);
  expect(sources).toHaveLength(result==='miss'?1:0);expect(audio.duckMusic).toHaveBeenCalledTimes(result==='miss'?1:0);
 });
 it('photos, unknown results and progress never make judgement sounds',()=>{const sfx={miss:vi.fn()},audio={},resolved=new Set();for(const j of [{note:{move:'photo'},result:'miss'},{note:{move:'sweep'},result:null},{note:{move:'up'},result:'other'}])expect(playJudgementSfx(sfx,audio,j,resolved)).toBe(false);expect(sfx.miss).not.toHaveBeenCalled();expect(resolved.size).toBe(0);});
 it('separate player note identities each miss once, including a fresh restart',()=>{const sfx={miss:vi.fn()},resolved=new Set(),audio={ctx:{currentTime:1}};for(let i=0;i<3;i++){const j={note:{move:'clap'},result:'miss'};playJudgementSfx(sfx,audio,j,resolved);playJudgementSfx(sfx,audio,j,resolved);}expect(sfx.miss).toHaveBeenCalledTimes(3);});
});
