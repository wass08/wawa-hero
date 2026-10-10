import * as countries from '../net/countries.js';
import {describe,it,expect,vi} from 'vitest';
import {modeCount,toggleMode,versusRanks,winnerText,P2_KEYS,cloneNotes,buildScoreEntry,emptyScore} from '../game/versus.js';
import {selectHeroShots,stripLayout,createHeroCollector} from '../game/photos.js';
import {updatePlayers,setTrackerPlayers} from '../services/pose.js';
import {validateEntry} from '../net/scoreboard.js';
import {createBoardClient} from '../services/scoreboard.js';
const photo=(t,quality)=>({t,quality,blob:new Blob(['image'],{type:'image/webp'})});
describe('round 4 pure contracts',()=>{
  it('toggles solo/versus and accepts deep-link mode values',()=>{expect(modeCount('2p')).toBe(2);expect(modeCount('versus')).toBe(2);expect(modeCount('2')).toBe(2);expect(modeCount(undefined)).toBe(1);expect(toggleMode(1)).toBe(2);expect(toggleMode(2)).toBe(1);});
  it('ranks both players, including a tie and solo',()=>{expect(versusRanks([300,100])).toEqual([1,2]);expect(versusRanks([100,300])).toEqual([2,1]);expect(versusRanks([100,100])).toEqual([1,1]);expect(versusRanks([100])).toEqual([null]);expect(winnerText([100,100])).toContain('TIE');expect(winnerText([100,300])).toBe('PLAYER 2 WINS!');});
  it('maps all six P2 keys independently of the P1 driver',()=>{expect(['Digit7','Digit8','Digit9','Digit0','Minus','Equal'].map(k=>P2_KEYS[k])).toEqual(['up','down','clap','split_lu','split_ld','sweep']);expect(P2_KEYS.Digit1).toBeUndefined();});
  it('keeps mutable judging fields independent for each player',()=>{const original=[{t:1,move:'up'},{t:2,move:'sweep',dur:2}],p1=cloneNotes(original),p2=cloneNotes(original);p1[0].judged=true;expect(p2[0].judged).toBeUndefined();expect(original[0].judged).toBeUndefined();expect(p2[1].dur).toBe(2);});
  it('selects the maximum-quality collection rather than greedily taking one expensive shot',()=>{const selected=selectHeroShots([photo(0,7),photo(12,12),photo(24,7)],4,15);expect(selected.map(p=>p.t)).toEqual([0,24]);});
  it('keeps at most four shots, chronological, with exactly-15-second boundaries allowed',()=>{const selected=selectHeroShots([photo(0,1),photo(15,9),photo(29.9,99),photo(30,9),photo(45,9),photo(60,9),photo(75,9)]);expect(selected).toHaveLength(4);for(let i=1;i<selected.length;i++)expect(selected[i].t-selected[i-1].t).toBeGreaterThanOrEqual(15);expect(selected.some(p=>p.t===29.9)).toBe(true);expect(selectHeroShots([])).toEqual([]);expect(selectHeroShots([photo(0,1),photo(15,1)]).map(p=>p.t)).toEqual([0,15]);});
  it('places four 16:9 photos within a branded strip without overlap',()=>{const l=stripLayout();expect(l.width).toBe(720);expect(l.shots).toHaveLength(4);for(let i=0;i<4;i++){const r=l.shots[i];expect(r.w/r.h).toBeCloseTo(16/9,2);expect(r.x+r.w).toBeLessThan(l.width);expect(r.y+r.h).toBeLessThan(l.height-l.footer);if(i)expect(r.y).toBeGreaterThan(l.shots[i-1].y+l.shots[i-1].h);}expect(l.shots[0].y).toBe(l.header);});
  it('rate-limits candidates to two bars and excludes old asynchronous captures after restart',async()=>{let resolve;const capture=vi.fn(()=>new Promise(r=>{resolve=r;})),collector=createHeroCollector({capture,bpm:120});collector.offer({t:1});collector.offer({t:4.99});await Promise.resolve();expect(capture).toHaveBeenCalledOnce();collector.reset();resolve(new Blob(['old']));await collector.finish();expect(collector.candidates).toHaveLength(0);});
  it('calls updateAll once and preserves empty P1 / occupied P2 slots',()=>{const f={player:1},tracker={updateAll:vi.fn(()=>[null,f]),update:vi.fn(),setMaxPlayers:vi.fn()},out=[null,null];expect(updatePlayers(tracker,100,2,out)).toEqual([null,f]);expect(tracker.updateAll).toHaveBeenCalledOnce();expect(tracker.update).not.toHaveBeenCalled();setTrackerPlayers(tracker,2);expect(tracker.setMaxPlayers).toHaveBeenCalledWith(2);});
  it('clears both slots when no tracker is active',()=>{expect(updatePlayers(null,100,2,[{},{}])).toEqual([null,null]);});
  it.each(['?fakeboard','?offline'])('never loads or submits to the network under %s',async query=>{const load=vi.fn(async()=>({scoreboardEnabled:true,submitScore:vi.fn()}));const board=await createBoardClient(new URLSearchParams(query),{netLoader:load});expect(board.enabled).toBe(false);await expect(board.submit({score:999})).rejects.toThrow('offline');expect(load).not.toHaveBeenCalled();const rows=await board.leaderboard({limit:10});expect(rows.length).toBe(query==='?fakeboard'?10:0);});
  it('builds backend-valid per-player entries, with both tie ranks equal to one',()=>{
    const s=emptyScore();Object.assign(s,{score:1000,stars:2,maxCombo:12});
    const session={song:{id:'system-online'},difficulty:'normal',duration:183.5,players:[{score:s,kcal:12.81},{score:structuredClone(s),kcal:11.24}]};
    const one=buildScoreEntry(session,0,{name:'Pixel',country:'JP'},true),two=buildScoreEntry(session,1,{name:'Nova',country:'BR'});
    expect(one.versus_rank).toBe(1);expect(two.versus_rank).toBe(1);expect(one.mode).toBe('versus');expect(one.share_shots).toBe(true);expect(two.share_shots).toBe(false);
    expect(one.kcal).toBe(12.8);expect(two.kcal).toBe(11.2);expect(validateEntry(one).ok).toBe(true);expect(validateEntry(two).ok).toBe(true);
    expect(buildScoreEntry({...session,players:session.players.slice(0,1)},0,{name:'Solo'}).versus_rank).toBe(null);
  });
  it('integrates the real module-shaped client through the adapter using only stubbed calls',async()=>{
    const submit=vi.fn(async()=>({id:'stub',shots:[]})),leaderboard=vi.fn(async()=>[]),wall=vi.fn(async()=>[]);
    const board=await createBoardClient(new URLSearchParams(),{netLoader:async()=>({scoreboardEnabled:true,submitScore:submit,fetchLeaderboard:leaderboard,fetchWall:wall,shotUrl:p=>'stub:'+p}),countryLoader:async()=>({...countries,COUNTRIES:[{code:'JP',name:'Japan'}],guessCountry:()=> 'JP',flagEmoji:()=> '🇯🇵'})});
    expect(board.enabled).toBe(true);expect(board.guessCountry()).toBe('JP');expect(board.countries).toHaveLength(1);
    const entry={score:123};await board.submit(entry);expect(submit).toHaveBeenCalledWith(entry,[]);await board.leaderboard({songId:'system-online',difficulty:'normal'});expect(leaderboard).toHaveBeenCalledOnce();await board.wall({limit:24});expect(wall).toHaveBeenCalledOnce();
  });

  it('simulates successful and failed posting locally without loading the backend',async()=>{
    const load=vi.fn();const board=await createBoardClient(new URLSearchParams('?fakeboard=post'),{netLoader:load});
    expect(board.enabled).toBe(true);await board.submit({player_name:'TEST',share_shots:false});expect(board.posted).toEqual([{entry:{player_name:'TEST',share_shots:false},photos:0}]);expect(load).not.toHaveBeenCalled();
    const error=await createBoardClient(new URLSearchParams('?fakeboard=error'),{netLoader:load});await expect(error.submit({})).rejects.toThrow('Simulated');expect(load).not.toHaveBeenCalled();
    const offline=await createBoardClient(new URLSearchParams('?fakeboard=post&offline'),{netLoader:load});expect(offline.enabled).toBe(false);await expect(offline.submit({})).rejects.toThrow('offline');
  });

  it('hides the empty canned wall and provides a local rank after a simulated post',async()=>{
    const load=vi.fn(()=>{throw Error('Network forbidden');});
    const empty=await createBoardClient(new URLSearchParams('?mute&fakeboard=empty'),{netLoader:load});
    expect(await empty.wall()).toEqual([]);expect(await empty.leaderboard()).toEqual([]);
    const board=await createBoardClient(new URLSearchParams('?mute&fakeboard=post'),{netLoader:load});
    const entry={song_id:'song',difficulty:'normal',player_name:'RANK TEST',country:'JP',score:99999,share_shots:false};
    const saved=await board.submit(entry);const rows=await board.leaderboard({songId:'song',difficulty:'normal',limit:100});
    expect(rows[0].id).toBe(saved.id);expect(rows[0].player_name).toBe('RANK TEST');expect(load).not.toHaveBeenCalled();
  });

});
