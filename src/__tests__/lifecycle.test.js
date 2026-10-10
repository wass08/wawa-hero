import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCamera } from '../camera.js';
import { createResourceSlot } from '../lifecycle.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function environment() {
  const video={setAttribute:vi.fn(),play:vi.fn(async()=>{}),pause:vi.fn(),srcObject:null,isConnected:false,remove:vi.fn(function(){this.isConnected=false;})};
  vi.stubGlobal('document',{createElement:()=>video,body:{append:v=>{v.isConnected=true;}}});
  const request=deferred();vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(()=>request.promise)}});
  const track={stop:vi.fn()},stream={getTracks:()=>[track]};return {video,request,track,stream};
}
afterEach(()=>vi.unstubAllGlobals());
describe('camera and tracker teardown (#4, #10)',()=>{
  it('stops a stream acquired after close and does not invoke onLive',async()=>{
    const {request,track,stream,video}=environment(),onLive=vi.fn(),camera=createCamera({onLive});
    const enable=camera.enable();camera.close();request.resolve(stream);await enable;
    expect(track.stop).toHaveBeenCalledOnce();expect(onLive).not.toHaveBeenCalled();expect(video.srcObject).toBeNull();expect(camera.status).toBe('avatar');
  });
  it('reattaches the same video and reacquires a fresh stream after restoration',async()=>{
    const {request,stream,video}=environment(),camera=createCamera();
    const first=camera.enable();request.resolve(stream);await first;camera.close();
    camera.restore();const next={getTracks:()=>[{stop:vi.fn()}]};navigator.mediaDevices.getUserMedia.mockResolvedValueOnce(next);
    await camera.enable();expect(video.srcObject).toBe(next);expect(video.isConnected).toBe(true);expect(camera.status).toBe('live');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });
  it('old acquisition cannot overwrite or clear a newer restored request',async()=>{
    const {request,stream,track,video}=environment(),camera=createCamera();const old=camera.enable();camera.close();camera.restore();
    const fresh=deferred(),stream2={getTracks:()=>[]};navigator.mediaDevices.getUserMedia.mockReturnValueOnce(fresh.promise);
    const next=camera.enable();request.resolve(stream);await old;expect(track.stop).toHaveBeenCalledOnce();
    fresh.resolve(stream2);await next;expect(video.srcObject).toBe(stream2);expect(camera.status).toBe('live');
  });
  it('closes a tracker created after teardown and ignores its late status',async()=>{
    const slot=createResourceSlot(),request=deferred(),tracker={close:vi.fn()},onStatus=vi.fn();let status;
    const acquire=slot.acquire(s=>{status=s;return request.promise;},onStatus);
    slot.close();status('ready');request.resolve(tracker);expect(await acquire).toBeNull();
    expect(slot.current).toBeNull();expect(tracker.close).toHaveBeenCalledOnce();expect(onStatus).not.toHaveBeenCalled();
  });
  it('late tracker creation never replaces a newer tracker',async()=>{
    const slot=createResourceSlot(),old=deferred(),a={close:vi.fn()},b={close:vi.fn()};
    const first=slot.acquire(()=>old.promise);slot.close();await slot.acquire(async()=>b);old.resolve(a);await first;
    expect(slot.current).toBe(b);expect(a.close).toHaveBeenCalledOnce();expect(b.close).not.toHaveBeenCalled();
  });
});
