import { MOVE_IDS } from '../moves.js';
export const P2_KEYS = { Digit7:'up',Digit8:'down',Digit9:'clap',Digit0:'split_lu',Minus:'split_ld',Equal:'sweep',Numpad7:'up',Numpad8:'down',Numpad9:'clap',Numpad0:'split_lu',NumpadSubtract:'split_ld',NumpadAdd:'sweep' };
export const modeCount = value => value === 'versus' || value === '2p' || Number(value) === 2 ? 2 : 1;
export const toggleMode = value => modeCount(value) === 1 ? 2 : 1;
export function versusRanks(scores) { if(scores.length<2)return [null];return scores[0]===scores[1]?[1,1]:scores[0]>scores[1]?[1,2]:[2,1]; }
export function winnerText(scores) { if(scores.length<2)return 'NICE MOVES!';const ranks=versusRanks(scores);return ranks[0]===ranks[1]?"IT’S A TIE!":`PLAYER ${ranks[0]===1?1:2} WINS!`; }
export const emptyScore = () => ({score:0,combo:0,maxCombo:0,mult:1,hype:0.55,stars:0,stats:{perfect:0,good:0,miss:0}});
export function sweepDescent(frame) {
  const a=frame?.upperArmAngle ?? frame?.armAngle;
  if(!a)return null;
  return Math.max(0,Math.min(1,1-(Math.abs(a.left)+Math.abs(a.right))/(2*Math.PI)));
}
export const cloneNotes = notes => notes.filter(n=>MOVE_IDS.includes(n.move)).map(n=>({t:n.t,move:n.move,...(n.dur?{dur:n.dur}:{})}));
export const allReleased = frame => MOVE_IDS.every(m=>(frame?.scores?.[m]||0)<0.1);
export function buildScoreEntry(session,player,profile,shareShots=false) {
  const p=session.players[player],score=p.score;
  return {song_id:session.song.id,difficulty:'normal',mode:session.players.length===2?'versus':'solo',versus_rank:versusRanks(session.players.map(p=>p.score.score))[player],player_name:profile.name,country:profile.country??null,score:score.score,stars:score.stars,max_combo:score.maxCombo,perfect:score.stats.perfect,good:score.stats.good,miss:score.stats.miss,kcal:Math.round(p.kcal*10)/10,duration_s:Math.round(session.duration),share_shots:shareShots,client_version:'web/0.1.0'};
}
