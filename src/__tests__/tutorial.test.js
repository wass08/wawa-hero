import {afterEach,describe,expect,it,vi} from 'vitest';
import {MOVES,CUES} from '../moves.js';
import {MENU_LABELS} from '../menu-controls.js';
import {createTutorial} from '../hud/tutorial.js';
import {createSyntheticPose} from '../pose/index.js';
function node(){const classes=new Set();return {children:[],style:{},handlers:{},textContent:'',append(n){this.children.push(n);},addEventListener(event,fn){this.handlers[event]=fn;},classList:{toggle(c,on){on?classes.add(c):classes.delete(c);},contains(c){return classes.has(c);}}};}
afterEach(()=>vi.unstubAllGlobals());
describe('moves tutorial',()=>{
  it('uses LEFT UP / RIGHT UP in the shared UI tables, keeping split ids intact',()=>{
    for(const table of [MOVES,CUES]){expect(table.split_lu.label).toBe('LEFT UP');expect(table.split_ld.label).toBe('RIGHT UP');expect(table.split_ld.id).toBe('split_ld');}
    expect(MENU_LABELS.split_ld).toBe('RIGHT UP');expect(MOVES.split_lu.cue).toBe('Left forearm up, right forearm down');expect(MOVES.split_ld.cue).toBe('Right forearm up, left forearm down');
  });
  it('Back cancels practice, separately from the Ready confirmation',()=>{
    const nodes=new Map(['tutorialMoves','tutorialName','tutorialInstruction','tutorialIcon','tutorialProgress','tutorialPrev','tutorialNext','tutorialDone','tutorialBack'].map(id=>[id,node()]));
    vi.stubGlobal('document',{getElementById:id=>nodes.get(id),createElement:node});
    const onDone=vi.fn(),onBack=vi.fn(),tutorial=createTutorial({stage:{},onDone,onBack});tutorial.start(0);
    tutorial.move('back',0);expect(onBack).toHaveBeenCalledOnce();expect(onDone).not.toHaveBeenCalled();
    tutorial.move('choose',0);expect(onDone).toHaveBeenCalledOnce();
  });
  it('judges either player’s live sweep independently when they begin at different times',()=>{
    const nodes=new Map(['tutorialMoves','tutorialName','tutorialInstruction','tutorialIcon','tutorialProgress','tutorialPrev','tutorialNext','tutorialDone'].map(id=>[id,node()]));
    vi.stubGlobal('document',{getElementById:id=>nodes.get(id),createElement:node});
    const stage={strike:vi.fn(),setSweepProgress:vi.fn()},tutorial=createTutorial({stage,onDone:vi.fn()});
    tutorial.start(0);tutorial.move('previous',0);tutorial.move('previous',0);
    const p2=createSyntheticPose({player:1});p2.press('sweep',{t:400,dur:2.3});
    const p1={t:0,source:'camera:0',tracked:true,upperArmAngle:{left:2.9,right:2.9},elbowVis:{left:1,right:1},scores:{}};
    for(let t=0;t<=3100;t+=50){p1.t=t;const frame=t>=400?{...p2.update(t),tracked:true}:null;tutorial.tick([p1,frame],t,2);}
    expect(nodes.get('tutorialMoves').children[5].classList.contains('done')).toBe(true);
    expect(nodes.get('tutorialProgress').innerHTML.replace(/<[^>]*>/g,'')).toContain('1 / 6');
  });
});
