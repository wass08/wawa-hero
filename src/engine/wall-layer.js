// Paint before the next render when a menu/state changes. Animation throttling
// must never leave the initial canvas (or the previous state's text) on screen.
export function createWallLayer({ctx,canvas,texture,draw,state,menuMix}) {
  let elapsed=0,paints=0;
  function paint() {
    draw(ctx,canvas.width,canvas.height,state);
    texture.needsUpdate=true;
    elapsed=0;paints++;
  }
  return {
    paint,
    setMenuCamera(enabled) { menuMix.value=enabled?1:0; },
    update(dt,mode) {
      elapsed+=dt;
      if((mode!=='cam'||menuMix.value>0)&&elapsed>1/30)paint();
    },
    get paints(){return paints;},
  };
}
