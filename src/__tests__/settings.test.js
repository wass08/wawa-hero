import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function load(bests, settings=null) {
  vi.resetModules();const data=new Map([['wh.bests',JSON.stringify(bests)],['wh.settings',JSON.stringify(settings)]]);
  vi.stubGlobal('localStorage',{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)});
  return {api:await import('../settings.js'),data};
}
describe('validated saved scores (#1)',()=>{
  it.each([42,'scores',[],null,true])('replaces invalid container %j',async invalid=>{
    const {api,data}=await load(invalid);
    expect(api.saveBest('song',100)).toBe(true);expect(api.getBest('song')).toBe(100);
    expect(JSON.parse(data.get('wh.bests'))).toEqual({'song':100});
  });
  it('merges legacy difficulty bests with an existing song best, taking the max',async()=>{
    const {api,data}=await load({'song:easy':50,'song:normal':100,'song:hard':75,song:90,'bad:normal':'99999'});
    expect(api.getBest('song')).toBe(100);expect(api.getBest('bad')).toBe(0);
    expect(JSON.parse(data.get('wh.bests'))).toEqual({song:100});expect(api.saveBest('song',99)).toBe(false);
  });
  it('removes old setup fields while keeping mode',async()=>{
    const {api,data}=await load({}, {players:2,weightKg:80,calibrationMs:120,levelIndex:3,musicVolume:.2,sfxVolume:1,profiles:[{name:'Kai',country:'JP'}]});
    expect(api.settings.players).toBe(2);expect(api.settings).not.toHaveProperty('profiles');expect(JSON.parse(data.get('wh.hero.p1'))).toMatchObject({name:'Kai',country:'JP'});expect(data.has('wh.hero.p2')).toBe(false);
    for(const key of ['weightKg','calibrationMs','levelIndex','musicVolume','sfxVolume'])expect(api.settings).not.toHaveProperty(key);
    expect(JSON.parse(data.get('wh.settings'))).toEqual(api.settings);
  });
});
