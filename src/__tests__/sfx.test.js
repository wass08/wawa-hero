import { describe, expect, it, vi } from 'vitest';
import { createSfx } from '../sfx.js';
function setup() {
  const sources=[],gains=[],filters=[],param=()=>({value:0,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()});
  const ctx={currentTime:5,sampleRate:48000,state:'running',
    createBuffer:()=>({getChannelData:()=>new Float32Array(33600)}),
    createBufferSource:()=>{const node={connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};sources.push(node);return node;},
    createGain:()=>{const node={gain:param(),connect:vi.fn(),disconnect:vi.fn()};gains.push(node);return node;},
    createBiquadFilter:()=>{const node={frequency:param(),Q:param(),connect:vi.fn(),disconnect:vi.fn()};filters.push(node);return node;},
  };
  const audio={ctx,sfxBus:{},musicLevel:()=>0.2};return {sources,gains,filters,audio,sfx:createSfx(audio)};
}
describe('procedural SFX',()=>{
  it('uses only noise through the SFX bus and schedules at precise context times',()=>{
    const {sfx,sources,gains,filters,audio}=setup();sfx.play('perfect',6.125);
    expect(sources[0].buffer).toBeDefined();expect(sources[0].start).toHaveBeenCalledWith(6.125);expect(filters[0].type).toBe('highpass');
    expect(gains[0].connect).toHaveBeenCalledWith(audio.sfxBus);expect(gains[0].gain.linearRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(0.008);
  });
  it('caps miss below measured music, keeps good quieter and perfect brighter',()=>{
    const {sfx,gains,filters}=setup();sfx.play('miss');sfx.play('good');sfx.play('perfect');
    expect(gains[0].gain.linearRampToValueAtTime.mock.calls[0][0]).toBe(0.05);
    expect(filters[0].type).toBe('lowpass');expect(filters[2].frequency.setValueAtTime.mock.calls[0][0]).toBeGreaterThan(filters[1].frequency.setValueAtTime.mock.calls[0][0]);
    expect(gains[1].gain.linearRampToValueAtTime.mock.calls[0][0]).toBeLessThan(gains[0].gain.linearRampToValueAtTime.mock.calls[0][0]);
  });
  it('makes in-song effects silent when music is silent',()=>{
    const {sfx,sources,audio}=setup();audio.musicLevel=()=>0;sfx.play('miss');sfx.play('sweep');expect(sources).toHaveLength(0);
  });
  it('schedules four distinct countdown sounds and cancels them together',()=>{
    const {sfx,sources,filters}=setup();sfx.countdown();
    expect(sources.map(s=>s.start.mock.calls[0][0])).toEqual([5.003,5.8,6.6,7.4]);
    expect(new Set(filters.map(f=>f.frequency.setValueAtTime.mock.calls[0][0])).size).toBe(3);sfx.cancel();
    expect(sources.every(s=>s.stop.mock.calls.some(call=>call.length===0))).toBe(true);
  });
});
