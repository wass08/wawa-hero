import {afterEach,describe,expect,it,vi} from 'vitest';
import {createTutorial} from '../hud/tutorial.js';
import {createSyntheticPose} from '../pose/index.js';
function node(){const classes=new Set();return {children:[],style:{},handlers:{},textContent:'',append(n){this.children.push(n);},addEventListener(event,fn){this.handlers[event]=fn;},classList:{toggle(c,on){on?classes.add(c):classes.delete(c);},contains(c){return classes.has(c);}}};}
afterEach(()=>vi.unstubAllGlobals());
describe('moves tutorial',()=>{
  it('judges either player’s live sweep independently when they begin at different times',()=>{
    const nodes=new Map(['tutorialMoves','tutorialName','tutorialInstruction','tutorialIcon','tutorialProgress','tutorialPrev','tutorialNext','tutorialDone'].map(id=>[id,node()]));
    vi.stubGlobal('document',{getElementById:id=>nodes.get(id),createElement:node});
    const stage={strike:vi.fn(),setSweepProgress:vi.fn()},tutorial=createTutorial({stage,onDone:vi.fn()});
    tutorial.start(0);tutorial.move('previous',0);tutorial.move('previous',0);
    const p2=createSyntheticPose({player:1});p2.press('sweep',{t:400,dur:2.3});
    const p1={t:0,source:'camera:0',tracked:true,upperArmAngle:{left:2.9,right:2.9},elbowVis:{left:1,right:1},scores:{}};
    for(let t=0;t<=3100;t+=50){p1.t=t;const frame=t>=400?{...p2.update(t),tracked:true}:null;tutorial.tick([p1,frame],t,2);}
    expect(nodes.get('tutorialMoves').children[5].classList.contains('done')).toBe(true);
    expect(nodes.get('tutorialProgress').textContent).toContain('1 / 6');
  });
});
