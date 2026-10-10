import { describe, expect, it } from 'vitest';
import { createGameInput } from '../input.js';
import { createJudge } from '../pose/index.js';
function sweep(pause) {
  const input=createGameInput(),judge=createJudge(),notes=[{t:1,move:'sweep',dur:1.5}],out=[];
  input.update(0);
  for(let i=1;i<=210;i++){
    const t=i/60,real=t*1000+(pause&&t>1.1?3000:0);
    if(i===60)input.press('sweep',{t:1000,dur:1.5});
    const frame=input.update(real);
    out.push(...judge.update(frame,t,notes).filter(j=>j.result));
    if(pause&&i===66){
      input.pause(real);const angle=frame.armAngle.left;
      for(let now=real+100;now<=real+3000;now+=100){const f=input.update(now);expect(f.armAngle.left).toBeCloseTo(angle,6);expect(f.t).toBe(now);}
      input.resume(real+3000);
    }
  }
  return out[0];
}
describe('pause-aware synthetic poses (#6)',()=>{
  it('preserves a sweep arc, judgement and accuracy through a three-second pause',()=>{
    const baseline=sweep(false),paused=sweep(true);
    expect(baseline.result).toBe('perfect');expect(paused.result).toBe('perfect');expect(paused.accuracy).toBeCloseTo(baseline.accuracy,6);
  });
});
