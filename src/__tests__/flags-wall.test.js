import {describe,it,expect,vi,afterEach} from 'vitest';
import {createFlags} from '../services/flags.js';
import {polaroidLayout,drawPolaroid,createPolaroidTexture} from '../hud/polaroid.js';
import {renderStrip} from '../game/photos.js';
const ctx=()=>({measureText:vi.fn(text=>({width:text.length*9})),...Object.fromEntries(['clearRect','fillRect','fillText','drawImage','save','restore','strokeRect','beginPath','moveTo','lineTo','closePath','fill'].map(k=>[k,vi.fn()]))});
afterEach(()=>vi.unstubAllGlobals());
describe('real flag display routing',()=>{
  it('uses a real asset URL and canvas-safe loaded image before a monogram',async()=>{
    vi.stubGlobal('document',{createElement:tag=>({tag})});const flag={width:640,height:480},data={flagUrl:vi.fn(()=>'/assets/fr-hash.svg'),loadFlagImage:vi.fn(async()=>flag),countryName:()=> 'France'},flags=createFlags(data);
    expect(flags.url('FR')).toBe('/assets/fr-hash.svg');const el=flags.element('FR');expect(el).toMatchObject({tag:'img',src:'/assets/fr-hash.svg',alt:'France',width:24,height:18});expect(await flags.image('FR')).toBe(flag);expect(data.loadFlagImage).toHaveBeenCalledWith('FR');
  });
  it('bounds a null-asset fallback and gives missing country no image',async()=>{
    vi.stubGlobal('document',{createElement:tag=>({tag})});vi.stubGlobal('Image',class{set src(v){this.url=v;queueMicrotask(()=>this.onload());}});const flags=createFlags({flagUrl:()=>null,loadFlagImage:async()=>null});
    expect(flags.element('FR').src).toMatch(/^data:image\/svg/);expect(await flags.image('FR')).toMatchObject({width:32,height:24});expect(flags.url(null)).toBeNull();expect(await flags.image(null)).toBeNull();expect(flags.element(null).tag).toBe('span');
  });
  it.each([true,false])('checks the cached image before an element-load fallback (available=%s)',async available=>{
    vi.stubGlobal('document',{createElement:tag=>({tag})});const data={flagUrl:()=>'/real.svg',loadFlagImage:vi.fn(async()=>available?{src:'/cached.svg'}:null)},el=createFlags(data).element('FR');await el.onerror();expect(data.loadFlagImage).toHaveBeenCalledWith('FR');expect(el.src).toMatch(available?/^\/cached.svg$/:/^data:image\/svg/);
  });
});
describe('polaroid photo/flag/caption geometry',()=>{
  it.each(['FR','US','JP','BR',null])('puts %s only in a small 4:3 photo-corner flag',country=>{
    const layout=polaroidLayout(country),context=ctx();context.measureText=()=>({width:800});const row={player_name:'ALEXANDRA PIXELS',country,score:48200,mode:'versus'},flag=country?{}:null;drawPolaroid(context,row,null,flag,layout);
    if(country){expect(layout.flag.w/layout.width).toBeCloseTo(.14);expect(layout.flag.w/layout.flag.h).toBeCloseTo(4/3);expect(layout.flag.x+layout.flag.w).toBeLessThan(layout.photo.x+layout.photo.w);expect(layout.flag.y+layout.flag.h).toBeLessThan(layout.photo.y+layout.photo.h);expect(context.drawImage).toHaveBeenCalledWith(flag,layout.flag.x,layout.flag.y,layout.flag.w,layout.flag.h);}else{expect(layout.flag).toBeNull();expect(context.drawImage).not.toHaveBeenCalled();}
    expect(context.fillText.mock.calls.map(call=>call[0])).toEqual(['ALEXANDRA PIXELS','48,200',' pts · ','2','P']);expect(layout.caption).toEqual(polaroidLayout(null).caption);expect(context.font).toContain('Chakra Petch');
  });
  it('redraws when a delayed flag finishes loading; disposed tiles cannot redraw',async()=>{
    const context=ctx();context.measureText=()=>({width:200});const canvas={getContext:()=>context};vi.stubGlobal('document',{createElement:()=>canvas});const image={width:640,height:360};let loaded;const onUpdate=vi.fn(),texture=createPolaroidTexture({country:'FR',player_name:'Hero',score:1},{photoUrl:'/photo.webp',loadFlagImage:()=>new Promise(r=>loaded=r),imageFactory:()=>image,onUpdate});
    expect(onUpdate).toHaveBeenCalledOnce();image.onload();expect(onUpdate).toHaveBeenCalledTimes(2);loaded({width:640,height:480});await Promise.resolve();expect(onUpdate).toHaveBeenCalledTimes(3);expect(context.drawImage.mock.calls.at(-1).slice(1)).toEqual(Object.values(polaroidLayout('FR').flag));texture.close();const count=onUpdate.mock.calls.length;expect(image.onload).toBeNull();expect(onUpdate).toHaveBeenCalledTimes(count);
  });
  it('does not request a flag for a countryless tile',()=>{const context=ctx();context.measureText=()=>({width:200});vi.stubGlobal('document',{createElement:()=>({getContext:()=>context})});const loadFlagImage=vi.fn();createPolaroidTexture({country:null,player_name:'NO COUNTRY'},{photoUrl:'/p',loadFlagImage,imageFactory:()=>({})});expect(loadFlagImage).not.toHaveBeenCalled();});
  it('leaves no flag gap in a countryless downloaded strip',async()=>{const context=ctx(),canvas={getContext:()=>context,toBlob:callback=>callback(new Blob(['image'],{type:'image/webp'}))};vi.stubGlobal('document',{createElement:()=>canvas});await renderStrip([],{name:'NO COUNTRY',country:null,score:100});expect(context.drawImage).not.toHaveBeenCalled();expect(context.fillText).toHaveBeenCalledWith('NO COUNTRY · ',24,94);expect(context.fillText.mock.calls.filter(call=>call[2]===94).map(call=>call[0]).join('')).toBe('NO COUNTRY · 100 points');});
});
