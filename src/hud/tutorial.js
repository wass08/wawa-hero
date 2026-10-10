import {numeralHTML} from '../typography.js';
import { MOVE_IDS, CUES, iconSVG } from '../moves.js';
import { createJudge } from '../pose/index.js';
export function createTutorial({stage,onDone}) {
  const root=document.getElementById?.('tutorialMoves');
  if(!root)return {start(){},tick(){},move(){}};
  const cards=[...MOVE_IDS,'photo'],done=new Set(),practice=[0,1].map(()=>({notes:null,start:0,judge:createJudge()}));let index=0,started=0,cycle=-1;
  const buttons=cards.map((move,i)=>{const b=document.createElement('button');b.className='tutorial-move';b.type='button';b.innerHTML=iconSVG(move)+`<span>${CUES[move].label}</span><b class="performed">✓</b>`;b.addEventListener('click',()=>select(i,performance.now()));root.append(b);return b;});
  function select(i,now){index=(i+cards.length)%cards.length;started=now;cycle=-1;for(const p of practice){p.notes=null;p.judge.reset();}render();}
  function render(){buttons.forEach((b,i)=>{b.classList.toggle('active',i===index);b.classList.toggle('done',done.has(cards[i]));});document.getElementById('tutorialName').textContent=CUES[cards[index]].label;document.getElementById('tutorialInstruction').textContent=CUES[cards[index]].cue;document.getElementById('tutorialIcon').innerHTML=iconSVG(cards[index]);document.getElementById('tutorialIcon').style.color=`var(--${cards[index].replaceAll('_','-')})`;document.getElementById('tutorialProgress').innerHTML=numeralHTML(`${done.size} / 6 moves performed · PHOTO is free: any pose!`);}
  document.getElementById('tutorialPrev').addEventListener('click',()=>select(index-1,performance.now()));document.getElementById('tutorialNext').addEventListener('click',()=>select(index+1,performance.now()));document.getElementById('tutorialDone').addEventListener('click',onDone);
  return {
    start(now){done.clear();select(0,now);},
    move(action,now){if(action==='previous')select(index-1,now);if(action==='next'||action==='choose')select(index+1,now);if(action==='back')onDone();},
    tick(frames,now,count){
      const elapsed=(now-started)/1000,phase=Math.floor(elapsed/4);
      if(phase>0){select(index+1,now);return;}
      const move=cards[index],demo=Math.floor(elapsed/.8);
      if(move==='sweep')for(let p=0;p<count;p++)stage.setSweepProgress(Math.min(1,(elapsed%3)/2.3),p);
      else if(demo!==cycle){cycle=demo;for(let p=0;p<count;p++)stage.strike(move==='photo'?MOVE_IDS[demo%MOVE_IDS.length]:move,p);}
      if(move==='photo')return;
      for(let player=0;player<count;player++){const frame=frames[player],p=practice[player];if(!frame?.tracked)continue;
        if(move!=='sweep'&&!done.has(move)&&(frame.scores?.[move]||0)>.7){done.add(move);render();}
        if(move==='sweep') {
          const angle=frame.upperArmAngle??frame.armAngle;
          if(!p.notes&&angle&&Math.abs(angle.left)>=2.2&&Math.abs(angle.right)>=2.2){p.notes=[{t:0,move:'sweep',dur:2.3}];p.start=now;p.judge.reset();}
          if(p.notes)for(const result of p.judge.update(frame,(now-p.start)/1000,p.notes)){if(result.result==='perfect'||result.result==='good'){if(!done.has('sweep')){done.add('sweep');render();}p.notes=null;}else if(result.result==='miss')p.notes=null;}
        }
      }
    },
  };
}
