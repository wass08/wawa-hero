import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { SHOTS, cameraCueIndex, createShotScheduler, fallbackCameraTrack } from '../engine/shots.js';
function projection(pose) {
  const camera=new PerspectiveCamera(pose.fov,16/9,0.1,100);
  camera.position.set(...pose.pos);camera.lookAt(new Vector3(...pose.look));camera.updateMatrixWorld();
  return (x,y,z)=>{const p=new Vector3(x,y,z).project(camera);return {x:(p.x+1)*800,y:(1-p.y)*450};};
}
describe('show-camera scheduler',()=>{
  const cues=[{t:0,shot:'front',ease:0},{t:5,shot:'wide',ease:2},{t:10,shot:'close',ease:0}];
  it('looks up the most recent cue, including exact boundaries',()=>{
    expect(cameraCueIndex(cues,-0.01)).toBe(-1);expect(cameraCueIndex(cues,0)).toBe(0);
    expect(cameraCueIndex(cues,4.99)).toBe(0);expect(cameraCueIndex(cues,5)).toBe(1);expect(cameraCueIndex(cues,99)).toBe(2);
  });
  it('glides smoothly from the outgoing pose and reaches the moving target',()=>{
    const scheduler=createShotScheduler({camera:cues}),cut=createShotScheduler({camera:cues.map(c=>({...c,ease:0}))});
    const before=structuredClone(scheduler.sample(4.999999)),start=structuredClone(scheduler.sample(5));
    for(let i=0;i<3;i++)expect(start.pos[i]).toBeCloseTo(before.pos[i],5);
    const halfway=structuredClone(scheduler.sample(6)),target=structuredClone(cut.sample(6));
    expect(halfway.fov).toBe((SHOTS.front.fov+SHOTS.wide.fov)/2);expect(halfway.pos[0]).toBeCloseTo(target.pos[0]/2);
    expect(scheduler.sample(7).pos).toEqual(cut.sample(7).pos);
  });
  it('cuts immediately without the stage adding another interpolation',()=>{
    const s=createShotScheduler({camera:cues});s.sample(9.99);const shot=s.sample(10);
    expect(shot.shot).toBe('close');expect(shot.pos).toEqual(SHOTS.close.pos);expect(shot.fov).toBe(SHOTS.close.fov);
  });
  it('freezes cue transitions and procedural motion during pause, resumes and restarts',()=>{
    const s=createShotScheduler({camera:cues}),at=structuredClone(s.sample(6));s.pause(6);
    expect(s.sample(30)).toEqual(at);s.resume();expect(s.sample(10).shot).toBe('close');
    s.pause(10);s.reset();expect(s.sample(0).shot).toBe('front');
  });
  it('reproduces a pose exactly when seeking backward into a glide',()=>{
    const s=createShotScheduler({camera:cues}),at=structuredClone(s.sample(5.4));s.sample(40);expect(s.sample(5.4)).toEqual(at);
  });
  it('punches on downbeats, relaxes on intervening beats, with bpm/offset fallback',()=>{
    const chart={bpm:120,offset:0.24,camera:[{t:0,shot:'drop',ease:0}]};
    const detected=createShotScheduler({...chart,downbeats:[0.24,2.24,4.24],beats:[0.24,0.74,1.24,1.74,2.24]}),fallback=createShotScheduler(chart);
    const peak=structuredClone(detected.sample(2.24));expect(peak.pos[2]).toBeCloseTo(SHOTS.drop.pos[2]-SHOTS.drop.amount);
    expect(peak.fov).toBe(SHOTS.drop.fov-SHOTS.drop.fovKick);
    expect(detected.sample(2.74).pos[2]).toBeGreaterThan(peak.pos[2]+8);
    expect(fallback.sample(2.24).pos[2]).toBeCloseTo(peak.pos[2]);
    expect(createShotScheduler({...chart,beats:[0.24,0.74,1.24,1.74,2.24]}).sample(2.24).pos[2]).toBeCloseTo(peak.pos[2]);
    // Irregular detected bar timing overrides a uniform bpm clock.
    expect(createShotScheduler({...chart,downbeats:[0.24,2.4,4.3]}).sample(2.4).pos[2]).toBeCloseTo(peak.pos[2]);
  });
  it('generates gentle switches every eight downbeats and tolerates missing/invalid cues',()=>{
    const downbeats=Array.from({length:25},(_,i)=>i*2),track=fallbackCameraTrack({bpm:120,downbeats},60);
    expect(track.map(c=>c.t)).toEqual([0,16,32,48]);expect(track.slice(1).every(c=>c.ease>0)).toBe(true);
    expect(createShotScheduler({camera:[null,{t:0,shot:'missing'}]}).sample(0).shot).toBe('front');
    expect(fallbackCameraTrack({bpm:120},40).map(c=>c.t)).toEqual([0,16,32]);
  });
  it.each(Object.keys(SHOTS))('pins %s for tuning without cues or procedural drift',shot=>{
    const s=createShotScheduler({camera:cues},{pinned:shot}),first=structuredClone(s.sample(0));expect(s.sample(100)).toEqual(first);
    expect(s.sample(0).look).toEqual(SHOTS[shot].look);expect(s.sample(5).shot).toBe(shot);
  });
  it('sweeps a full ±45° orbit with an angled mid-shot and deterministic pause/seek',()=>{
    const s=createShotScheduler({camera:[{t:0,shot:'orbit',ease:0}]},{duration:16});
    const angle=t=>{const p=s.sample(t);return Math.atan2(p.pos[0]-p.look[0],p.pos[2]-p.look[2])*180/Math.PI;};
    expect(angle(0)).toBeCloseTo(-45);expect(angle(8)).toBeCloseTo(-33.75);expect(angle(16)).toBeCloseTo(45);
    const mid=structuredClone(s.sample(8));s.pause(8);expect(s.sample(100)).toEqual(mid);
    s.reset();s.sample(16);expect(s.sample(8)).toEqual(mid);
    expect(createShotScheduler({}, {pinned:'orbit'}).sample(0).pos[0]).toBeLessThan(-10);
  });
  it('uses distinct operators: rear wide, screen close, mirrored low corners, and overhead crane',()=>{
    expect(SHOTS.wide.pos[2]).toBeGreaterThan(SHOTS.front.pos[2]*2);
    expect(SHOTS.close.pos[2]).toBeLessThan(SHOTS.front.pos[2]-3);
    for(const shot of ['low_left','low_right']){
      const p=SHOTS[shot],yaw=Math.abs(Math.atan2(p.pos[0],p.pos[2]-p.look[2])*180/Math.PI);
      expect(yaw).toBeGreaterThan(30);expect(yaw).toBeLessThan(40);expect(p.pos[1]).toBeLessThan(0.5);
      const foreground=projection(p)(p.pos[0],0.3,7);
      expect(foreground.y).toBeGreaterThan(675);expect(foreground.y).toBeLessThan(730);
    }
    expect(SHOTS.low_left.pos[0]).toBe(-SHOTS.low_right.pos[0]);
    const crane=SHOTS.high,pitch=Math.atan2(crane.pos[1]-crane.look[1],crane.pos[2]-crane.look[2])*180/Math.PI;
    expect(crane.pos[1]).toBeGreaterThanOrEqual(9);expect(crane.pos[1]).toBeLessThanOrEqual(11);
    expect(pitch).toBeGreaterThan(25);expect(pitch).toBeLessThan(35);
  });
  it('frames the full LED wall at 35–45% in wide and 80–90% in close',()=>{
    for(const [id,min,max] of [['wide',0.35,0.45],['close',0.8,0.9]]) {
      const project=projection(createShotScheduler({}, {pinned:id}).sample(0));
      const xs=[project(-10.5,4.2,-6.2).x,project(10.5,4.2,-6.2).x,project(-10.5,12,-6.2).x,project(10.5,12,-6.2).x];
      const width=(Math.max(...xs)-Math.min(...xs))/1600;
      expect(width).toBeGreaterThan(min);expect(width).toBeLessThan(max);
    }
  });
  it.each(Object.keys(SHOTS))('keeps the central feed clear of the fixed HUD and live avatar in %s',id=>{
    const p=createShotScheduler({}, {pinned:id}).sample(0),project=projection(p),half=7.8*16/9/2;
    const lt=project(-half,12,-6.2),lb=project(-half,4.2,-6.2),rt=project(half,12,-6.2),rb=project(half,4.2,-6.2);
    for(const corner of [lt,lb,rt,rb]) {
      expect(corner.x).toBeGreaterThan(0);expect(corner.x).toBeLessThan(1600);
      expect(corner.y).toBeGreaterThan(0);expect(corner.y).toBeLessThan(711);
    }
    // Clip each vertical feed edge at the actual upper panels' lower edges.
    const edgeX=(a,b,y)=>a.x+(b.x-a.x)*(Math.min(y,b.y)-a.y)/(b.y-a.y);
    if(lt.y<357)expect(Math.min(lt.x,edgeX(lt,lb,357))).toBeGreaterThan(414);
    if(rt.y<344)expect(Math.max(rt.x,edgeX(rt,rb,344))).toBeLessThan(1216);
    // The live avatar's highest possible wrist stays below the screen, or on
    // its far wing. Centred avatar-cam fallback is intentionally unchanged.
    const wrist=project(p.pos[0]>2?-5.4:5.4,2.85,0.6);
    expect(wrist.y>Math.max(lb.y,rb.y)||wrist.x<Math.min(lt.x,lb.x)||wrist.x>Math.max(rt.x,rb.x)).toBe(true);
  });
});
