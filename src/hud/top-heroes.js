const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function paintTopHeroes(root,phase,rows=[],board) {
  root.hidden=phase==='hidden';root.dataset.phase=phase;
  root.setAttribute('aria-busy',String(phase==='loading'));
  if(phase==='hidden'){root.innerHTML='';return;}
  const body=phase==='loading'?'<div class="top-skeleton" aria-label="Loading top heroes"><i></i><i></i><i></i></div>':phase==='empty'?'<p class="top-empty">No heroes yet — be the first!</p>':`<ol>${rows.slice(0,3).map(row=>{
    const rank=Number(row.rank),flag=row.country?board.flagUrl(row.country):null;
    return `<li><b class="top-medal medal-${rank}" aria-label="Rank ${rank}">${rank}</b>${flag?`<img class="top-flag" src="${esc(flag)}" alt="${esc(row.country)}" width="24" height="18">`:'<span class="top-flag"></span>'}<span class="top-name" title="${esc(row.player_name)}">${esc(row.player_name)}</span><strong>${Number(row.score).toLocaleString('en-US')}</strong></li>`;
  }).join('')}</ol>`;
  root.innerHTML='<h3 class="label">TOP HEROES</h3>'+body;
}
export function createTopHeroes(board,root,{delay=220}={}) {
  if(!root)return {select(){},close(){}};
  let selected=null,timer,generation=0;
  function refresh(fresh=false) {
    clearTimeout(timer);const id=selected,token=++generation;
    if(!id||(!board.fake&&!board.enabled)){paintTopHeroes(root,'hidden');return;}
    paintTopHeroes(root,'loading');
    timer=setTimeout(async()=>{
      try{
        const rows=await board.leaderboard({songId:id,difficulty:'normal',limit:3,...(fresh?{fresh:true}:{})});
        if(token!==generation)return;if(rows.error)throw rows.error;
        paintTopHeroes(root,rows.length?'ready':'empty',rows,board);
      }catch{if(token===generation)paintTopHeroes(root,'hidden');}
    },delay);
  }
  const unsubscribe=board.onScoreSaved?.(entry=>{if(entry.song_id===selected)refresh(true);});
  return {
    select(id){if(selected===id)return;selected=id;refresh();},
    close(){generation++;clearTimeout(timer);unsubscribe?.();},
  };
}
