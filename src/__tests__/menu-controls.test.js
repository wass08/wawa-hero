import { describe, expect, it } from 'vitest';
import { MENU_LABELS, menuActionForMove, menuMoveForKey, titleChoice, createMenuActivation } from '../menu-controls.js';
import { MOVE_KEYS } from '../pose/index.js';
describe('menu controls and title choices',()=>{
  it('uses mirrored split poses instead of gameplay up/down',()=>{
    expect(menuActionForMove('split_lu')).toBe('previous');expect(MENU_LABELS.split_lu).toBe('LEFT UP');
    expect(menuActionForMove('split_ld')).toBe('next');expect(MENU_LABELS.split_ld).toBe('RIGHT UP');
    expect(menuActionForMove('clap')).toBe('choose');expect(menuActionForMove('up')).toBeNull();expect(menuActionForMove('down')).toBe('back');
  });
  it('keeps arrow navigation while preserving gameplay arrow aliases',()=>{
    expect(menuMoveForKey('ArrowUp')).toBe('split_lu');expect(menuMoveForKey('ArrowDown')).toBe('split_ld');
    expect(menuMoveForKey('Space')).toBe('clap');expect(MOVE_KEYS.ArrowUp).toBe('up');expect(MOVE_KEYS.ArrowDown).toBe('down');
  });
  it('selects the title player count from split poses and keeps it on clap',()=>{
    expect(titleChoice('split_lu',2)).toBe(1);expect(titleChoice('split_ld',1)).toBe(2);expect(titleChoice('clap',2)).toBe(2);
  });

});

const frame=(t,scores={},tracked=true,source='camera:0')=>({t,scores,tracked,source});
function stream(gate,scores,start,end,step=30){const actions=[];for(let t=start;t<=end;t+=step){const action=gate.update(frame(t,scores));if(action)actions.push(action);}return actions;}
describe('global camera menu latch',()=>{
  it('confirms >= .6 for 120 ms; brief transit poses and gameplay moves never activate',()=>{
    const gate=createMenuActivation();
    expect(gate.update(frame(0,{up:1}))).toBeNull();
    expect(gate.update(frame(30,{clap:1}))).toBeNull();
    expect(gate.update(frame(90,{split_ld:1}))).toBeNull();
    expect(gate.update(frame(120,{split_ld:.59}))).toBeNull();
    expect(stream(gate,{split_ld:.6},150,270)).toEqual(['split_ld']);
  });
  it('holding for 5 seconds never re-arms even through .4-.7 jitter',()=>{
    const gate=createMenuActivation();expect(stream(gate,{split_ld:.8},0,150)).toEqual(['split_ld']);
    expect(stream(gate,{split_ld:.4},180,600)).toEqual([]);
    expect(stream(gate,{split_ld:.7},630,5000)).toEqual([]);expect(gate.locked).toBe(true);
  });
  it('requires ALL menu moves below .3 for 350 ms; another move cannot unlock',()=>{
    const gate=createMenuActivation();stream(gate,{split_lu:1},0,150);
    expect(stream(gate,{split_ld:1},180,600)).toEqual([]);
    expect(stream(gate,{clap:.3},630,1050)).toEqual([]);expect(gate.locked).toBe(true);
    stream(gate,{},1080,1410);expect(gate.locked).toBe(true);
    gate.update(frame(1430,{}));expect(gate.locked).toBe(false);
    expect(stream(gate,{split_ld:1},1460,1610)).toEqual(['split_ld']);
  });
  it('quick left → right without rest fires only LEFT UP',()=>{
    const gate=createMenuActivation();expect(stream(gate,{split_lu:1},0,150)).toEqual(['split_lu']);
    expect(stream(gate,{split_ld:1},180,1500)).toEqual([]);
  });
  it('up → split_lu starts confirmation for the menu move only',()=>{
    const gate=createMenuActivation();expect(stream(gate,{up:1},0,300)).toEqual([]);
    expect(stream(gate,{split_lu:1},330,600)).toEqual(['split_lu']);
  });
  it('dropouts interrupt fresh rest without unlocking the latch',()=>{
    const gate=createMenuActivation();stream(gate,{clap:1},0,150);stream(gate,{},180,480);
    gate.update(frame(510,{},false));gate.update(null);
    stream(gate,{},600,930);expect(gate.locked).toBe(true);
    gate.update(frame(960,{}));expect(gate.locked).toBe(false);
    expect(stream(gate,{clap:1},990,1140)).toEqual(['clap']);
  });
  it('a detected but occluded upper body or missing scores never counts as rest',()=>{
    const gate=createMenuActivation();stream(gate,{clap:1},0,150);
    for(let t=180;t<=900;t+=30)gate.update({...frame(t,{}),upperBody:false});expect(gate.locked).toBe(true);
    for(let t=930;t<=1500;t+=30)gate.update({...frame(t,{}),scores:null});expect(gate.locked).toBe(true);
  });
  it('dropouts and camera stalls cannot finish activation',()=>{
    const gate=createMenuActivation();stream(gate,{clap:1},0,90);gate.update(frame(100,{},false));
    expect(gate.update(frame(200,{clap:1}))).toBeNull();expect(gate.update(frame(600,{clap:1}))).toBeNull();
    expect(stream(gate,{clap:1},630,750)).toEqual(['clap']);
  });
  it('deduplicates frame.t per source and rejects older frames',()=>{
    const gate=createMenuActivation();gate.update(frame(0,{split_ld:1}));
    for(let i=0;i<60;i++)expect(gate.update(frame(0,{split_ld:1}))).toBeNull();
    expect(gate.debug()).toMatchObject({processed:1,duplicates:60,confirmMs:0});
    expect(stream(gate,{split_ld:1},30,150)).toEqual(['split_ld']);
    gate.update(frame(120,{}));expect(gate.debug().duplicates).toBe(61);
    // A newly created source may have its own timestamp, but cannot unlock.
    expect(gate.update(frame(120,{split_ld:1},true,'camera:1'))).toBeNull();expect(gate.locked).toBe(true);
  });
  it('deduplicated rest frames cannot release a held action',()=>{
    const gate=createMenuActivation();stream(gate,{clap:1},0,150);gate.update(frame(180,{}));
    for(let i=0;i<50;i++)gate.update(frame(180,{}));expect(gate.locked).toBe(true);expect(gate.debug().restMs).toBe(0);
  });
  it('keeps a 450 ms safety cooldown even with custom shorter rest/confirmation',()=>{
    const gate=createMenuActivation({restMs:50,confirmMs:0});expect(gate.update(frame(0,{clap:1}))).toBe('clap');
    stream(gate,{},30,90);expect(stream(gate,{split_ld:1},120,420)).toEqual([]);
    expect(gate.update(frame(450,{split_ld:1}))).toBe('split_ld');
  });
  it('consumes keyboard echoes and confirms synthetic frames despite tracked:false',()=>{
    const gate=createMenuActivation();gate.consume('clap',0);
    const synthetic=(t,scores)=>frame(t,scores,false,'synthetic:0');
    expect(gate.update(synthetic(0,{clap:1}))).toBeNull();
    for(let t=30;t<=450;t+=30)gate.update(synthetic(t,{}));expect(gate.locked).toBe(false);
    gate.update(synthetic(480,{clap:1}));expect(gate.update(synthetic(600,{clap:1}))).toBe('clap');
  });
  it('consumes a pending gesture across screen changes instead of replaying it',()=>{
    const gate=createMenuActivation();gate.update(frame(0,{clap:1}));gate.suspend();
    expect(stream(gate,{clap:1},30,500)).toEqual([]);expect(gate.locked).toBe(true);
  });
  it('keeps independent per-player global latches',()=>{
    const p1=createMenuActivation(),p2=createMenuActivation();expect(stream(p1,{split_ld:1},0,150)).toEqual(['split_ld']);
    expect(stream(p2,{split_ld:1},0,150)).toEqual(['split_ld']);expect(stream(p1,{clap:1},180,900)).toEqual([]);
  });
  it('ARMS DOWN fires back once per activation, LEFT UP never back',()=>{
    const gate=createMenuActivation();const first=stream(gate,{down:1},0,5000);
    expect(first.map(menuActionForMove)).toEqual(['back']);
    stream(gate,{},5030,5500);expect(stream(gate,{down:1},5530,5900).map(menuActionForMove)).toEqual(['back']);
    const left=createMenuActivation();expect(stream(left,{split_lu:1},0,5000).map(menuActionForMove)).toEqual(['previous']);
    expect(titleChoice('down',2)).toBe(2);
  });
});
