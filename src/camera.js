export function createCamera({ onStatus = () => {}, onLive = () => {} } = {}) {
  const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
  video.setAttribute('aria-hidden','true'); video.className = 'camera-source'; document.body.append(video);
  let status = 'avatar', pending = null, generation = 0, closed = false;
  const stop = stream => stream?.getTracks().forEach(t => t.stop());
  const setStatus = s => { status = s; onStatus(s); };
  setStatus('avatar');
  return {
    video, get status() { return status; },
    async enable() {
      if (closed) return;
      if (status === 'live') return video;
      if (pending) return pending;
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('unavailable'); return; }
      const epoch = generation;
      setStatus('requesting');
      const request = (async () => {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
          if (closed || epoch !== generation) { stop(stream); return; }
          video.srcObject = stream; await video.play();
          if (closed || epoch !== generation) { stop(stream); return; }
          setStatus('live'); await onLive(video);
          if (!closed && epoch === generation) return video;
        } catch (e) {
          stop(stream);
          if (!closed && epoch === generation) {
            video.srcObject = null;
            setStatus(['NotFoundError','OverconstrainedError'].includes(e.name) ? 'unavailable' : 'blocked');
          }
        }
      })();
      pending = request;
      try { return await request; } finally { if (pending === request) pending = null; }
    },
    close() {
      closed = true; generation++; pending = null;
      stop(video.srcObject); video.pause(); video.srcObject = null; video.remove(); setStatus('avatar');
    },
    restore() {
      closed = false;
      if (!video.isConnected) document.body.append(video);
    },
  };
}
