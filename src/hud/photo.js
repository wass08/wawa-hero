export function createPhotoHUD(){
  const pop=document.getElementById?.('photoPop'),flash=document.getElementById?.('heroFlash');
  let url=null;
  return {
    flash(){if(!flash)return;flash.classList.remove('taken');void flash.offsetWidth;flash.classList.add('taken');},
    show(shot){if(!pop)return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(shot.blob);pop.querySelector('img').src=url;pop.classList.remove('snapped');void pop.offsetWidth;pop.classList.add('snapped');},
    reset(){if(url)URL.revokeObjectURL(url);url=null;pop?.classList.remove('snapped');flash?.classList.remove('taken');},
  };
}
