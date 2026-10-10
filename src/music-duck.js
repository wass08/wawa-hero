export const DUCK = Object.freeze({attack:.03,hold:.15,recovery:.5,minDb:-9,soloDb:-6,versusDb:-3.5});
const amplitude = db => 10 ** (db / 20);
// One envelope replaces the previous one; simultaneous/rapid misses never
// multiply attenuation. Track the ramp so cancellation preserves continuity.
export function createMusicDuck(ctx,param,volume=()=>1) {
  let curve=null;
  function gainAt(time) {
    if(!curve||time<curve.start)return 1;
    const t=time-curve.start;
    if(t<DUCK.attack)return curve.from+(curve.target-curve.from)*t/DUCK.attack;
    if(t<DUCK.attack+DUCK.hold)return curve.target;
    const recovery=(t-DUCK.attack-DUCK.hold)/DUCK.recovery;
    return curve.target+(1-curve.target)*Math.min(1,recovery);
  }
  return {
    gainAt,
    trigger({at=ctx.currentTime,players=1}={}) {
      at=Math.max(ctx.currentTime,Number.isFinite(at)?at:ctx.currentTime);
      const from=Math.max(amplitude(DUCK.minDb),gainAt(at));
      const target=amplitude(Math.max(DUCK.minDb,players===2?DUCK.versusDb:DUCK.soloDb)),base=volume();
      param.cancelScheduledValues(at);param.setValueAtTime(base*from,at);
      param.linearRampToValueAtTime(base*target,at+DUCK.attack);
      param.setValueAtTime(base*target,at+DUCK.attack+DUCK.hold);
      param.linearRampToValueAtTime(base,at+DUCK.attack+DUCK.hold+DUCK.recovery);
      curve={start:at,from,target};
    },
    reset() {
      param.cancelScheduledValues(ctx.currentTime);
      param.setValueAtTime(volume(),ctx.currentTime);curve=null;
    },
  };
}
