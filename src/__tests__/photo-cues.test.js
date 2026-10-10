import {afterEach,describe,expect,it,vi} from 'vitest';
import {createPhotoCueScheduler,photoCountdown} from '../game/photo-cues.js';
import {createHeroCollector,selectRunShots,canvasBlob,renderStrip} from '../game/photos.js';
import {photoUploadAllowed,imageExtension,sweepMissTip,postedRank} from '../game/posting.js';
import {cloneNotes} from '../game/versus.js';
import {MOVE_IDS,ICONS} from '../moves.js';
import * as countryData from '../net/countries.js';
import {createBoardClient} from '../services/scoreboard.js';
import {loadChart} from '../charts.js';
const photo=t=>({t,move:'photo'}),blob=type=>new Blob(['image'],{type:type||'image/webp'});
afterEach(()=>vi.unstubAllGlobals());
describe('free photo cues',()=>{
  it('counts three dots down on beats, only within the 1.5 second lead',()=>{expect(photoCountdown(10,8.49,120)).toBe(null);expect(photoCountdown(10,8.5,120)).toBe(3);expect(photoCountdown(10,9,120)).toBe(2);expect(photoCountdown(10,9.5,120)).toBe(1);expect(photoCountdown(10,10,120)).toBe(null);});
  it('keeps the 13×11 camera icon separate from the six judged moves',()=>{expect(MOVE_IDS).not.toContain('photo');expect(ICONS.photo).toHaveLength(11);expect(ICONS.photo.every(row=>row.length===13)).toBe(true);});
  it('preserves chart photo notes while each player receives only move notes',async()=>{
    const notes=[photo(65.046),{t:1,move:'up'},{t:2,move:'unknown'}];vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({notes})})));
    const chart=await loadChart({charts:{normal:'chart.json'}});expect(chart.notes.map(n=>n.move)).toEqual(['up','photo']);expect(cloneNotes(chart.notes).map(n=>n.move)).toEqual(['up']);
  });
  it('schedules one shutter at the cue timestamp and snaps once on crossing',()=>{
    const schedule=vi.fn(),pose=vi.fn(),snap=vi.fn(),n=photo(65.046),s=createPhotoCueScheduler([{t:1,move:'up'},n],{bpm:126,onSchedule:schedule,onPose:pose,onSnap:snap});
    expect(s.update(63.6)).toBe(3);s.update(64);s.update(65);expect(schedule).toHaveBeenCalledOnce();expect(schedule).toHaveBeenCalledWith(n);expect(pose).toHaveBeenCalledOnce();expect(snap).not.toHaveBeenCalled();
    s.update(65.046);s.update(65.1);s.update(64);s.update(65.046);expect(snap).toHaveBeenCalledExactlyOnceWith(n);
    s.reset();s.update(64);s.update(65.046);expect(snap).toHaveBeenCalledTimes(2);
  });
  it('cancels a pending shutter during pause and reschedules at the same song time on resume',()=>{
    const stop=vi.fn(),schedule=vi.fn(()=>({stop})),snap=vi.fn(),s=createPhotoCueScheduler([photo(10)],{onSchedule:schedule,onSnap:snap});
    s.update(8.6);s.suspend();s.update(8.6,false);expect(stop).toHaveBeenCalledOnce();expect(snap).not.toHaveBeenCalled();s.update(8.6);expect(schedule).toHaveBeenCalledTimes(2);s.update(10);expect(snap).toHaveBeenCalledOnce();
  });
  it('still captures after a long render stall, rather than treating elapsed time as a seek',()=>{const snap=vi.fn(),s=createPhotoCueScheduler([photo(10)],{onSnap:snap});s.update(9,true,0);s.update(12,true,3);expect(snap).toHaveBeenCalledOnce();});
  it('does not create a backlog of snapshots after forward seeks',()=>{
    const snap=vi.fn(),s=createPhotoCueScheduler([photo(10),photo(30)],{onSnap:snap});s.update(0);s.update(29);expect(snap).not.toHaveBeenCalled();s.update(30);expect(snap).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({t:30}));
  });
  it('prioritizes cue captures and orders them by chart time despite encoding completion order',async()=>{
    const resolvers=[],capture=vi.fn(()=>new Promise(resolve=>resolvers.push(resolve))),h=createHeroCollector({capture});const cues=[65.046,122.189,139.332,160.284].map(photo);h.reset(126,cues);
    h.offer({t:30,quality:999});for(const cue of cues)h.photo({t:cue.t,realCamera:true});h.photo({t:cues[0].t});expect(capture).toHaveBeenCalledTimes(4);
    resolvers.reverse().forEach(resolve=>resolve(blob()));const shots=await h.finish();expect(shots.map(s=>s.t)).toEqual(cues.map(n=>n.t));expect(shots.every(s=>s.photo&&s.realCamera)).toBe(true);
  });
  it('tops up missing cues without replacing them with higher-quality automatic candidates',()=>{
    const shot=(t,quality)=>({t,quality,blob:blob()});const cues=[shot(65,1),shot(125,1)],candidates=[shot(64,999),shot(35,4),shot(95,6),shot(160,2)];const shots=selectRunShots(cues,candidates);expect(shots.map(s=>s.t)).toEqual([35,65,95,125]);expect(shots).toHaveLength(4);
  });
});
describe('photo export and posting integration',()=>{
  it('uses the backend SVG badge when flag emojis are unsupported',async()=>{
    vi.stubGlobal('document',{createElement:tag=>({tag})});const board=await createBoardClient(new URLSearchParams('?fakeboard'),{countryLoader:async()=>({...countryData,emojiFlagsSupported:()=>false})});const flag=board.flagElement('JP');expect(flag.tag).toBe('img');expect(flag.src).toMatch(/^data:image\/svg\+xml/);expect(flag.alt).toBe('JP');expect(board.flag('JP')).toBe('JP');
  });
  it('retains Safari PNG blobs for download while blocking photo uploads',async()=>{
    const png=blob('image/png'),canvas={toBlob:vi.fn(callback=>callback(png))};expect(await canvasBlob(canvas)).toBe(png);expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function),'image/webp',.8);expect(imageExtension(png)).toBe('png');expect(photoUploadAllowed([{realCamera:true,blob:png}])).toBe(false);expect(photoUploadAllowed([{realCamera:true,blob:blob()}])).toBe(true);expect(photoUploadAllowed([{realCamera:false,blob:blob()}])).toBe(false);
  });
  it('includes song, stars and an SVG flag in the downloadable strip',async()=>{
    const ctx=Object.fromEntries(['fillRect','fillText','drawImage','strokeRect','beginPath','moveTo','lineTo','closePath','fill'].map(k=>[k,vi.fn()]));const canvas={getContext:()=>ctx,toBlob:callback=>callback(blob())};vi.stubGlobal('document',{createElement:()=>canvas});
    vi.stubGlobal('Image',class{set src(value){this.url=value;queueMicrotask(()=>this.onload());}});
    const shots=[1,2,3,4].map(t=>({t,blob:blob()}));vi.stubGlobal('createImageBitmap',vi.fn(async()=>({close:vi.fn()})));
    const strip=await renderStrip(shots,{name:'Pixel',flagUrl:'data:image/svg+xml,flag',song:'System Online',score:4200,stars:2,kcal:12.8,date:new Date('2026-10-10')});
    expect(strip.type).toBe('image/webp');expect(ctx.fillText.mock.calls.map(c=>c[0])).toContain('System Online');expect(ctx.fill).toHaveBeenCalledTimes(3);expect(ctx.drawImage).toHaveBeenCalledTimes(5);
  });
  it('uses backend ranks, including a player best that supersedes the newly posted row',()=>{
    const entry={player_name:'Kai',country:'JP'};
    expect(postedRank([{id:'new',rank:5}], 'new',entry)).toBe(5);
    expect(postedRank([{id:'best',player_name:'Kai',country:'JP',rank:3}], 'new',entry)).toBe(3);
    expect(postedRank([{id:'other',player_name:'Kai',country:'US'}], 'new',entry)).toBeNull();
    const failed=[];failed.error=Error('Unavailable');expect(()=>postedRank(failed,'new',entry)).toThrow('Unavailable');
  });
  it.each([['no-high','Start with arms up high!'],['no-low','Finish with arms down by your sides!'],['wrong-direction','Lower your arms out to your own sides!']])('explains sweep misses: %s',(reason,tip)=>expect(sweepMissTip(reason)).toBe(tip));
});
