// Test view: live full-screen preview, an overlay box around the largest face, and a debug panel
// with every enrolled person's score and the current decision (for tuning ACCEPT/MARGIN/N).
// Uses exactly the patient-mode pipeline: same gate, same candidate list, same decide()/tracker.
//
// Box colours: amber = gated (too small / turned), green = usable but not accepted,
// teal with a name label = accepted by decide() this frame.

import { createCamera } from '../camera.js';
import * as face from '../face.js';
import * as store from '../store.js';
import { DEFAULTS, scorePeople, decide, createTracker } from '../matcher.js';
import { MAX_ANGLE_DEG, MIN_FACE_FRACTION, gateReason, buildCandidates, explainDecision } from '../patient-logic.js';

const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '-');
const COLOR_GATED = '#ffb020';
const COLOR_USABLE = '#2ee66b';
const COLOR_ACCEPTED = '#19c3e6';

export function mount(container) {
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;inset:0;background:#000;overflow:hidden;z-index:1';

  const video = document.createElement('video');
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';

  const status = document.createElement('div');
  status.style.cssText = 'position:absolute;left:0;right:0;top:40%;text-align:center;color:#fff;'
    + 'font-size:1.5rem;padding:0 24px;text-shadow:0 1px 4px #000';

  const debug = document.createElement('div');
  debug.setAttribute('aria-live', 'off');
  debug.style.cssText = 'position:absolute;left:0;right:0;bottom:0;max-height:55%;overflow:auto;padding:8px 12px;'
    + 'padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));background:rgba(0,0,0,.75);color:#fff;'
    + 'font:13px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere';

  // The Home Screen app has no browser back button, so the test view needs its own way out.
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Back';
  back.style.cssText = 'position:absolute;z-index:2;top:calc(env(safe-area-inset-top,0px) + 8px);'
    + 'right:calc(env(safe-area-inset-right,0px) + 8px)';
  back.addEventListener('click', () => { location.hash = '#/caregiver'; });

  stage.append(video, canvas, status, debug, back);
  container.append(stage);

  let alive = true;
  let backend = '-';
  let initMs = NaN;
  let frameMs = NaN;
  let last = null; // last face (detect() shape) or null
  let lastModelOk = true;
  let facing = 'unknown';
  let error = '';

  // Enrolled people + settings, loaded once per visit (re-open the view after changing them).
  let people = [];
  let names = new Map(); // id -> name
  let candidates = [];
  let settings = { ...DEFAULTS };
  let tracker = createTracker();
  let scores = []; // [{ id, score, used }] for the current frame
  let decision = explainDecision({ facePresent: false });
  let dataNote = 'loading people…';

  async function loadData() {
    try {
      const [list, s] = await Promise.all([store.listPeople(), store.getSettings()]);
      people = list;
      settings = { ...DEFAULTS, ...s };
      dataNote = '';
    } catch {
      people = [];
      settings = { ...DEFAULTS };
      dataNote = 'could not load people/settings (using defaults)';
    }
    names = new Map(people.map((p) => [p.id, String(p.name || '(no name)')]));
    candidates = buildCandidates(people, face.EMBEDDING_MODEL);
    tracker = createTracker({ confirmFrames: settings.confirmFrames, dropMs: DEFAULTS.dropMs });
  }

  const nameOf = (id) => (id == null ? '-' : (names.get(id) || String(id)));

  function personLines() {
    if (!people.length) return ['  (nobody enrolled)'];
    const scoreById = new Map(scores.map((s) => [s.id, s]));
    const bestId = decision.best ? decision.best.id : null;
    const usable = new Set(candidates.map((c) => c.id));
    return people.map((p) => {
      const nm = nameOf(p.id).slice(0, 14).padEnd(14);
      if (!usable.has(p.id)) {
        const why = p.embeddingModel !== face.EMBEDDING_MODEL ? 'old model: open in Edit + Save' : 'under 3 usable fingerprints: re-add photos';
        return `    ${nm}   -   (${why})`;
      }
      const s = scoreById.get(p.id);
      const mark = p.id === decision.id ? '>>' : (p.id === bestId ? ' *' : '  ');
      const sc = s && typeof s.score === 'number' ? fmt(s.score, 2) : '  -';
      const used = s && s.used ? ` (top ${s.used})` : '';
      return `${mark}  ${nm} ${sc}${used}`;
    });
  }

  function renderDebug() {
    if (error) { debug.textContent = error; return; }
    const f = last;
    const a = f && f.angle;
    const st = tracker.state();
    const gate = f ? gateReason(f) : null;
    const d = decision;
    const lead = d.best && d.second ? fmt(d.best.score - d.second.score, 2) : (d.best ? 'no rival' : '-');
    const verdict = d.id !== null ? `ACCEPT ${nameOf(d.id)}` : `no match (${d.reason})`;
    const lines = [
      `backend ${backend} | init ${fmt(initMs)} ms | frame ${fmt(frameMs)} ms`,
      `face ${f ? fmt(f.frameFraction * 100, 1) + '% of width' : 'none'}`
        + ` | yaw ${a ? fmt(a.yaw) : '-'} pitch ${a ? fmt(a.pitch) : '-'} roll ${a ? fmt(a.roll) : '-'}`,
      `gate (>= ${fmt(MIN_FACE_FRACTION * 100)}%, <= ${MAX_ANGLE_DEG} deg): ${f ? (gate ? 'SKIP ' + gate : 'ok') : '-'}`,
      `settings: accept ${fmt(settings.accept, 2)} | margin ${fmt(settings.margin, 2)} | confirmFrames ${st.confirmFrames}`,
      'scores (mean of 3 best):',
      ...personLines(),
      `decision: ${verdict} | lead ${lead}`,
      `tracker: confirmed ${nameOf(st.confirmedId)} | streak ${st.streakId == null ? '-' : nameOf(st.streakId)} ${st.streak}/${st.confirmFrames}`,
    ];
    if (dataNote) lines.push(dataNote);
    debug.textContent = lines.join('\n');
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!last || !vw || !vh) return;
    // object-fit: cover -> uniform scale that fills the view, centred, overflow cropped.
    const scale = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * scale) / 2;
    const oy = (ch - vh * scale) / 2;
    let x = ox + last.box.x * scale;
    const y = oy + last.box.y * scale;
    const w = last.box.width * scale;
    const h = last.box.height * scale;
    if (facing === 'user') x = cw - x - w; // front camera preview is mirrored
    const accepted = decision.id !== null;
    const color = accepted ? COLOR_ACCEPTED : (gateReason(last) ? COLOR_GATED : COLOR_USABLE);
    ctx.lineWidth = accepted ? 6 : 4;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);

    // Label: accepted name + score, or the best candidate's score in brackets when not accepted.
    let label = '';
    if (accepted) label = `${nameOf(decision.id)} ${fmt(decision.best && decision.best.score, 2)}`;
    else if (decision.best) label = `(${nameOf(decision.best.id)} ${fmt(decision.best.score, 2)})`;
    if (!label) return;
    ctx.font = '600 16px ui-monospace, Menlo, monospace';
    const tw = ctx.measureText(label).width + 12;
    const ly = y - 26 >= 0 ? y - 26 : y + h + 4;
    const lx = Math.max(0, Math.min(x, cw - tw));
    ctx.fillStyle = accepted ? COLOR_ACCEPTED : 'rgba(0,0,0,.7)';
    ctx.fillRect(lx, ly, tw, 22);
    ctx.fillStyle = accepted ? '#000' : '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx + 6, ly + 11);
  }

  // Mirror the video itself only for the front camera.
  function applyMirror() {
    video.style.transform = facing === 'user' ? 'scaleX(-1)' : '';
  }

  function analyse(r, now) {
    const f = r ? r.face : null;
    last = f;
    lastModelOk = !!(r && r.model === face.EMBEDDING_MODEL);
    const gate = f ? gateReason(f) : null;
    scores = r && lastModelOk && candidates.length ? scorePeople(r.embedding, candidates) : [];
    decision = explainDecision({
      facePresent: !!f,
      gate,
      modelOk: lastModelOk,
      candidateCount: candidates.length,
      scores,
      accept: settings.accept,
      margin: settings.margin,
    });
    // Same input the patient view feeds its tracker: decide() only for usable, same-model faces.
    const candidate = f && !gate && lastModelOk && candidates.length
      ? decide(scores, { accept: settings.accept, margin: settings.margin })
      : null;
    tracker.update(candidate, now);
  }

  const camera = createCamera({
    video,
    onFrame: async (v) => {
      const t0 = performance.now();
      let r = null;
      try { r = v ? await face.embed(v) : null; } catch { r = null; } // v null: camera muted/ended
      if (!alive) return;
      frameMs = performance.now() - t0;
      analyse(r, Date.now());
      draw();
      renderDebug();
    },
    onError: (e) => {
      if (!alive) return;
      error = typeof e === 'string' ? e : 'Analysis error.';
      renderDebug();
    },
  });

  const onResize = () => draw();
  window.addEventListener('resize', onResize);

  (async () => {
    status.textContent = 'Loading models…';
    renderDebug();
    await loadData();
    if (!alive) return;
    const t0 = performance.now();
    try {
      const info = await face.init();
      backend = info.backend;
    } catch {
      if (!alive) return;
      status.textContent = '';
      error = 'Face models could not be loaded.';
      renderDebug();
      return;
    }
    if (!alive) return;
    initMs = performance.now() - t0;
    status.textContent = 'Starting camera…';
    renderDebug();
    const r = await camera.start();
    if (!alive) return;
    if (!r.ok) {
      status.textContent = '';
      error = r.error;
      renderDebug();
      return;
    }
    facing = r.facing;
    applyMirror();
    status.textContent = '';
    renderDebug();
  })();

  return () => {
    alive = false;
    window.removeEventListener('resize', onResize);
    camera.stop();
  };
}
