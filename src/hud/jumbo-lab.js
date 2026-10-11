import {createStage} from '../engine/stage.js';
import {JUMBO_LOOK,JUMBO_LIMITS} from '../engine/jumbo-look.js';
import {createCamera} from '../camera.js';
import {buttonClasses} from './button.js';
import '../styles/jumbo-lab.css';
export async function createJumboLab(params){
  document.getElementById('hud').hidden=true;
  const root=document.createElement('main');root.className='jumbo-lab';
  const presets=[['current','CURRENT · 5 TONES / 60 ROWS'],['A','A · 8 / 90'],['live','B · 10 / 100 · DEFAULT'],['C','C · 12 / 130']];
  root.innerHTML=`<header><div><span class="label">WAWA HERO · JUMBOTRON LAB</span><h1>Stylized. Recognizable.</h1></div><span id="labStatus">Avatar cam</span><button class="${buttonClasses()}" id="labCamera">Enable camera</button></header><section class="lab-presets">${presets.map(([key,label])=>`<article><h2>${label}</h2><div class="lab-feed" data-look="${key}"></div></article>`).join('')}</section><section class="lab-bottom"><div class="lab-controls panel"><span class="label">TUNE B · LIVE LOOK</span><div class="lab-sliders">${Object.entries(JUMBO_LIMITS).map(([key,[min,max,step]])=>`<label><span>${key==='dotSoftness'?'Dot softness':key}<output id="lab-${key}">${JUMBO_LOOK.live[key]}</output></span><input type="range" data-param="${key}" aria-label="${key}" min="${min}" max="${max}" step="${step}" value="${JUMBO_LOOK.live[key]}"></label>`).join('')}</div><p>Same feed, same palette. Finer LEDs and more tones preserve faces, hair and outfits.</p><button id="labCopy" class="${buttonClasses('primary')}">Copy settings</button><output id="labCopyStatus" role="status"></output><textarea id="labJSON" aria-label="JUMBO_LOOK settings" readonly></textarea><p class="lab-performance" id="labPerformance"></p></div><article class="lab-photo"><h2>PHOTO PREVIEW · 14 TONES / 160 ROWS</h2><div class="lab-feed" data-look="photo"></div><p>Rendered at 1280 × 720, then saved as a 960 × 540 WebP.</p></article></section>`;
  document.body.append(root);
  const custom={...JUMBO_LOOK.live},looks={...JUMBO_LOOK,live:custom};
  const panels=[...root.querySelectorAll('.lab-feed')].map(element=>({element,look:looks[element.dataset.look]}));
  let stage;const intervals=[],maxSamples=180;let last=0;
  const camera=createCamera({onStatus(status){root.querySelector('#labStatus').textContent=status==='live'?'Live camera · one shared feed':status==='requesting'?'Requesting camera…':'Avatar cam · camera optional';},onLive(){stage?.setVideo();}});
  stage=createStage({container:document.getElementById('stage'),video:camera.video,jumbotron:true,wall:'cam',crowd:false,beams:0,avatar:{x:0,z:.6,scale:1.45},onFrame(_,dt,now){if(last)intervals.push(now-last);last=now;if(intervals.length>maxSamples)intervals.shift();if(intervals.length===maxSamples){const average=intervals.reduce((a,b)=>a+b,0)/intervals.length;root.querySelector('#labPerformance').textContent=`${Math.round(1000/average)} fps · ${average.toFixed(1)} ms/frame · one renderer`;}}});
  stage.setJumboPanels(()=>panels);stage.strike('split_lu');
  for(const input of root.querySelectorAll('[data-param]'))input.addEventListener('input',()=>{const key=input.dataset.param;custom[key]=Number(input.value);root.querySelector(`#lab-${key}`).textContent=custom[key];stage.setJumboLook(custom);});
  root.querySelector('#labCamera').onclick=()=>camera.enable();
  root.querySelector('#labCopy').onclick=async()=>{const json=JSON.stringify({...JUMBO_LOOK,live:custom},null,2),out=root.querySelector('#labJSON');out.value=json;out.hidden=false;try{await navigator.clipboard.writeText(json);root.querySelector('#labCopyStatus').textContent='Copied JUMBO_LOOK JSON';}catch{out.focus();out.select();root.querySelector('#labCopyStatus').textContent='Select and copy the JSON below';}};
  root.querySelector('#labJSON').hidden=true;
  addEventListener('pagehide',()=>camera.close());
  if(!params.has('nocam'))void camera.enable();
  return {state:'jumbolab',stage,camera,looks,intervals,
    async comparison(){
      // Both GPU renders happen synchronously before either encoder is awaited.
      const captures=[stage.captureJumbotron({look:JUMBO_LOOK.current,width:1280,height:720,type:'image/png'}),stage.captureJumbotron({look:JUMBO_LOOK.photo,width:1280,height:720,type:'image/png'})];
      const images=await Promise.all((await Promise.all(captures)).map(blob=>createImageBitmap(blob)));
      const c=document.createElement('canvas');c.width=2560;c.height=800;const ctx=c.getContext('2d');ctx.fillStyle='#120c23';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#fff6df';ctx.font='600 28px "Chakra Petch"';
      ctx.fillText('BEFORE · 5 TONES / 60 ROWS',32,52);ctx.fillText('PHOTO · 14 TONES / 160 ROWS',1312,52);images.forEach((im,i)=>{ctx.drawImage(im,i*1280,80);im.close();});return c.toDataURL('image/png');
    }};
}
