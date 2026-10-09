// Pure helpers for the patient and test views (no DOM, no face library) so they can run under
// `node --test`. Rule of the house: when in doubt, show nothing.

import { decide, cosine } from './matcher.js';

// Pipeline step 2 in SPEC.md. The test view imports these too, so there is one copy.
export const MAX_ANGLE_DEG = 30;
export const MIN_FACE_FRACTION = 0.15;
// A person needs at least this many usable fingerprints to be named (SPEC: 3-10 enrolment photos;
// the caregiver form already enforces 3, so this only guards against damaged or partial records).
export const MIN_FINGERPRINTS = 3;

/**
 * Why a detected face may not be fingerprint-matched, or null if it may.
 * 'no face' | 'too small' | 'no angle' | 'turned' (yaw/pitch/roll beyond MAX_ANGLE_DEG or not finite).
 */
export function gateReason(face) {
  if (!face) return 'no face';
  if (!Number.isFinite(face.frameFraction) || face.frameFraction < MIN_FACE_FRACTION) return 'too small';
  const a = face.angle;
  if (!a) return 'no angle';
  for (const v of [a.yaw, a.pitch, a.roll]) {
    if (!Number.isFinite(v) || Math.abs(v) > MAX_ANGLE_DEG) return 'turned';
  }
  return null;
}

/**
 * Is this face good enough to fingerprint-match? `face` is the `face` object from face.embed()/detect().
 * Returns false for a missing face, a face under MIN_FACE_FRACTION of the frame width, a missing angle,
 * or any of yaw/pitch/roll beyond MAX_ANGLE_DEG (or not a finite number).
 */
export function isUsableFace(face) {
  return gateReason(face) === null;
}

/**
 * People the matcher may name: only those whose fingerprints came from the current model, and who
 * have at least `minFingerprints` usable ones (non-empty, finite, non-zero, all the same length).
 * Unusable fingerprints are dropped. Returns [{ id, embeddings }] for matcher.scorePeople.
 */
export function buildCandidates(people, model, minFingerprints = MIN_FINGERPRINTS) {
  if (!Array.isArray(people)) return [];
  const out = [];
  for (const p of people) {
    if (!p || p.id == null || p.embeddingModel !== model) continue;
    if (!Array.isArray(p.embeddings) || p.embeddings.length === 0) continue;
    const usable = p.embeddings.filter((e) => Number.isFinite(cosine(e, e)));
    if (usable.length < minFingerprints) continue;
    if (usable.some((e) => e.length !== usable[0].length)) continue; // mixed models: not trustworthy
    out.push({ id: p.id, embeddings: usable });
  }
  return out;
}

/** Text for the card: { title: "This is Jane", relationship: "your daughter" | "" }. */
export function cardModel(person) {
  const name = person && typeof person.name === 'string' ? person.name.trim() : '';
  const rel = person && typeof person.relationship === 'string' ? person.relationship.trim() : '';
  return { title: name ? `This is ${name}` : '', relationship: rel };
}

// ---- Patient hint ("Not sure who this is") ------------------------------------------------------
// User-requested exception to "show nothing" (see SPEC.md, Patient mode item 6). It only ever says
// one of these calm lines, never anything technical, and never changes what the matcher decides.

export const HINT_UNSURE = 'Not sure who this is';
export const HINT_CLOSER = 'Please come a little closer';
export const HINT_DELAY_MS = 1500; // a face must be in view this long, unconfirmed, before a hint
export const HINT_GAP_MS = 400; // a face missing for less than this (a few dropped frames) still counts as present

/** Fresh hint state. */
export function initialHint() {
  return { since: null, lastFaceAt: null, closer: false };
}

/**
 * One analysed frame -> { state, message }. Pure; pass the returned state into the next call.
 * frame: { facePresent: boolean, gate: gateReason(face) | null, confirmed: boolean, now: ms }
 *   - a confirmed person, or a broken clock, clears everything at once (message null);
 *   - no face: the hint stays only while the face has been missing for less than HINT_GAP_MS
 *     (so one dropped detection doesn't make it blink), then it is cleared;
 *   - a face (usable or gated) for HINT_DELAY_MS without a confirmation -> HINT_CLOSER if the
 *     latest face was too small, otherwise HINT_UNSURE.
 */
export function nextHint(state, { facePresent, gate = null, confirmed = false, now } = {}, delayMs = HINT_DELAY_MS, gapMs = HINT_GAP_MS) {
  const st = state && typeof state === 'object' ? state : initialHint();
  if (confirmed || !Number.isFinite(now)) return { state: initialHint(), message: null };
  if (!facePresent) {
    if (st.since === null || st.lastFaceAt === null || now - st.lastFaceAt >= gapMs) {
      return { state: initialHint(), message: null };
    }
    return { state: { ...st }, message: now - st.since >= delayMs ? (st.closer ? HINT_CLOSER : HINT_UNSURE) : null };
  }
  const since = st.since === null ? now : st.since;
  const closer = gate === 'too small';
  const next = { since, lastFaceAt: now, closer };
  return { state: next, message: now - since >= delayMs ? (closer ? HINT_CLOSER : HINT_UNSURE) : null };
}

// ---- Test view: why the current frame names someone or nobody ---------------------------------

/**
 * Explain one frame's decision for the test view. Uses matcher.decide() itself, so the accepted id
 * is always exactly what patient mode would accept; the reason only describes a null result.
 * input: { facePresent, gate, modelOk, candidateCount, scores, accept, margin }
 * -> { id, reason, best: {id, score} | null, second: {id, score} | null }
 * reason: 'accepted' | 'no face' | 'nobody enrolled' | 'model mismatch' | 'gated: <gate>' |
 *         'no comparable scores' | 'best < accept' | 'tie' | 'margin too small'
 */
export function explainDecision({ facePresent, gate = null, modelOk = true, candidateCount = 0, scores = [], accept, margin } = {}) {
  const out = (id, reason, best = null, second = null) => ({ id, reason, best, second });
  if (!facePresent) return out(null, 'no face');
  if (!candidateCount) return out(null, 'nobody enrolled');
  if (!modelOk) return out(null, 'model mismatch');
  if (gate) return out(null, `gated: ${gate}`);
  const valid = (Array.isArray(scores) ? scores : [])
    .filter((s) => s && s.id != null && typeof s.score === 'number' && Number.isFinite(s.score))
    .slice()
    .sort((a, b) => b.score - a.score);
  const best = valid[0] ? { id: valid[0].id, score: valid[0].score } : null;
  const second = valid[1] ? { id: valid[1].id, score: valid[1].score } : null;
  const id = decide(scores, { accept, margin });
  if (id !== null) return out(id, 'accepted', best, second);
  if (!best) return out(null, 'no comparable scores');
  if (!Number.isFinite(accept) || !Number.isFinite(margin)) return out(null, 'invalid settings', best, second);
  if (best.score < accept) return out(null, 'best < accept', best, second);
  if (second && best.score <= second.score) return out(null, 'tie', best, second);
  return out(null, 'margin too small', best, second);
}
