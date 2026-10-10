import {loadGameFonts,drawNumeralText} from '../typography.js';
// High-resolution canvas can be displayed directly or used as a CanvasTexture.
// Explicit flag bounds keep SVGs out of the caption's text/layout flow.
export function polaroidLayout(country,width=640){
  const margin=width*.025,photo={x:margin,y:margin,w:width-2*margin,h:(width-2*margin)*9/16},flagWidth=width*.14;
  return {width,height:Math.round(photo.y+photo.h+width*.15),photo,flag:country?{x:width-margin-width*.016-flagWidth,y:margin+width*.016,w:flagWidth,h:flagWidth*3/4}:null,caption:{x:margin,y:photo.y+photo.h+width*.064,w:photo.w}};
}
export function drawPolaroid(ctx,row,photo,flag,layout=polaroidLayout(row.country)){
  const {width,height,caption}=layout,p=layout.photo;
  ctx.clearRect(0,0,width,height);ctx.fillStyle='#f7f4ff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#24163d';ctx.fillRect(p.x,p.y,p.w,p.h);
  if(photo){const aspect=(photo.naturalWidth||photo.width)/(photo.naturalHeight||photo.height),target=p.w/p.h;let sw=photo.naturalWidth||photo.width,sh=photo.naturalHeight||photo.height,sx=0,sy=0;if(aspect>target){const cropped=sh*target;sx=(sw-cropped)/2;sw=cropped;}else{const cropped=sw/target;sy=(sh-cropped)/2;sh=cropped;}ctx.drawImage(photo,sx,sy,sw,sh,p.x,p.y,p.w,p.h);}
  if(flag&&layout.flag){const f=layout.flag;ctx.save();ctx.shadowColor='#08051ac0';ctx.shadowBlur=width*.009;ctx.shadowOffsetY=width*.005;ctx.fillStyle='#120b28';ctx.fillRect(f.x-2,f.y-2,f.w+4,f.h+4);ctx.shadowColor='transparent';ctx.drawImage(flag,f.x,f.y,f.w,f.h);ctx.restore();}
  const name=String(row.player_name||'Hero').slice(0,16);let font=width*.063;ctx.fillStyle='#120b28';ctx.textAlign='left';ctx.font=`700 ${font}px "Chakra Petch",system-ui,sans-serif`;
  const measured=ctx.measureText(name).width;if(measured>caption.w){font*=caption.w/measured;ctx.font=`700 ${font}px "Chakra Petch",system-ui,sans-serif`;}
  ctx.fillText(name,caption.x,caption.y,caption.w);ctx.fillStyle='#55476e';ctx.font=`${width*.033}px "Chakra Petch",system-ui,sans-serif`;
  drawNumeralText(ctx,`${Number(row.score||0).toLocaleString('en-US')} pts${row.mode==='versus'?' · 2P':''}`,caption.x,caption.y+width*.046,{spacing:0,maxWidth:caption.w});
}
export function createPolaroidTexture(row,{photoUrl,loadFlagImage,onUpdate=()=>{},imageFactory=()=>new Image()}={}){
  const layout=polaroidLayout(row.country),canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;
  const ctx=canvas.getContext('2d');let photo=null,flag=null,closed=false,fontReady=!document.fonts?.load;
  function redraw(){if(closed||!fontReady)return;drawPolaroid(ctx,row,photo,flag,layout);onUpdate(canvas);}
  if(!fontReady)loadGameFonts().then(()=>{fontReady=true;redraw();});
  redraw();const image=imageFactory();image.crossOrigin='anonymous';image.onload=()=>{photo=image;redraw();};image.onerror=()=>redraw();image.src=photoUrl;
  if(row.country)Promise.resolve(loadFlagImage(row.country)).then(image=>{flag=image;redraw();}).catch(()=>{});
  return {canvas,close(){closed=true;image.onload=image.onerror=null;}};
}
