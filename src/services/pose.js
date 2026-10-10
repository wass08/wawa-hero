// Reuse the two output slots; the real tracker owns player identity.
export function updatePlayers(tracker,now,count,out) {
  out[0]=out[1]=null;
  if(tracker){const frames=tracker.updateAll(now);out[0]=frames[0];out[1]=count===2?frames[1]:null;}
  return out;
}
export async function setTrackerPlayers(tracker,count){if(tracker)await tracker.setMaxPlayers(count);}
