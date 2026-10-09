// Camera: getUserMedia + a throttled analysis loop. Does NOT import the face library;
// the caller passes an analysis callback. Frames are never stored or sent anywhere.
//
//   const cam = createCamera({ video, onFrame, onError, fps });
//   const r = await cam.start();   // { ok: true, facing } or { ok: false, error }  (never throws)
//   cam.stop();                    // stops tracks, clears the video, ends the loop
//
// onFrame(video) is called at about `fps` per second (default 10) while the camera is running.
// It may return a promise; the next tick is skipped while it is still pending, so analyses never overlap.
// The preview is just the <video> element playing at its own full frame rate.

const DEFAULT_FPS = 10;

function friendlyError(err) {
  const name = err && err.name ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is in use by another app.';
  return 'The camera could not be started.';
}

export function createCamera({ video, onFrame, onError, fps = DEFAULT_FPS } = {}) {
  const interval = 1000 / fps;
  let stream = null;
  let timer = null;
  let busy = false;
  let generation = 0; // bumped by stop() so a pending start() can notice it was cancelled
  let facing = 'unknown';

  function report(error) {
    try { if (onError) onError(error); } catch { /* UI errors must not break the camera */ }
  }

  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  async function openStream() {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { ...base, facingMode: { ideal: 'environment' } }, audio: false,
      });
    } catch (err) {
      // Permission problems will not be fixed by relaxing constraints.
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err;
      return navigator.mediaDevices.getUserMedia({ video: base, audio: false }); // any camera
    }
  }

  function releaseStream() {
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    video.pause();
    video.srcObject = null;
  }

  function schedule(gen) {
    timer = setTimeout(() => tick(gen), interval);
  }

  async function tick(gen) {
    if (gen !== generation) return;
    const started = performance.now();
    if (!busy && video.readyState >= 2 && video.videoWidth > 0 && onFrame) {
      busy = true;
      try {
        await onFrame(video);
      } catch (err) {
        report(err); // keep looping; one bad frame is not fatal
      } finally {
        busy = false;
      }
    }
    if (gen !== generation) return;
    // Aim for a steady rate: subtract the time the analysis took.
    const wait = Math.max(0, interval - (performance.now() - started));
    timer = setTimeout(() => tick(gen), wait);
  }

  async function start() {
    stop();
    const gen = ++generation;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = 'This browser cannot use the camera (needs HTTPS or localhost).';
      report(error);
      return { ok: false, error };
    }
    try {
      const s = await openStream();
      if (gen !== generation) { // stop() was called while waiting for permission
        for (const t of s.getTracks()) t.stop();
        return { ok: false, error: 'cancelled' };
      }
      stream = s;
      const settings = s.getVideoTracks()[0]?.getSettings?.() || {};
      facing = settings.facingMode || 'unknown';
      video.srcObject = s;
      try { await video.play(); } catch { /* autoplay can be refused; muted+playsinline normally allows it */ }
      if (gen !== generation) return { ok: false, error: 'cancelled' };
      schedule(gen);
      return { ok: true, facing };
    } catch (err) {
      if (gen !== generation) return { ok: false, error: 'cancelled' };
      const error = friendlyError(err);
      report(error);
      return { ok: false, error };
    }
  }

  function stop() {
    generation++;
    clearTimeout(timer);
    timer = null;
    releaseStream();
  }

  return { start, stop, get facing() { return facing; } };
}
