export const photoUploadAllowed=shots=>shots.length>0&&shots.every(s=>s.realCamera&&s.blob?.type==='image/webp');
export const imageExtension=blob=>blob?.type==='image/webp'?'webp':blob?.type==='image/jpeg'?'jpg':'png';
export function sweepMissTip(reason){return {'no-high':'Start with arms up high!','no-low':'Finish with arms down by your sides!','wrong-direction':'Lower your arms out to your own sides!'}[reason]||'Arms high → T → down by your sides';}
export function postedRank(rows,id,entry) {
  if (rows.error) throw rows.error;
  const index=rows.findIndex(row=>row.id===id||(row.player_name===entry.player_name&&row.country===entry.country));
  if(index<0)return null;
  const rank=Number(rows[index].rank);
  return Number.isSafeInteger(rank)&&rank>0?rank:index+1;
}
