import {saveHeroProfile,heroName} from './game/hero-profile.js';
function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const savedValue = read('wh.settings');
const saved = record(savedValue) ? savedValue : {};
// Move real previously used names into per-slot memory; discard old placeholder names.
for(let i=0;i<2;i++){const profile=saved.profiles?.[i];if(!read(`wh.hero.p${i+1}`)&&heroName(profile?.name)&&!/^Player [12]$/i.test(heroName(profile.name)))saveHeroProfile(i,profile);}
export const settings = {
  players: saved.players === 2 ? 2 : 1, tutorialSeen: saved.tutorialSeen === true,
 };
// Retain mode and tutorial progress only; retire the old setup controls silently.
if (['profiles','weightKg','musicVolume','sfxVolume','levelIndex','level','calibrationMs','calibration'].some(key => key in saved)) write('wh.settings', settings);
try { for (const key of ['wh.level','wh.calibration','wh.calibrationMs','wh.weightKg','wh.musicVolume','wh.sfxVolume']) localStorage.removeItem?.(key); } catch {}
export const saveSettings = () => write('wh.settings', settings);
const bests = Object.create(null), savedBests = read('wh.bests');
let migrated = false;
if (record(savedBests)) for (const [key, value] of Object.entries(savedBests)) {
  if (!Number.isSafeInteger(value) || value < 0) continue;
  const song = key.replace(/:(easy|normal|hard)$/, '');
  migrated ||= song !== key;
  bests[song] = Math.max(bests[song] || 0, value);
}
if (migrated) write('wh.bests', bests);
export const getBest = song => bests[song] || 0;
export function saveBest(song, score) {
  if (!Number.isSafeInteger(score) || score < 0) return false;
  const improved = score > getBest(song);
  if (improved) { bests[song] = score; write('wh.bests', bests); }
  return improved;
}
