import {describe,it,expect} from 'vitest';
import {JUMBO_LOOK,jumboUniforms,applyJumboLook,readJumboLook,normalizeJumboLook,palettePosition,JUMBO_FRAGMENT} from '../engine/jumbo-look.js';
import {moveBadge,buttonClasses,setButtonContent} from '../hud/button.js';
describe('shared LED look',()=>{
 it('defaults live to 10 tones / 100 rows; photos are finer and use the same palette',()=>{
   const u=jumboUniforms();expect(readJumboLook(u)).toEqual(JUMBO_LOOK.live);
   applyJumboLook(u,JUMBO_LOOK.photo);expect(readJumboLook(u)).toEqual(JUMBO_LOOK.photo);
   expect(u.tones.value).toBe(14);expect(u.rows.value).toBe(160);
   expect(JUMBO_FRAGMENT).toContain('mix(r0,r1,p)');expect(JUMBO_FRAGMENT).toContain('menuBrightness');
 });
 it('clamps sliders and rejects NaN before it reaches the GPU',()=>{
   expect(normalizeJumboLook({tones:30,rows:NaN,gamma:-1})).toMatchObject({tones:24,rows:100,gamma:.5});
 });
 it('keeps the five old palette anchors and interpolates additional tones',()=>{
   expect([0,.2,.4,.6,1].map(l=>palettePosition(l,5))).toEqual([0,1,2,3,4]);
   expect(palettePosition(.5,10)).toBeCloseTo(20/9);expect(palettePosition(1,14)).toBe(4);
 });
});
describe('one button and move badge family',()=>{
 it('restricts variants to primary / secondary / choice, sizes lg / md',()=>{
   expect(buttonClasses('primary','lg')).toBe('btn btn--primary btn--lg');
   expect(buttonClasses('invented','sm')).toBe('btn btn--secondary btn--md');
 });
 it('shows the same ARMS DOWN pictogram/name on back buttons and legends',()=>{
   const el={className:'back-button',dataset:{variant:'secondary',size:'md',move:'down'}};
   setButtonContent(el,'Back');expect(el.innerHTML).toContain(moveBadge('down'));
   expect(el.innerHTML).toContain('ARMS DOWN');expect(el.className).toContain('btn--secondary');
   setButtonContent(el,'Continue');expect(el.innerHTML).toContain('ARMS DOWN');expect(el.innerHTML).not.toContain('Hold');
 });
});
