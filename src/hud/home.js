// The home wall celebrates people; ranks appear only after posting a result.
export function createHomeHUD(board) {
  const wall=document.getElementById?.('playerWall'),gallery=document.getElementById?.('wallGallery');
  if(!wall||!gallery)return {refresh(){},tick(){}};
  let entries=[],loading=false,lastCycle=-1,loadedAt=-Infinity;
  function paintWall(cycle) {
    gallery.hidden=!entries.length;wall.replaceChildren();
    for(let i=0;i<Math.min(4,entries.length);i++) {
      const row=entries[(cycle*4+i)%entries.length],tile=document.createElement('figure');tile.className='polaroid';
      const img=document.createElement('img');img.alt=`${row.player_name} on stage`;img.src=board.shotUrl(row.shots[0]);
      const name=document.createElement('figcaption');name.append(board.flagElement(row.country),document.createTextNode(' '+row.player_name));
      tile.append(img,name);wall.append(tile);
    }
  }
  return {
    async refresh(){if(loading||performance.now()-loadedAt<30000)return;loading=true;
      try{entries=(await board.wall({limit:24})).filter(row=>row.shots?.length);}
      catch{entries=[];}
      finally{loading=false;loadedAt=performance.now();paintWall(0);}
    },
    tick(now){const cycle=Math.floor(now/6000);if(cycle!==lastCycle){lastCycle=cycle;if(entries.length)paintWall(cycle);}},
  };
}
