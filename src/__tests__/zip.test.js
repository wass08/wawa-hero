import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {storeZip,crc32} from '../game/zip.js';
it('writes a STORE archive with correct CRCs, UTF-8 names and an unzip-valid directory',async()=>{expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);const directory=await mkdtemp(join(tmpdir(),'wh-zip-'));try{const zip=await storeZip([{name:'strip-p1.webp',data:new Blob(['strip1'])},{name:'strip-p2.png',data:new Blob(['strip2'])},{name:'shot-1.webp',data:new Uint8Array([0,1,255])},{name:'日本.txt',data:new Blob(['hello'])}],new Date('2026-10-10'));const path=join(directory,'photos.zip');await writeFile(path,new Uint8Array(await zip.arrayBuffer()));const output=execFileSync('unzip',['-t',path],{encoding:'utf8'});expect(output).toContain('No errors detected');expect(output).toContain('strip-p1.webp');const bytes=new DataView(await zip.arrayBuffer());expect(bytes.getUint16(8,true)).toBe(0);}finally{await rm(directory,{recursive:true,force:true});}});
