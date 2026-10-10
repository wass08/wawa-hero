// STORE archives: UTF-8 filenames, CRC32, local headers, central directory, EOCD.
const encoder=new TextEncoder(),table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export async function storeZip(files,date=new Date()){
  const chunks=[],central=[];let offset=0,size=0;
  const year=Math.max(1980,Math.min(2107,date.getFullYear())),dosDate=((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate(),dosTime=(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1);
  for(const file of files){const name=encoder.encode(file.name),bytes=file.data instanceof Uint8Array?file.data:new Uint8Array(await file.data.arrayBuffer()),crc=crc32(bytes);
    const header=new Uint8Array(30+name.length),v=new DataView(header.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(10,dosTime,true);v.setUint16(12,dosDate,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);header.set(name,30);
    const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(12,dosTime,true);d.setUint16(14,dosDate,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);
    chunks.push(header,bytes);central.push(directory);offset+=header.length+bytes.length;size+=directory.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
}
