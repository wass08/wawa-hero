import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioPlayer } from '../audio.js';
let sources;
class Context {
  currentTime = 0; outputLatency = 0.1; state = 'running'; destination = {};
  createGain() { return { gain: { value: 1, setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),cancelScheduledValues:vi.fn() }, connect: vi.fn(),disconnect:vi.fn() }; }
  createBufferSource() { const s = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() }; sources.push(s); return s; }
  resume() { return Promise.resolve(); }
  decodeAudioData() { return Promise.resolve({ duration: 10 }); }
}
beforeEach(() => { sources=[];vi.stubGlobal('AudioContext',Context);vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}))); });
afterEach(()=>vi.unstubAllGlobals());

describe('audio clock regressions',()=>{
  it('defaults to an audible 70% SFX bus and 80% music through one shared master',async()=>{
    const audio=createAudioPlayer();await audio.unlock();expect(audio.sfxBus.gain.value).toBe(.7);expect(audio.musicBus.gain.value).toBe(.8);expect(audio.sfxBus.connect).toHaveBeenCalledExactlyOnceWith(audio.masterGain);const bus=audio.sfxBus;audio.setSfxEnabled(false);expect(bus.gain.value).toBe(0);audio.setSfxEnabled(true);expect(audio.sfxBus).toBe(bus);expect(bus.gain.value).toBe(.7);
  });
  it('resumes the buffer transport without subtracting output latency twice (#2)',async()=>{
    const audio=createAudioPlayer();await audio.load('song');audio.play();
    audio.ctx.currentTime=5;expect(audio.songTime()).toBeCloseTo(4.9);
    audio.pause();expect(audio.songTime()).toBeCloseTo(4.9);
    audio.ctx.currentTime=8;await audio.resume();
    expect(sources[1].start).toHaveBeenCalledWith(0,5);
    expect(audio.songTime()).toBeCloseTo(4.9);
    audio.ctx.currentTime=9;audio.pause();expect(audio.songTime()).toBeCloseTo(5.9);
    audio.ctx.currentTime=12;await audio.resume();
    expect(sources[2].start).toHaveBeenCalledWith(0,6);
    expect(audio.songTime()).toBeCloseTo(5.9);
  });
  it('ignores removed calibration options and follows heard playback (#5)',async()=>{
    const audio=createAudioPlayer({calibrationMs:-1000});await audio.load('song');audio.play();
    audio.ctx.currentTime=9.1;
    expect(audio.songTime()).toBeCloseTo(9);expect(audio.playbackTime()).toBeCloseTo(9);
    expect(audio.playbackTime()).toBeLessThan(audio.duration);
    audio.ctx.currentTime=10.1;expect(audio.playbackTime()).toBeCloseTo(audio.duration);
  });
  it('discards cached audio when replacement fetching or decoding fails (#9)',async()=>{
    const audio=createAudioPlayer();await audio.load('song');
    fetch.mockResolvedValueOnce({ok:false});await expect(audio.load('missing')).rejects.toThrow();
    expect(audio.duration).toBe(0);expect(audio.play()).toBe(false);
    await audio.load('song');vi.spyOn(audio.ctx,'decodeAudioData').mockRejectedValueOnce(Error('bad decode'));
    await expect(audio.load('broken')).rejects.toThrow('bad decode');expect(audio.duration).toBe(0);
  });
  it('does not install a decoded buffer from a cancelled load',async()=>{
    const audio=createAudioPlayer();let finish;
    const request=new Promise(r=>{finish=r;});fetch.mockReturnValueOnce(request);
    const load=audio.load('song');audio.cancelLoad();finish({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
    await load;expect(audio.duration).toBe(0);
  });
  it('routes every source through zero master gain when muted',async()=>{
    const audio=createAudioPlayer({muted:true});await audio.load('song');audio.play();
    expect(audio.masterGain.gain.value).toBe(0);expect(sources[0].connect).toHaveBeenCalledWith(audio.musicBus);
    expect(audio.musicBus.connect).toHaveBeenCalledWith(audio.masterGain);expect(audio.sfxBus.connect).toHaveBeenCalledWith(audio.masterGain);
  });
  it('maps performance frames without a user calibration offset',async()=>{
    const audio=createAudioPlayer({calibrationMs:120});await audio.load('song');audio.play();audio.ctx.currentTime=5;
    vi.spyOn(performance,'now').mockReturnValue(5000);
    expect(audio.perfToSongTime(4900)).toBeCloseTo(4.8);vi.restoreAllMocks();
  });
  it('shares a decode between preview and gameplay, with native loop bounds and fades',async()=>{
    const audio=createAudioPlayer({muted:true});const decode=vi.spyOn(Context.prototype,'decodeAudioData');
    const [first,second]=await Promise.all([audio.getBuffer('loop'),audio.getBuffer('loop')]);expect(first).toBe(second);
    audio.preview(first,{start:3,dur:4});const voice=sources[0],gain=voice.connect.mock.calls[0][0];
    expect(voice.loop).toBe(true);expect(voice.loopStart).toBe(3);expect(voice.loopEnd).toBe(7);expect(voice.start).toHaveBeenCalledWith(0,3);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1,0.8);
    const fading=audio.stopPreview();expect(voice.stop).toHaveBeenCalledWith(0.6);expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0,0.6);
    await audio.load('loop');expect(fetch).toHaveBeenCalledOnce();expect(decode).toHaveBeenCalledOnce();await fading;decode.mockRestore();
  });
  it('maps cue times to the context transport clock across a pause and seek',async()=>{
    const audio=createAudioPlayer({calibrationMs:120});await audio.load('song');audio.play();audio.ctx.currentTime=5;
    expect(audio.contextTimeForSong(6)).toBeCloseTo(6);audio.pause();audio.ctx.currentTime=9;await audio.resume();
    expect(audio.contextTimeForSong(6)).toBeCloseTo(10);audio.seek(2);expect(audio.playbackTime()).toBeCloseTo(1.9);
    expect(audio.contextTimeForSong(3)).toBeCloseTo(10);
  });
  it('invalidates a resume that finishes after the page pauses again',async()=>{
    const audio=createAudioPlayer();await audio.load('song');audio.play();audio.pause();let finish;
    vi.spyOn(audio.ctx,'resume').mockReturnValueOnce(new Promise(r=>{finish=r;}));
    const resume=audio.resume();audio.pause();finish();await resume;expect(audio.running).toBe(false);expect(sources).toHaveLength(1);
  });
  it('immediate teardown also silences older fading preview voices',async()=>{
    const audio=createAudioPlayer();const buffer=await audio.getBuffer('song');
    audio.preview(buffer,{start:3,dur:4});audio.preview(buffer,{start:4,dur:4});
    await audio.stopPreview(0);
    for(const source of sources){expect(source.stop).toHaveBeenLastCalledWith(0);const gain=source.connect.mock.calls[0][0];expect(gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0,0);}
  });
});
