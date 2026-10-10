import {describe,it,expect} from 'vitest';
import {createJudge} from '../pose/index.js';
import {createReviewBot} from '../review/bot.js';
const source=[{t:1,move:'down'},{t:2,move:'up'},{t:3,move:'clap'},{t:3.24,move:'clap'},{t:4,move:'split_lu'},{t:5,move:'split_ld'},{t:6,move:'sweep',dur:1.31}];
function run(increment){const notes=structuredClone(source),judgements=[];const bot=createReviewBot({notes,judge:createJudge(),onJudgement:j=>{if(j.result)judgements.push(j);}});for(let t=0;t<9;t+=increment)bot.update(t);return judgements;}
describe('review bot song-clock simulation',()=>{
  it('hits every cue, including short clap pairs and sweeps, through slow or stalled rendering',()=>{for(const increment of [1/120,1/60,.05,.2,.7]){const out=run(increment);expect(out).toHaveLength(source.length);expect(out.every(j=>j.result==='perfect')).toBe(true);}});
  it('does not advance arms or repeat a judgement when the clock is frozen',()=>{const notes=[{t:1,move:'sweep',dur:1.31}],out=[],bot=createReviewBot({notes,judge:createJudge(),onJudgement:j=>{if(j.result)out.push(j);}});const frame=bot.update(1.5),angle=frame.upperArmAngle.left;for(let i=0;i<100;i++)expect(bot.update(1.5).upperArmAngle.left).toBe(angle);bot.update(3);bot.update(3);expect(out).toHaveLength(1);expect(out[0].result).toBe('perfect');});
});
