// Weighted interval selection: maximise quality, at most four, ≥15s apart.
export function selectHeroShots(candidates,limit=4,gap=15) {
  const shots=candidates.filter(s=>Number.isFinite(s.t)&&s.blob).slice().sort((a,b)=>a.t-b.t);
  const n=shots.length, dp=Array.from({length:n+1},()=>Array(limit+1).fill(0)),take=Array.from({length:n+1},()=>Array(limit+1).fill(false)),prev=[];
  for(let i=0;i<n;i++) {let j=i-1;while(j>=0&&shots[i].t-shots[j].t<gap)j--;prev[i]=j+1;
    for(let k=1;k<=limit;k++){const yes=(shots[i].quality??1)+dp[j+1][k-1],no=dp[i][k];dp[i+1][k]=Math.max(yes,no);take[i+1][k]=yes>no;}}
  const chosen=[];let i=n,k=limit;
  while(i>0&&k>0){if(take[i][k]){chosen.push(shots[i-1]);i=prev[i-1];k--;}else i--;}
  return chosen.reverse();
}
export function stripLayout(count=4,width=720) {
  const margin=24,gap=14,photoWidth=width-2*margin,photoHeight=Math.round(photoWidth*9/16),header=174,footer=90;
  return {width,height:header+count*(photoHeight+gap)+footer,header,footer,shots:Array.from({length:count},(_,i)=>({x:margin,y:header+i*(photoHeight+gap),w:photoWidth,h:photoHeight}))};
}
function loadFlag(src){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;});}
function drawStar(ctx,x,y,fill){ctx.fillStyle=fill;ctx.beginPath();for(let i=0;i<10;i++){const r=i%2?4:10,a=-Math.PI/2+i*Math.PI/5;const xx=x+Math.cos(a)*r,yy=y+Math.sin(a)*r;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);}ctx.closePath();ctx.fill();}
export const canvasBlob = (canvas,quality=.8) => new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Photo export failed')),'image/webp',quality));
export async function renderStrip(shots,{name,flagUrl='',score,kcal,stars=0,song='',date=new Date()}={}) {
  const layout=stripLayout(4),canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#120b28';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#f7f4ff';ctx.font='700 54px "Pixelify Sans", monospace';ctx.fillText('WAWA HERO',24,62);
  ctx.font='20px "Rubik", sans-serif';ctx.fillStyle='#36ddf1';if(flagUrl){const flag=await loadFlag(flagUrl);ctx.drawImage(flag,24,77,27,20);}
  ctx.fillText(`${name||'Player'} · ${Number(score||0).toLocaleString()} points`,flagUrl?60:24,94);
  ctx.fillStyle='#bcb0d1';ctx.font='20px "Rubik", sans-serif';ctx.fillText(song,24,127);
  for(let i=0;i<3;i++)drawStar(ctx,34+i*26,149,i<stars?'#ffd532':'#453454');
  for(let i=0;i<4;i++) {const r=layout.shots[i],shot=shots[i];ctx.fillStyle='#312046';ctx.fillRect(r.x,r.y,r.w,r.h);
    if(shot?.blob) {const bitmap=await createImageBitmap(shot.blob);ctx.drawImage(bitmap,r.x,r.y,r.w,r.h);bitmap.close();}
    else {ctx.fillStyle='#917bba';ctx.font='700 32px "Pixelify Sans", monospace';ctx.fillText('YOUR NEXT HERO MOMENT',r.x+28,r.y+r.h/2);}
    ctx.strokeStyle=i%2?'#df368b':'#36ddf1';ctx.lineWidth=4;ctx.strokeRect(r.x,r.y,r.w,r.h);}
  ctx.font='22px "Rubik", sans-serif';ctx.fillStyle='#f7f4ff';ctx.fillText(`${Number(kcal||0).toFixed(1)} kcal · ${date.toLocaleDateString()}`,24,canvas.height-44);
  ctx.font='17px "JetBrains Mono", monospace';ctx.fillStyle='#bcb0d1';ctx.fillText('ARMS UP. MUSIC ON. YOU ARE THE HERO.',24,canvas.height-16);
  return canvasBlob(canvas,.85);
}
export function selectRunShots(cueShots,candidates) {
  const photos=cueShots.slice().sort((a,b)=>a.t-b.t).slice(0,4);
  const fallback=candidates.filter(s=>photos.every(p=>Math.abs(p.t-s.t)>=15));
  return photos.concat(selectHeroShots(fallback,4-photos.length)).sort((a,b)=>a.t-b.t);
}
export function createHeroCollector({capture,bpm=120,onCapture=()=>{}}) {
  let candidates=[],cueShots=[],cueTimes=[],last=-Infinity,epoch=0;
  const pending=new Set(),snapped=new Set();
  function take(meta,photo){
    const generation=epoch;
    // Read pixels immediately at the audio-clock crossing; encoding is async.
    let image;try{image=capture();}catch{return;}
    const job=Promise.resolve(image).then(blob=>{
      if(blob&&generation===epoch){const shot={...meta,blob,photo};(photo?cueShots:candidates).push(shot);onCapture(shot);}
    }).catch(()=>{}).finally(()=>pending.delete(job));pending.add(job);
  }
  return {
    offer({t,quality=1,realCamera=false}) {
      if(cueTimes.length>=4||t-last<480/bpm||cueTimes.some(c=>Math.abs(c-t)<15))return;
      last=t;take({t,quality,realCamera},false);
    },
    photo({t,realCamera=false}){if(snapped.has(t))return;snapped.add(t);take({t,realCamera,quality:100},true);},
    async finish(){await Promise.allSettled([...pending]);return selectRunShots(cueShots,candidates);},
    reset(nextBpm=bpm,notes=[]){epoch++;candidates=[];cueShots=[];cueTimes=notes.filter(n=>n.move==='photo').map(n=>n.t);last=-Infinity;bpm=nextBpm;snapped.clear();},
    get candidates(){return candidates;},get cueShots(){return cueShots;},
  };
}
