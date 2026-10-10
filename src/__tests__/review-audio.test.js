import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({base:null}));
vi.mock('../audio.js',()=>({createAudioPlayer:()=>mock.base}));
import {createReviewAudio} from '../review/audio.js';
function media(){const listeners=new Map();return {paused:true,ended:false,currentTime:0,duration:100,playbackRate:1,load:vi.fn(),removeAttribute:vi.fn(),pause:vi.fn(function(){this.paused=true;}),play:vi.fn(async function(){this.paused=false;}),addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);},fire(type){listeners.get(type)?.();}};}
beforeEach(()=>{
 const source={connect:vi.fn()},analyser={fftSize:256,connect:vi.fn(),getFloatTimeDomainData:array=>array.fill(.25)};
 const ctx={state:'running',currentTime:10,createMediaElementSource:vi.fn(()=>source),createAnalyser:()=>analyser};
 mock.base={ctx,musicBus:{name:'music'},musicVolume:.8,masterGain:{gain:{value:0}},resetMusicDuck:vi.fn(),unlock:vi.fn(async()=>true)};
 vi.spyOn(performance,'now').mockReturnValue(1000);
});
afterEach(()=>vi.restoreAllMocks());
async function ready(element){const audio=createReviewAudio({muted:true},{media:element}),loading=audio.load('/song.mp3');element.fire('loadedmetadata');await loading;return audio;}
describe('pitch-preserving review transport',()=>{
 it('clears music ducking on review pause, resume and seek',async()=>{const audio=await ready(media());mock.base.resetMusicDuck.mockClear();audio.pause();expect(mock.base.resetMusicDuck).toHaveBeenCalledOnce();await audio.resume();expect(mock.base.resetMusicDuck).toHaveBeenCalledTimes(2);audio.seek(50);expect(mock.base.resetMusicDuck).toHaveBeenCalledTimes(3);});
 it('loads media metadata even when context unlock is waiting for a gesture',async()=>{mock.base.unlock.mockImplementation(()=>new Promise(()=>{}));const el=media(),audio=await ready(el);expect(audio.duration).toBe(100);expect(mock.base.ctx.createMediaElementSource).toHaveBeenCalledWith(el);expect(el.preservesPitch).toBe(true);expect(el.webkitPreservesPitch).toBe(true);expect(mock.base.ctx.createMediaElementSource.mock.results[0].value.connect.mock.calls[0][0].connect).toHaveBeenCalledWith(mock.base.musicBus);expect(audio.masterGain.gain.value).toBe(0);});
 it('uses the media clock at every rate and freezes conversion during pause',async()=>{const el=media(),audio=await ready(el);audio.seek(60);audio.setRate(.5);expect(el.playbackRate).toBe(.5);await audio.resume();expect(audio.running).toBe(true);expect(audio.songTime()).toBe(60);expect(audio.perfToSongTime(1200)).toBeCloseTo(60.1);expect(audio.contextTimeForSong(61)).toBe(12);audio.pause();expect(audio.perfToSongTime(1200)).toBe(60);expect(audio.songTime()).toBe(60);});
 it('cancels a pending resume on seek and cleanly restarts from the new time',async()=>{const el=media(),audio=await ready(el);let release;mock.base.unlock.mockImplementationOnce(()=>new Promise(resolve=>release=resolve));const old=audio.resume();audio.seek(83.4);release();await old;expect(el.play).not.toHaveBeenCalled();await audio.resume();expect(el.play).toHaveBeenCalledOnce();expect(audio.songTime()).toBe(83.4);audio.seek(200);expect(audio.songTime()).toBe(100);expect(audio.running).toBe(false);});
 it('samples the same music bus for quiet non-melodic SFX and validates rate',async()=>{const audio=await ready(media());expect(audio.musicLevel()).toBe(0);await audio.resume();expect(audio.musicLevel()).toBeCloseTo(.2);audio.setRate(.75);expect(audio.rate).toBe(.75);audio.setRate(2);expect(audio.rate).toBe(1);audio.stop();expect(audio.songTime()).toBe(0);expect(audio.running).toBe(false);});
});
