// Canned/offline modes never import the network client or submit real data.
import * as countryData from '../net/countries.js';
import {createFlags} from './flags.js';
function polaroid(seed) {return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#24163d"/><path d="M0 90h640M0 180h640M0 270h640" stroke="#382356" stroke-width="2"/><g fill="${seed%2?'#dd3d91':'#40cddd'}"><path d="M240 210v-90h-70v-65h-25v90h70v65zm160 0v-90h70v-65h25v90h-70v65z"/><rect x="282" y="96" width="76" height="64"/><rect x="260" y="172" width="120" height="112"/><rect x="270" y="284" width="35" height="70"/><rect x="335" y="284" width="35" height="70"/></g><g fill="#b89ee9" opacity=".5">${Array.from({length:28},(_,i)=>`<rect x="${(i*137+seed*51)%640}" y="${(i*71)%360}" width="4" height="4"/>`).join('')}</g></svg>`);}
export const fakeRows=Array.from({length:10},(_,i)=>({id:`demo-${i}`,player_name:['ALEXANDRA PIXELS','MOONWALK','JULES','BEATRICE HERO 02','NO COUNTRY','NOVA','LUCKY','SORA','MIA','WAWA'][i],country:['FR','US','JP','BR',null,'CA','KR','DE','AU','ES'][i],mode:i===1||i===3?'versus':'solo',score:48200-i*2170,kcal:15.4-i*.7,stars:i<7?3:2,shots:[polaroid(i)],share_shots:true}));
export async function createBoardClient(params=new URLSearchParams(),{
  netLoader=()=>import('../net/scoreboard.js'),countryLoader=async()=>countryData,
}={}) {
  const fake=params.has('fakeboard'),simulate=fake&&['post','error','rate'].includes(params.get('fakeboard'));
  const empty=params.get('fakeboard')==='empty',demoRows=params.get('fakeboard')==='flags'?fakeRows.slice(0,5):fakeRows;
  const offline=params.has('offline')||fake&&!simulate,posted=[];
  const countriesModule=await countryLoader();
  const flags=createFlags(countriesModule);
  const net=!offline&&!fake?await netLoader():null;
  const savedListeners=new Set();
  const client={
    get enabled(){return !offline&&(simulate||net?.scoreboardEnabled)&&globalThis.navigator?.onLine!==false;},
    get offline(){return offline||globalThis.navigator?.onLine===false;},fake,
    onScoreSaved(listener){savedListeners.add(listener);return()=>savedListeners.delete(listener);},
    countries:countriesModule.COUNTRIES,guessCountry:countriesModule.guessCountry,
    flag:code=>code||'',
    flagUrl:flags.url,
    loadFlagImage:flags.image,
    flagElement:flags.element,
    leaderboard:options=>fake?Promise.resolve((empty?[]:[...demoRows,...posted.map((p,i)=>({...p.entry,id:`fake-${i+1}`}))]).sort((a,b)=>b.score-a.score).map((row,i,rows)=>({...row,rank:rows.findIndex(r=>r.score===row.score)+1})).slice(0,options?.limit??10)):!offline&&net.scoreboardEnabled?net.fetchLeaderboard(options):Promise.resolve([]),
    wall:options=>fake?Promise.resolve(empty?[]:demoRows.slice(0,options?.limit??24)):!offline&&net.scoreboardEnabled?net.fetchWall(options):Promise.resolve([]),
    shotUrl:path=>path?.startsWith('data:')?path:net?.shotUrl(path)||'',
    submit(entry,blobs=[]){
      if(offline||!this.enabled)return Promise.reject(Error('Posting is unavailable offline.'));
      if(simulate)return new Promise((resolve,reject)=>setTimeout(()=>{
        if(params.get('fakeboard')==='error')return reject(Object.assign(Error('Simulated connection failure'),{code:'network',retryable:true}));
        if(params.get('fakeboard')==='rate')return reject(Object.assign(Error('Lots of dancers are posting. Try again shortly.'),{code:'rate_limited',retryable:true}));
        posted.push({entry:structuredClone(entry),photos:blobs.length});resolve({id:`fake-${posted.length}`,shots:blobs.map((_,i)=>`fake-shot-${i}`),shotErrors:[]});
      },350));
      return net.submitScore(entry,blobs);
    },
    get posted(){return posted;},
  };
  const submit=client.submit;
  client.submit=async(entry,blobs=[])=>{
    const result=await submit.call(client,entry,blobs);
    for(const listener of savedListeners)try{listener(entry);}catch{}
    return result;
  };
  return client;
}
