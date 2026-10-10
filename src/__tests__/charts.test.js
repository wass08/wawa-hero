import {afterEach,describe,expect,it,vi} from 'vitest';
import {loadCatalog,loadChart} from '../charts.js';
afterEach(()=>vi.unstubAllGlobals());
const song={id:'song',bpm:120,duration:90,chart:'songs/song/chart.json',charts:{normal:'songs/song/charts/normal.json'}};
const chart={notes:[{t:4,move:'clap'},{t:3,move:'photo'}],bpm:120};
describe('single chart catalogs',()=>{
  it('catalog fallback does not invent an artist',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));expect((await loadCatalog())[0]).not.toHaveProperty('artist');});
  it('prefers the new chart field and retains photo cues',async()=>{
    const fetch=vi.fn(async()=>({ok:true,json:async()=>chart}));vi.stubGlobal('fetch',fetch);
    const loaded=await loadChart(song);expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/songs/song/chart.json');expect(loaded.notes.map(n=>n.move)).toEqual(['photo','clap']);
  });
  it('uses charts.normal for an old catalog, never easy',async()=>{
    const fetch=vi.fn(async()=>({ok:true,json:async()=>chart}));vi.stubGlobal('fetch',fetch);
    await loadChart({...song,chart:undefined});expect(fetch.mock.calls[0][0]).toBe('/songs/song/charts/normal.json');
  });
  it('falls back to the old normal chart during an incomplete rollout',async()=>{
    vi.stubGlobal('fetch',vi.fn(async path=>({ok:!path.endsWith('/chart.json'),json:async()=>chart})));
    expect((await loadChart(song)).notes).toHaveLength(2);
  });
  it('generates a playable six-move chart when both files are missing',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false})));const loaded=await loadChart(song);
    expect(loaded.fallback).toBe(true);expect(new Set(loaded.notes.map(n=>n.move)).size).toBe(6);expect(loaded).not.toHaveProperty('difficulty');
  });
  it('preserves new catalog paths',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({songs:[song]})})));expect((await loadCatalog())[0].chart).toBe(song.chart);
  });
});
