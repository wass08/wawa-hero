import {COUNTRIES} from '../net/countries.js';
const countryCodes=new Set(COUNTRIES.map(c=>c.code));
export const heroName=value=>String(value??'').trim().replace(/\s+/g,' ').slice(0,16);
export function loadHeroProfile(slot,guess=null,storage=globalThis.localStorage){
  let saved;try{saved=JSON.parse(storage?.getItem(`wh.hero.p${slot+1}`));}catch{}
  return {name:heroName(saved?.name),country:countryCodes.has(saved?.country)?saved.country:countryCodes.has(guess)?guess:null};
}
export function saveHeroProfile(slot,profile,storage=globalThis.localStorage){const value={name:heroName(profile.name),country:countryCodes.has(profile.country)?profile.country:null,at:Date.now()};try{storage?.setItem(`wh.hero.p${slot+1}`,JSON.stringify(value));}catch{}return value;}
