// Pure matching + confirmation state machine. No DOM, no face library, no Node-only APIs:
// runs in the browser and under `node --test`.
//
// Rule of the house: when in doubt, show nothing. Every malformed or ambiguous input here
// resolves to "no match" (null), never to a name.
//
// Exports:
//   DEFAULTS                      starting thresholds (see SPEC.md, phase 4, for the evidence)
//   cosine(a, b)                  cosine similarity in [-1, 1], or NaN if the vectors can't be compared
//   scorePeople(embedding, people, opts)  [{ id, score }] per person (score null = not comparable)
//   decide(scores, opts)          id of the accepted candidate, or null
//   createTracker(opts)           N-consecutive-frame confirmation + 2 s drop-out

/**
 * Starting defaults. Tuned on thin, non-family data (see SPEC.md phase 4); accept lowered to 0.60 by owner decision;
 * re-tune with real enrolment photos in Test mode. Settings in the store may override each one.
 *   accept         minimum score (mean cosine of the 3 best enrolment fingerprints) to name anyone
 *   margin         minimum lead of the best person over the second best
 *   confirmFrames  consecutive analysed frames (~10 fps) with the same accepted candidate
 *   dropMs         how long without a match before the confirmed person is dropped
 *   topK           enrolment fingerprints averaged per person
 */
export const DEFAULTS = Object.freeze({
  accept: 0.6, // owner decision 2026-10-11: was 0.65 (too hard to meet on the iPhone); see SPEC.md
  margin: 0.1,
  confirmFrames: 5,
  dropMs: 2000,
  topK: 3,
});

function isVector(v) {
  return v != null && typeof v === 'object' && typeof v.length === 'number' && v.length > 0;
}

/**
 * Cosine similarity of two equal-length numeric vectors (arrays or typed arrays).
 * Returns NaN (= "not comparable", treated as no match) for: missing vectors, different lengths,
 * empty vectors, any non-finite value, or a zero vector. Result is clamped to [-1, 1].
 */
export function cosine(a, b) {
  if (!isVector(a) || !isVector(b) || a.length !== b.length) return NaN;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x !== 'number' || typeof y !== 'number') return NaN;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!Number.isFinite(dot) || !Number.isFinite(na) || !Number.isFinite(nb)) return NaN;
  if (na === 0 || nb === 0) return NaN;
  const c = dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(c)) return NaN;
  return Math.max(-1, Math.min(1, c));
}

/**
 * Score every enrolled person against one live fingerprint.
 * people: [{ id, embeddings: (Float32Array | number[])[] }, ...] (extra fields are ignored)
 * Score = mean cosine of that person's `topK` best-matching enrolment fingerprints (fewer if the
 * person has fewer usable ones). Fingerprints that can't be compared (wrong length, zero, NaN)
 * are skipped; a person with none left gets score null and can never be named.
 * Returns [{ id, score, used }] in the same order as `people` (used = fingerprints averaged).
 */
export function scorePeople(embedding, people, { topK = DEFAULTS.topK } = {}) {
  if (!Array.isArray(people)) return [];
  const k = Number.isFinite(topK) && topK >= 1 ? Math.floor(topK) : DEFAULTS.topK;
  const live = isVector(embedding) ? embedding : null;
  const out = [];
  for (const person of people) {
    if (!person || person.id == null) continue;
    const sims = [];
    if (live && Array.isArray(person.embeddings)) {
      for (const e of person.embeddings) {
        const c = cosine(live, e);
        if (Number.isFinite(c)) sims.push(c);
      }
    }
    if (sims.length === 0) {
      out.push({ id: person.id, score: null, used: 0 });
      continue;
    }
    sims.sort((x, y) => y - x);
    const best = sims.slice(0, k);
    const score = best.reduce((s, x) => s + x, 0) / best.length;
    out.push({ id: person.id, score, used: best.length });
  }
  return out;
}

/**
 * Pick the person to name for one frame, or null.
 * Accept the best only if best >= accept AND best - secondBest >= margin.
 * With a single comparable person there is no rival: the margin test is against 0 (a cosine of
 * about 0 means "unrelated"), so in practice only `accept` applies; accept must do the work.
 * A tie for first place is always null, whatever the margin. Invalid thresholds -> null.
 */
export function decide(scores, { accept = DEFAULTS.accept, margin = DEFAULTS.margin } = {}) {
  if (!Array.isArray(scores)) return null;
  if (!Number.isFinite(accept) || !Number.isFinite(margin)) return null;
  const m = Math.max(0, margin);
  let best = null;
  let second = null;
  for (const s of scores) {
    if (!s || s.id == null || typeof s.score !== 'number' || !Number.isFinite(s.score)) continue;
    if (best === null || s.score > best.score) {
      second = best;
      best = s;
    } else if (second === null || s.score > second.score) {
      second = s;
    }
  }
  if (best === null) return null;
  if (best.score < accept) return null;
  const rival = second === null ? 0 : second.score;
  if (second !== null && best.score <= second.score) return null; // tie: ambiguous
  if (best.score - rival < m) return null;
  return best.id;
}

/**
 * Confirmation state machine, fed once per analysed frame with decide()'s result.
 *   - A candidate is confirmed after `confirmFrames` consecutive frames naming it.
 *   - A null or different candidate resets the consecutive count.
 *   - A different person replaces the confirmed one as soon as they reach their own
 *     `confirmFrames` consecutive frames (no flash of "nobody" in between).
 *   - The confirmed person is dropped to nobody once `dropMs` have passed since the last frame
 *     that named them.
 *   - A non-finite timestamp is treated as a broken frame: everything resets to nobody.
 * update(candidateId | null, timestampMs?) -> { confirmedId, changed }
 *   timestampMs defaults to now(); changed is true when confirmedId differs from the last call.
 */
export function createTracker({
  confirmFrames = DEFAULTS.confirmFrames,
  dropMs = DEFAULTS.dropMs,
  now = () => Date.now(),
} = {}) {
  const n = Number.isFinite(confirmFrames) ? Math.max(1, Math.floor(confirmFrames)) : DEFAULTS.confirmFrames;
  const drop = Number.isFinite(dropMs) && dropMs >= 0 ? dropMs : DEFAULTS.dropMs;

  let confirmedId = null;
  let lastSeen = -Infinity; // timestamp of the last frame naming confirmedId
  let streakId = null;
  let streak = 0;

  function reset() {
    const was = confirmedId;
    confirmedId = null;
    lastSeen = -Infinity;
    streakId = null;
    streak = 0;
    return { confirmedId: null, changed: was !== null };
  }

  function update(candidateId, timestampMs) {
    const t = timestampMs === undefined ? now() : timestampMs;
    if (typeof t !== 'number' || !Number.isFinite(t)) return reset();
    const cand = candidateId === undefined ? null : candidateId;
    const before = confirmedId;

    if (cand === null) {
      streakId = null;
      streak = 0;
    } else if (cand === streakId) {
      streak += 1;
    } else {
      streakId = cand;
      streak = 1;
    }

    if (cand !== null && cand === confirmedId) {
      lastSeen = t;
    } else if (cand !== null && streak >= n) {
      confirmedId = cand; // first confirmation, or an immediate replacement
      lastSeen = t;
    }

    if (confirmedId !== null && t - lastSeen >= drop) {
      confirmedId = null;
      lastSeen = -Infinity;
    }

    return { confirmedId, changed: confirmedId !== before };
  }

  function state() {
    return { confirmedId, streakId, streak, lastSeen, confirmFrames: n, dropMs: drop };
  }

  return { update, reset, state };
}
