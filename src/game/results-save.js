import {heroName,saveHeroProfile} from './hero-profile.js';
import {buildScoreEntry} from './versus.js';
import {postedRank} from './posting.js';
export function createResultsSave({board,session,profiles,onChange=()=>{},now=()=>Date.now(),remember=saveHeroProfile}){
  const saved=profiles.map(()=>null),ranks=profiles.map(()=>undefined),skipped=new Set();let phase=board.enabled?'ready':'offline',message='',until=0,partial=0,attemptedPhotos=0,active=true;
  function finish(){phase='saved';const shared=saved.some(s=>s?.entry.share_shots);message=partial?`Score saved, ${partial} of ${attemptedPhotos} photos didn't upload. They're in your download.`:shared?'Saved! Your photos are on the Wall of Heroes.':'Saved! Photos stayed on this laptop.';if(skipped.size)message+=' '+[...skipped].map(i=>`P${i+1} not saved (no name).`).join(' ');onChange();}
  const model={saved,ranks,skipped,profiles,get phase(){return phase;},get message(){return message;},get seconds(){return Math.max(0,Math.ceil((until-now())/1000));},get done(){return phase==='saved';},get busy(){return phase==='saving';},close(){active=false;},sync(){if(phase==='offline'&&board.enabled){phase='ready';message='';}else if(!board.enabled&&phase!=='saving'&&phase!=='saved')phase='offline';if(phase==='rate'&&!model.seconds)phase='ready';onChange();},
    async save(withPhotos,shots=[]){if(!active||model.busy||phase==='saved'||model.seconds||!board.enabled)return;
      const pending=profiles.map((p,i)=>({p,i})).filter(({p,i})=>!saved[i]&&heroName(p.name));
      skipped.clear();profiles.forEach((p,i)=>{if(!saved[i]&&!heroName(p.name))skipped.add(i);});
      if(!pending.length){if(saved.some(Boolean))finish();else{phase='no-name';message='Add a hero name to save.';onChange();}return;}phase='saving';onChange();
      for(const {p,i} of pending){message=profiles.length>1?`Saving P${i+1}…`:withPhotos?`Uploading ${shots.length} photos…`:'Saving your score…';onChange();
        const entry=buildScoreEntry(session,i,{name:heroName(p.name),country:p.country},withPhotos);
        try{const result=await board.submit(entry,withPhotos?shots.map(s=>s.blob):[]);saved[i]={...result,entry};remember(i,p);partial+=result.shotErrors?.length||0;if(withPhotos)attemptedPhotos+=shots.length;
          try{ranks[i]=postedRank(await board.leaderboard({songId:entry.song_id,difficulty:'normal',limit:100,fresh:true}),result.id,entry);}catch{ranks[i]='unavailable';}
          if(!active)return;onChange();
        }catch(error){if(!active)return;if(error.code==='rate_limited'){phase='rate';until=now()+Math.max(1,Number(error.retryAfter??error.retry_after)||60)*1000;message='Whoa, too many saves from this connection. Hang on, nothing is lost.';}else{phase='failed';message="Couldn't save. Your photos are still here.";const details=Array.isArray(error.errors)?error.errors.map(e=>e.message).filter(Boolean).join(' '):'';if(details)message+=' '+details;}onChange();return;}
      }
      finish();
    },
  };return model;
}
