import {createPolaroidTexture} from './polaroid.js';
// The home wall celebrates people; ranks appear only after posting a result.
export function createHomeHUD(board) {
  const wall=document.getElementById?.('playerWall'),gallery=document.getElementById?.('wallGallery');
  if(!wall||!gallery)return {refresh(){},tick(){}};
  let entries=[],loading=false,lastCycle=-1,loadedAt=-Infinity,textures=[];
  function paintWall(cycle) {
    gallery.hidden=!entries.length;for(const texture of textures)texture.close();textures=[];wall.replaceChildren();
    for(let i=0;i<Math.min(4,entries.length);i++) {
      const row=entries[(cycle*4+i)%entries.length],tile=document.createElement('figure');tile.className='polaroid';
      const texture=createPolaroidTexture(row,{photoUrl:board.shotUrl(row.shots[0]),loadFlagImage:board.loadFlagImage});textures.push(texture);
      texture.canvas.setAttribute('role','img');texture.canvas.setAttribute('aria-label',`${row.player_name} · ${Number(row.score).toLocaleString('en-US')} points${row.mode==='versus'?' · two players':''}`);
      tile.append(texture.canvas);wall.append(tile);
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
