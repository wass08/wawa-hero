import { describe, expect, it } from 'vitest';
import { MENU_LABELS, menuActionForMove, menuMoveForKey, titleChoice, createBackHold } from '../menu-controls.js';
import { MOVE_KEYS } from '../pose/index.js';
describe('menu controls and title choices',()=>{
  it('uses mirrored split poses instead of gameplay up/down',()=>{
    expect(menuActionForMove('split_lu')).toBe('previous');expect(MENU_LABELS.split_lu).toBe('LEFT UP');
    expect(menuActionForMove('split_ld')).toBe('next');expect(MENU_LABELS.split_ld).toBe('RIGHT UP');
    expect(menuActionForMove('clap')).toBe('choose');expect(menuActionForMove('up')).toBeNull();expect(menuActionForMove('down')).toBeNull();
  });
  it('keeps arrow navigation while preserving gameplay arrow aliases',()=>{
    expect(menuMoveForKey('ArrowUp')).toBe('split_lu');expect(menuMoveForKey('ArrowDown')).toBe('split_ld');
    expect(menuMoveForKey('Space')).toBe('clap');expect(MOVE_KEYS.ArrowUp).toBe('up');expect(MOVE_KEYS.ArrowDown).toBe('down');
  });
  it('selects the title player count from split poses and keeps it on clap',()=>{
    expect(titleChoice('split_lu',2)).toBe(1);expect(titleChoice('split_ld',1)).toBe(2);expect(titleChoice('clap',2)).toBe(2);
  });
  it('fills a 1.2 second hold, triggers once, and resets on release',()=>{
    const hold=createBackHold();expect(hold.update(true,100)).toEqual({progress:0,trigger:false});
    expect(hold.update(true,700)).toEqual({progress:.5,trigger:false});
    expect(hold.update(true,1300)).toEqual({progress:1,trigger:true});expect(hold.update(true,2000).trigger).toBe(false);
    expect(hold.update(false,2100).progress).toBe(0);expect(hold.update(true,2200).trigger).toBe(false);
    hold.reset();expect(hold.update(true,5000).progress).toBe(0);
  });
});
