import {describe,it,expect,vi,afterEach} from 'vitest';
import {songArtist,reviewSongMeta} from '../song-meta.js';
import {createReviewIndex} from '../review/hud.js';
import {createMenuHUD} from '../hud/menu.js';
vi.mock('../settings.js',()=>({getBest:()=>0}));
afterEach(()=>vi.unstubAllGlobals());
describe('optional artist metadata',()=>{
  it.each([undefined,null,'','  ',42])('hides absent/invalid artist %s with no metadata separator',artist=>{const song={bpm:124.71,artist};expect(songArtist(song)).toBe('');expect(reviewSongMeta(song)).toBe('125 BPM');});
  it('still supports a named artist from an old catalog',()=>{expect(reviewSongMeta({artist:'  Wawa Sensei ',bpm:126})).toBe('Wawa Sensei · 126 BPM');});
  it('review index never inserts undefined or an empty artist gap',()=>{
    let root;vi.stubGlobal('document',{getElementById:()=>({}),createElement:()=>root={},body:{append:vi.fn()}});
    createReviewIndex([{id:'song',title:'Song',bpm:126,duration:105.96}],new URLSearchParams('mute&fakeboard'));
    expect(root.innerHTML).toContain('<small><span class="num">126</span> BPM</small>');expect(root.innerHTML).not.toContain('undefined');expect(root.innerHTML).not.toContain(' · 126 BPM');
  });
  it('song detail hides an empty artist node and reveals it only when present',()=>{
    const ids=['rows','hud','dTitle','dArtist','dBpm','dLen','dBest','dMoves','dEnergy','legend'];
    const nodes=Object.fromEntries(ids.map(id=>[id,{children:[],style:{},dataset:{},classList:{toggle:vi.fn()}}]));
    vi.stubGlobal('document',{getElementById:id=>nodes[id]});const songs=[{id:'s',title:'Song',bpm:126,duration:105.96,moves:['up'],energy:1}];
    const menu=createMenuHUD(songs,vi.fn());menu.render('songs',0);expect(nodes.dArtist.hidden).toBe(true);expect(nodes.dArtist.textContent).toBe('');songs[0].artist='  Legacy artist ';menu.render('songs',0);expect(nodes.dArtist.hidden).toBe(false);expect(nodes.dArtist.textContent).toBe('Legacy artist');
  });
});
