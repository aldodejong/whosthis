// speechSynthesis wrapper: "This is Jane, your daughter." with a per-person cooldown and an on/off switch.
// Never throws. If speechSynthesis is missing, every call does nothing silently.
// Must not touch `window` at import time, so tests can import the pure helpers under node.
//
// Robustness rules (desktop Chrome/Safari and iOS Safari all have quirks here):
//   - never cancel() unless something is actually speaking or queued, and after a cancel() wait a
//     moment before speak(): some engines drop a speak() issued in the same tick as cancel();
//   - resume() if the engine reports itself paused (Chrome can get stuck paused);
//   - keep a module-level reference to the utterance being spoken: Chrome can garbage-collect an
//     utterance that nothing references, which loses its events (and sometimes the speech);
//   - never wait for voices: getVoices() is often empty until 'voiceschanged'; we speak with
//     lang 'en-US' and the engine's default voice until the list has loaded.
// A short console.debug trail ("[whosthis speech] ...") says why speech was skipped, started,
// ended or failed. It never includes photos, fingerprints or anything beyond the spoken sentence.

export const COOLDOWN_MS = 45000;
export const RATE = 0.85;
export const LANG = 'en-US';
export const AFTER_CANCEL_MS = 120; // gap between cancel() and speak()
const START_WATCHDOG_MS = 2500;

const lastSpoken = new Map(); // personId -> timestamp (ms) of the last speak() call
let enabled = true;
let activeUtterance = null; // strong reference, see the GC note above
let voicesHooked = false;

function log(...args) {
  try {
    if (typeof window !== 'undefined' && typeof console !== 'undefined') console.debug('[whosthis speech]', ...args);
  } catch { /* ignore */ }
}

/**
 * Pure cooldown decision. True when speech is enabled, the person is known, and at least
 * cooldownMs has passed since they were last spoken to. A non-finite `now` never speaks.
 */
export function shouldSpeak(lastSpokenMap, personId, now, cooldownMs = COOLDOWN_MS, isEnabled = true) {
  if (!isEnabled) return false;
  if (personId === null || personId === undefined) return false;
  if (!Number.isFinite(now)) return false;
  const last = lastSpokenMap.get(personId);
  if (last === undefined) return true;
  return now - last >= cooldownMs;
}

/**
 * Pure: how to hand an utterance to the engine given its current state flags.
 * { cancelFirst, resume, delayMs }: cancel only if something is speaking or queued, and then
 * delay the speak() so the cancel has settled; resume() if the engine says it is paused.
 */
export function planSpeak({ speaking = false, pending = false, paused = false } = {}) {
  const busy = !!speaking || !!pending;
  return { cancelFirst: busy, resume: !!paused, delayMs: busy ? AFTER_CANCEL_MS : 0 };
}

/**
 * Pure voice choice from a getVoices() list. Prefers the engine's default voice if it is English,
 * then an on-device en-US voice, then any en-US voice, then any on-device English voice.
 * Returns null (= let the engine pick from utterance.lang) when nothing fits or the list is empty.
 */
export function chooseVoice(voices) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const lang = (v) => String((v && v.lang) || '').replace('_', '-').toLowerCase();
  const isEn = (v) => /^en(-|$)/.test(lang(v));
  const isUS = (v) => lang(v) === 'en-us';
  const local = (v) => v && v.localService !== false;
  return voices.find((v) => v && v.default && isEn(v))
    || voices.find((v) => isUS(v) && local(v))
    || voices.find((v) => isUS(v))
    || voices.find((v) => isEn(v) && local(v))
    || null;
}

function synth() {
  try {
    const s = globalThis.speechSynthesis;
    return s && typeof s.speak === 'function' ? s : null;
  } catch { return null; }
}

function UtteranceCtor() {
  try {
    return typeof globalThis.SpeechSynthesisUtterance === 'function' ? globalThis.SpeechSynthesisUtterance : null;
  } catch { return null; }
}

function currentVoices(s) {
  try {
    const v = typeof s.getVoices === 'function' ? s.getVoices() : [];
    return Array.isArray(v) ? v : Array.from(v || []);
  } catch { return []; }
}

// Ask the engine to load its voices (Chrome loads them lazily) without ever waiting for them.
function hookVoices(s) {
  if (voicesHooked) return;
  voicesHooked = true;
  try {
    if (typeof s.addEventListener === 'function') {
      s.addEventListener('voiceschanged', () => log('voices loaded:', currentVoices(s).length));
    }
    currentVoices(s);
  } catch { /* ignore */ }
}

function stateOf(s) {
  return { speaking: !!s.speaking, pending: !!s.pending, paused: !!s.paused };
}

function sentence(person) {
  const name = String(person && person.name !== undefined ? person.name : '').trim();
  if (!name) return '';
  const rel = String(person.relationship !== undefined && person.relationship !== null ? person.relationship : '').trim();
  return rel ? `This is ${name}, ${rel}.` : `This is ${name}.`;
}

/**
 * Must be called synchronously inside the "Tap to start" click. Speaks a silent utterance so iOS
 * allows speech later. Does not record a cooldown. Only cancels if something is already queued.
 */
export function unlock() {
  try {
    const s = synth();
    const Utt = UtteranceCtor();
    if (!s || !Utt) { log('unlock skipped: speechSynthesis not available'); return; }
    hookVoices(s);
    const st = stateOf(s);
    if (st.speaking || st.pending) s.cancel();
    if (st.paused && typeof s.resume === 'function') s.resume();
    const u = new Utt(' ');
    u.volume = 0;
    u.rate = RATE;
    u.lang = LANG;
    s.speak(u);
    log('unlock: silent utterance queued', st);
  } catch (err) {
    log('unlock failed:', err && err.name ? err.name : String(err));
  }
}

function startUtterance(s, u, text, hasStarted) {
  try {
    activeUtterance = u;
    if (typeof s.resume === 'function' && s.paused) s.resume();
    s.speak(u);
    log('speak() called:', JSON.stringify(text), stateOf(s));
    setTimeout(() => {
      if (activeUtterance === u && !hasStarted()) {
        log('not started after', START_WATCHDOG_MS, 'ms', stateOf(s), '(engine stuck? trying resume())');
        try { if (typeof s.resume === 'function') s.resume(); } catch { /* ignore */ }
      }
    }, START_WATCHDOG_MS);
  } catch (err) {
    if (activeUtterance === u) activeUtterance = null;
    log('speak() threw:', err && err.name ? err.name : String(err));
  }
}

/**
 * Says "This is <name>, <relationship>." unless disabled or within the cooldown.
 * Records the cooldown when the utterance is handed to the engine; a hard error (not an
 * interruption) clears it so the next confirmation may try again. Returns true if it queued speech.
 */
export function speakPerson(person, { now } = {}) {
  try {
    if (!enabled) { log('skipped: speech is switched off'); return false; }
    if (!person || person.id === undefined || person.id === null) { log('skipped: no person id'); return false; }
    const t = now === undefined ? Date.now() : now;
    if (!shouldSpeak(lastSpoken, person.id, t, COOLDOWN_MS, enabled)) {
      log('skipped: cooldown (said within the last', COOLDOWN_MS / 1000, 's)');
      return false;
    }
    const text = sentence(person);
    if (!text) { log('skipped: person has no name'); return false; }
    const s = synth();
    const Utt = UtteranceCtor();
    if (!s || !Utt) { log('skipped: speechSynthesis not available in this browser'); return false; }
    hookVoices(s);

    const u = new Utt(text);
    u.rate = RATE;
    u.lang = LANG;
    u.volume = 1;
    const voice = chooseVoice(currentVoices(s));
    if (voice) u.voice = voice;
    let started = false;
    u.onstart = () => { started = true; log('started', voice ? `(voice ${voice.name})` : '(default voice)'); };
    u.onend = () => { log('ended'); if (activeUtterance === u) activeUtterance = null; };
    u.onerror = (e) => {
      const code = e && e.error ? e.error : 'unknown';
      log('error event:', code);
      if (activeUtterance === u) activeUtterance = null;
      if (code !== 'interrupted' && code !== 'canceled') lastSpoken.delete(person.id);
    };

    const plan = planSpeak(stateOf(s));
    if (plan.cancelFirst) s.cancel();
    if (plan.resume && typeof s.resume === 'function') s.resume();
    activeUtterance = u; // hold it even while the delayed speak() is pending
    if (plan.delayMs > 0) {
      log('engine busy: cancelled, speaking in', plan.delayMs, 'ms');
      setTimeout(() => { if (enabled) startUtterance(s, u, text, () => started); }, plan.delayMs);
    } else {
      startUtterance(s, u, text, () => started);
    }
    lastSpoken.set(person.id, t);
    return true;
  } catch (err) {
    log('speakPerson failed:', err && err.name ? err.name : String(err));
    return false;
  }
}

/** Turns speech on or off. Turning it off cancels anything being said. */
export function setEnabled(on) {
  enabled = !!on;
  log('enabled =', enabled);
  if (!enabled) {
    activeUtterance = null;
    try { const s = synth(); if (s && typeof s.cancel === 'function') s.cancel(); } catch { /* ignore */ }
  }
}

export function isEnabled() {
  return enabled;
}

/** For tests: forget every cooldown. */
export function resetCooldowns() {
  lastSpoken.clear();
}
