import {it,expect,vi} from 'vitest';
import {createMusicDuck,DUCK} from '../music-duck.js';
import {createAudioPlayer} from '../audio.js';
it.each([1,2])('schedules one %sP dip with 30 ms attack, 150 ms hold and 500 ms recovery',players=>{
 const ctx={currentTime:5},param={cancelScheduledValues:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()},duck=createMusicDuck(ctx,param,()=>.8),target=10**((players===2?-3.5:-6)/20);
 duck.trigger({players});expect(param.cancelScheduledValues).toHaveBeenCalledExactlyOnceWith(5);expect(param.setValueAtTime.mock.calls[0]).toEqual([.8,5]);expect(param.setValueAtTime.mock.calls[1][0]).toBeCloseTo(.8*target);expect(param.setValueAtTime.mock.calls[1][1]).toBeCloseTo(5.18);expect(param.linearRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(.8*target);expect(param.linearRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(5.03);expect(param.linearRampToValueAtTime.mock.calls[1][0]).toBe(.8);expect(param.linearRampToValueAtTime.mock.calls[1][1]).toBeCloseTo(5.68);
 for(const [t,value] of [[0,1],[.03,target],[.18,target],[.7,1]])expect(duck.gainAt(5+t)).toBeCloseTo(value);
});
it('re-triggers continuously without accumulating attenuation, clamps above −9 dB, and recovers',()=>{
 const ctx={currentTime:0},param={cancelScheduledValues:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()},duck=createMusicDuck(ctx,param);
 for(let i=0;i<100;i++){ctx.currentTime=i*.02;const before=duck.gainAt(ctx.currentTime);duck.trigger();expect(duck.gainAt(ctx.currentTime)).toBeCloseTo(before);expect(duck.gainAt(ctx.currentTime+.03)).toBeGreaterThanOrEqual(10**(DUCK.minDb/20));}
 expect(duck.gainAt(ctx.currentTime+.7)).toBe(1);duck.reset();expect(param.cancelScheduledValues).toHaveBeenLastCalledWith(ctx.currentTime);expect(param.setValueAtTime).toHaveBeenLastCalledWith(1,ctx.currentTime);expect(duck.gainAt(ctx.currentTime)).toBe(1);
});
it.each(['pause','seek','stop','resume','off'])('%s mid-duck restores the music gain and cancels recovery automation',async action=>{
 const param=()=>({value:1,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),cancelScheduledValues:vi.fn()}),ctx={currentTime:0,state:'running',destination:{},createGain:()=>({gain:param(),connect:vi.fn()}),resume:async()=>{}};
 vi.stubGlobal('AudioContext',function(){return ctx;});
 try{const audio=createAudioPlayer();await audio.unlock();audio.duckMusic();ctx.currentTime=.1;expect(audio.musicDuckGain()).toBeCloseTo(10**(-6/20));
  if(action==='off')audio.setSfxEnabled(false);else if(action==='seek')audio.seek(12);else await audio[action]();
  expect(audio.musicDuckGain()).toBe(1);expect(audio.musicBus.gain.cancelScheduledValues).toHaveBeenLastCalledWith(.1);expect(audio.musicBus.gain.setValueAtTime).toHaveBeenLastCalledWith(.8,.1);
 }finally{vi.unstubAllGlobals();}
});
