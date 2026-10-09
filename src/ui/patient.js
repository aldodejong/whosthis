// Patient view: full-screen rear camera, a "Tap to start" button, and a recognition card.
// No error text is ever shown here: failures fall back to the plain camera view or the start button.
// The one exception (user-requested, SPEC.md Patient mode item 6): a calm "Not sure who this is" hint
// when a face has been in view for ~1.5 s without a confirmed person. It never affects matching.
//
// Hooks for phase 7 (speech):
//   setStartHandler(fn)    fn() runs synchronously inside the "Tap to start" tap (unlock speech here)
//   setConfirmHandler(fn)  fn(person) runs when a person is newly confirmed (not when they leave)
// Both are module-level and survive remounts; pass null to clear.

import { createCamera } from '../camera.js';
import * as face from '../face.js';
import * as store from '../store.js';
import * as speech from '../speech.js';
import { DEFAULTS, scorePeople, decide, createTracker } from '../matcher.js';
import { gateReason, buildCandidates, cardModel, initialHint, nextHint } from '../patient-logic.js';

const LONG_PRESS_MS = 3000;
const LONG_PRESS_MOVE_PX = 12; // a mouse/finger wobble this small still counts as holding
const FADE_MS = 300;

let startHandler = null;
let confirmHandler = null;
export function setStartHandler(fn) { startHandler = typeof fn === 'function' ? fn : null; }
export function setConfirmHandler(fn) { confirmHandler = typeof fn === 'function' ? fn : null; }

// Speech (phase 7): unlock inside the tap, speak on each new confirmation (cooldown lives in speech.js).
setStartHandler(() => speech.unlock());
setConfirmHandler((person) => speech.speakPerson(person));

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mount(container) {
  const stage = el('div', 'pt');
  const video = el('video', 'pt-video');
  const card = el('div', 'pt-card');
  const photo = el('img', 'pt-photo');
  photo.alt = '';
  const title = el('div', 'pt-title');
  const rel = el('div', 'pt-rel');
  card.append(photo, title, rel);
  card.setAttribute('aria-hidden', 'true');
  const hint = el('div', 'pt-hint');
  hint.setAttribute('aria-hidden', 'true');
  const startBtn = el('button', 'pt-start', 'Tap to start');
  startBtn.type = 'button';
  const corner = el('div', 'pt-corner');
  corner.setAttribute('aria-label', 'Caregiver settings: press and hold for 3 seconds');
  corner.setAttribute('role', 'img');
  corner.append(gearIcon());
  stage.append(video, card, hint, startBtn, corner);
  container.append(stage);

  let alive = true;
  let running = false;
  let starting = false;
  let people = new Map(); // id -> person
  let candidates = [];
  let settings = { ...DEFAULTS };
  let tracker = createTracker();
  let shownId = null;
  let photoUrl = null;
  let hideTimer = null;
  let wakeLock = null;
  let hintState = initialHint();
  let hintText = null;

  // --- card -------------------------------------------------------------------------------
  function revokePhoto() {
    if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
    photo.removeAttribute('src');
  }

  function showCard(person) {
    clearTimeout(hideTimer);
    hideTimer = null;
    revokePhoto();
    const m = cardModel(person);
    title.textContent = m.title;
    rel.textContent = m.relationship;
    rel.hidden = !m.relationship;
    if (person.displayPhoto instanceof Blob) {
      photoUrl = URL.createObjectURL(person.displayPhoto);
      photo.src = photoUrl;
      photo.hidden = false;
    } else {
      photo.hidden = true;
    }
    card.classList.add('visible');
    card.setAttribute('aria-hidden', 'false');
  }

  function hideCard() {
    card.classList.remove('visible');
    card.setAttribute('aria-hidden', 'true');
    clearTimeout(hideTimer);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (shownId === null) { revokePhoto(); title.textContent = ''; rel.textContent = ''; }
    }, reduce ? 0 : FADE_MS + 50);
  }

  function applyConfirmed(id) {
    if (id === shownId) return;
    shownId = id;
    const person = id === null ? null : people.get(id);
    if (!person) { shownId = null; hideCard(); return; }
    showCard(person);
    if (confirmHandler) {
      try { confirmHandler(person); } catch { /* speech problems must never reach the patient */ }
    }
  }

  // --- hint ("Not sure who this is") ----------------------------------------------------------
  // Fades with the same 300 ms CSS transition as the card (none under Reduce Motion). The text is
  // only changed while visible or being shown, so a fading hint keeps its words.
  function setHint(message) {
    if (message === hintText) return;
    hintText = message;
    if (message) {
      hint.textContent = message;
      hint.classList.add('visible');
      hint.setAttribute('aria-hidden', 'false');
    } else {
      hint.classList.remove('visible');
      hint.setAttribute('aria-hidden', 'true');
    }
  }

  function updateHint(frame) {
    const r = nextHint(hintState, frame);
    hintState = r.state;
    setHint(r.message);
  }

  // --- wake lock --------------------------------------------------------------------------
  async function acquireWakeLock() {
    try {
      if (!alive || !running || wakeLock || document.visibilityState !== 'visible') return;
      if (!navigator.wakeLock || !navigator.wakeLock.request) return;
      const lock = await navigator.wakeLock.request('screen');
      if (!alive || !running) { lock.release().catch(() => {}); return; }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } catch { /* unsupported or refused: fail silently */ }
  }
  function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) lock.release().catch(() => {});
  }
  // Hidden (phone locked, app switched away): forget who was in view, so an old card is never
  // still up when the screen comes back pointing at someone else. The camera keeps running.
  const onVisibility = () => {
    if (document.visibilityState === 'visible') { acquireWakeLock(); return; }
    tracker.reset();
    applyConfirmed(null);
    hintState = initialHint();
    setHint(null);
  };
  document.addEventListener('visibilitychange', onVisibility);

  // --- recognition ------------------------------------------------------------------------
  async function onFrame(v) {
    let confirmedId = null;
    let facePresent = false;
    let gate = null;
    let now = Date.now();
    try {
      // v is null while the camera track is muted/ended (see camera.js): count it as no face.
      const r = v ? await face.embed(v) : null;
      // Stopped meanwhile (back to Tap to start, or the page is hidden): drop this stale result.
      if (!alive || !running || document.visibilityState === 'hidden') return;
      now = Date.now();
      let candidate = null;
      facePresent = !!(r && r.face);
      gate = facePresent ? gateReason(r.face) : null;
      if (r && gate === null && r.model === face.EMBEDDING_MODEL && candidates.length) {
        candidate = decide(scorePeople(r.embedding, candidates), { accept: settings.accept, margin: settings.margin });
      }
      confirmedId = tracker.update(candidate, now).confirmedId;
    } catch {
      if (!alive || !running) return;
      now = Date.now();
      confirmedId = tracker.update(null, now).confirmedId; // a bad frame counts as "nobody"
      facePresent = false;
    }
    applyConfirmed(confirmedId);
    updateHint({ facePresent, gate, confirmed: shownId !== null, now });
  }

  // A camera that stops on its own (track ended) goes back to Tap to start, silently.
  const camera = createCamera({ video, onFrame, onError: () => { if (alive && running) showStart(); } });

  function showStart() {
    running = false;
    starting = false;
    camera.stop();
    releaseWakeLock();
    tracker.reset();
    applyConfirmed(null);
    hintState = initialHint();
    setHint(null);
    startBtn.hidden = false;
  }

  async function loadData() {
    try {
      const [list, s] = await Promise.all([store.listPeople(), store.getSettings()]);
      people = new Map(list.map((p) => [p.id, p]));
      candidates = buildCandidates(list, face.EMBEDDING_MODEL);
      settings = s;
    } catch {
      people = new Map();
      candidates = [];
      settings = { ...DEFAULTS };
    }
    speech.setEnabled(settings.speechOn !== false);
    tracker = createTracker({ confirmFrames: settings.confirmFrames, dropMs: DEFAULTS.dropMs });
  }

  async function start() {
    if (starting || running) return;
    starting = true;
    startBtn.hidden = true;
    // Must run inside the tap, before any await (iOS user-gesture rule).
    if (startHandler) { try { startHandler(); } catch { /* ignore */ } }
    try {
      await loadData();
      await face.init();
      if (!alive) return;
      const r = await camera.start();
      if (!alive) return;
      if (!r.ok) { if (r.error !== 'cancelled') showStart(); return; }
      video.style.transform = camera.facing === 'user' ? 'scaleX(-1)' : '';
      running = true;
      starting = false;
      acquireWakeLock();
    } catch {
      if (alive) showStart();
    }
  }

  startBtn.addEventListener('click', start);

  // --- caregiver long-press ---------------------------------------------------------------
  let pressTimer = null;
  let pressX = 0;
  let pressY = 0;
  function cancelPress() { clearTimeout(pressTimer); pressTimer = null; }
  const onDown = (e) => {
    cancelPress();
    pressX = e.clientX;
    pressY = e.clientY;
    pressTimer = setTimeout(() => { pressTimer = null; location.hash = '#/caregiver'; }, LONG_PRESS_MS);
  };
  const onMove = (e) => {
    if (pressTimer && Math.hypot(e.clientX - pressX, e.clientY - pressY) > LONG_PRESS_MOVE_PX) cancelPress();
  };
  corner.addEventListener('pointerdown', onDown);
  corner.addEventListener('pointermove', onMove);
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) corner.addEventListener(type, cancelPress);
  const noMenu = (e) => e.preventDefault();
  stage.addEventListener('contextmenu', noMenu);
  stage.addEventListener('selectstart', noMenu);

  return () => {
    alive = false;
    running = false;
    cancelPress();
    clearTimeout(hideTimer);
    camera.stop();
    releaseWakeLock();
    revokePhoto();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

// Settings gear with "3s" in the middle: the caregiver entry (press and hold 3 seconds).
function gearIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const svg = mk('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false' });
  // Solid cog: 8 flat-topped teeth around a body, no ring around the teeth.
  const TEETH = 8, R_OUT = 22, R_IN = 17, TOOTH = 0.30, GAP_SHARE = 0.5; // radians of half-width at tip / root
  const pt = (r, a) => `${(24 + r * Math.cos(a)).toFixed(2)} ${(24 + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < TEETH; i++) {
    const c = (i * 2 * Math.PI) / TEETH;
    const root = TOOTH + 0.12, tip = TOOTH * GAP_SHARE + 0.1;
    d += `${i ? 'L' : 'M'}${pt(R_IN, c - root)} L${pt(R_OUT, c - tip)} L${pt(R_OUT, c + tip)} L${pt(R_IN, c + root)} `;
    const next = c + (2 * Math.PI) / TEETH - (TOOTH + 0.12);
    d += `A${R_IN} ${R_IN} 0 0 1 ${pt(R_IN, next)} `;
  }
  svg.append(mk('path', { d: d + 'Z', class: 'pt-gear-body' }));
  svg.append(mk('circle', { cx: 24, cy: 24, r: 12.5, class: 'pt-gear-hole' }));
  const label = mk('text', { x: 24, y: 24.5, class: 'pt-gear-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  label.textContent = '3s';
  svg.append(label);
  return svg;
}
