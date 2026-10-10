import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSongPreview, previewLoop } from '../preview.js';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
function audio() { return {suspended:false,getBuffer:vi.fn(async()=>({duration:100})),preview:vi.fn(()=>true),stopPreview:vi.fn(async()=>{})}; }
const song=id=>({id,audio:`songs/${id}/audio.mp3`});
describe('song preview lifecycle',()=>{
  it('uses catalog bounds or a bounded 30% / 15-second fallback',()=>{
    expect(previewLoop(song('a'),100)).toEqual({start:30,dur:15});
    expect(previewLoop({...song('a'),preview:{start:51.7,dur:15.2}},183.5)).toEqual({start:51.7,dur:15.2});
    const short=previewLoop({...song('a'),preview:{start:1000,dur:-1}},10);expect(short.start).toBeLessThan(10);expect(short.start+short.dur).toBeCloseTo(10);
  });
  it('debounces scrolling and does not restart for level selection',async()=>{
    const a=audio(),p=createSongPreview(a);p.select(song('a'));await vi.advanceTimersByTimeAsync(100);p.select(song('b'));p.select(song('c'));
    await vi.advanceTimersByTimeAsync(200);expect(a.getBuffer).toHaveBeenCalledOnce();expect(a.getBuffer.mock.calls[0][0]).toContain('/c/');expect(a.preview).toHaveBeenCalledOnce();
    p.select(song('c'));await vi.advanceTimersByTimeAsync(500);expect(a.preview).toHaveBeenCalledOnce();
  });
  it('ignores an obsolete decode and waits for a user gesture',async()=>{
    const a=audio(),status=vi.fn(),p=createSongPreview(a,{onStatus:status});let finish;
    a.getBuffer.mockReturnValueOnce(new Promise(r=>{finish=r;}));p.select(song('a'));await vi.advanceTimersByTimeAsync(200);
    p.select(song('b'));finish({duration:100});await Promise.resolve();expect(a.preview).not.toHaveBeenCalled();
    a.suspended=true;await vi.advanceTimersByTimeAsync(200);expect(status).toHaveBeenLastCalledWith('gesture');a.suspended=false;p.refresh();expect(a.preview).toHaveBeenCalledOnce();
  });
  it('cancels pending starts and waits for all fade-outs before countdown',async()=>{
    const a=audio(),p=createSongPreview(a);p.select(song('a'));let finish;
    a.stopPreview.mockReturnValueOnce(new Promise(r=>{finish=r;}));p.select(song('b'));
    const ended=vi.fn();const stop=p.stop().then(ended);await vi.advanceTimersByTimeAsync(500);expect(a.getBuffer).not.toHaveBeenCalled();expect(ended).not.toHaveBeenCalled();
    finish();await stop;expect(ended).toHaveBeenCalledOnce();
  });
});
