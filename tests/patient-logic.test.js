import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsableFace, buildCandidates, cardModel, MIN_FINGERPRINTS } from '../src/patient-logic.js';

const good = { frameFraction: 0.2, angle: { yaw: 5, pitch: -5, roll: 10 } };

test('isUsableFace accepts a large, frontal face', () => assert.equal(isUsableFace(good), true));
test('isUsableFace rejects missing, small, or angled faces', () => {
  assert.equal(isUsableFace(null), false);
  assert.equal(isUsableFace({ ...good, frameFraction: 0.14 }), false);
  assert.equal(isUsableFace({ ...good, frameFraction: NaN }), false);
  assert.equal(isUsableFace({ ...good, angle: null }), false);
  assert.equal(isUsableFace({ ...good, angle: { yaw: 31, pitch: 0, roll: 0 } }), false);
  assert.equal(isUsableFace({ ...good, angle: { yaw: 0, pitch: -31, roll: 0 } }), false);
  assert.equal(isUsableFace({ ...good, angle: { yaw: 0, pitch: 0, roll: NaN } }), false);
});
test('isUsableFace accepts the boundary values', () => {
  assert.equal(isUsableFace({ frameFraction: 0.15, angle: { yaw: 30, pitch: -30, roll: 30 } }), true);
});

test('buildCandidates keeps only current-model people with fingerprints', () => {
  const e = [new Float32Array([1, 2]), new Float32Array([2, 1]), [1, 1]];
  const out = buildCandidates([
    { id: 'a', embeddingModel: 'm1', embeddings: e, name: 'A' },
    { id: 'b', embeddingModel: 'old', embeddings: e },
    { id: 'c', embeddingModel: 'm1', embeddings: [] },
    { id: 'd', embeddingModel: 'm1' },
    null,
  ], 'm1');
  assert.deepEqual(out, [{ id: 'a', embeddings: e }]);
  assert.deepEqual(buildCandidates(undefined, 'm1'), []);
});

test('buildCandidates: fewer than 3 usable fingerprints -> never a candidate', () => {
  assert.equal(MIN_FINGERPRINTS, 3);
  const ok = [1, 2];
  const people = [
    { id: 'two', embeddingModel: 'm1', embeddings: [ok, ok] },
    // three entries, but two are unusable (NaN, zero) -> only one left
    { id: 'damaged', embeddingModel: 'm1', embeddings: [ok, [NaN, 1], [0, 0]] },
    // unusable entries are dropped, the rest kept
    { id: 'mixed', embeddingModel: 'm1', embeddings: [ok, ok, [Infinity, 1], ok, null, []] },
    // lengths disagree: not trustworthy
    { id: 'lengths', embeddingModel: 'm1', embeddings: [ok, ok, [1, 2, 3]] },
  ];
  assert.deepEqual(buildCandidates(people, 'm1'), [{ id: 'mixed', embeddings: [ok, ok, ok] }]);
});

test('cardModel builds text and trims', () => {
  assert.deepEqual(cardModel({ name: ' Jane ', relationship: ' your daughter ' }), { title: 'This is Jane', relationship: 'your daughter' });
  assert.deepEqual(cardModel({ name: 'Jane' }), { title: 'This is Jane', relationship: '' });
  assert.deepEqual(cardModel(null), { title: '', relationship: '' });
});

// ---- gateReason -------------------------------------------------------------------------------
import {
  gateReason, initialHint, nextHint, explainDecision,
  HINT_UNSURE, HINT_CLOSER, HINT_DELAY_MS, HINT_GAP_MS,
} from '../src/patient-logic.js';

test('gateReason names the reason, and agrees with isUsableFace', () => {
  assert.equal(gateReason(good), null);
  assert.equal(gateReason(null), 'no face');
  assert.equal(gateReason({ ...good, frameFraction: 0.1 }), 'too small');
  assert.equal(gateReason({ ...good, angle: null }), 'no angle');
  assert.equal(gateReason({ ...good, angle: { yaw: 40, pitch: 0, roll: 0 } }), 'turned');
  for (const f of [good, null, { ...good, frameFraction: 0.1 }, { ...good, angle: { yaw: 0, pitch: 0, roll: NaN } }]) {
    assert.equal(isUsableFace(f), gateReason(f) === null);
  }
});

// ---- nextHint ---------------------------------------------------------------------------------
function run(frames, state = initialHint()) {
  const out = [];
  for (const f of frames) {
    const r = nextHint(state, f);
    state = r.state;
    out.push(r.message);
  }
  return { out, state };
}

test('nextHint: nothing for no-face frames', () => {
  const { out } = run([0, 100, 2000, 5000].map((now) => ({ facePresent: false, now })));
  assert.deepEqual(out, [null, null, null, null]);
});

test('nextHint: unsure only after a face is present for HINT_DELAY_MS without a confirmation', () => {
  const { out } = run([0, 500, 1000, HINT_DELAY_MS - 1, HINT_DELAY_MS, 3000].map((now) => ({ facePresent: true, now })));
  assert.deepEqual(out, [null, null, null, null, HINT_UNSURE, HINT_UNSURE]);
});

test('nextHint: a confirmed person hides it immediately and restarts the clock', () => {
  let { state } = run([0, 2000].map((now) => ({ facePresent: true, now })));
  let r = nextHint(state, { facePresent: true, confirmed: true, now: 2100 });
  assert.equal(r.message, null);
  r = nextHint(r.state, { facePresent: true, now: 2200 });
  assert.equal(r.message, null); // clock restarted at 2200
  r = nextHint(r.state, { facePresent: true, now: 2200 + HINT_DELAY_MS });
  assert.equal(r.message, HINT_UNSURE);
});

test('nextHint: confirmed never shows a hint, even with a face for a long time', () => {
  const { out } = run([0, 1000, 2000, 5000].map((now) => ({ facePresent: true, confirmed: true, now })));
  assert.deepEqual(out, [null, null, null, null]);
});

test('nextHint: face gone for HINT_GAP_MS hides it; one dropped frame does not', () => {
  let { state } = run([0, 1600].map((now) => ({ facePresent: true, now })));
  let r = nextHint(state, { facePresent: false, now: 1700 }); // single miss, 100 ms
  assert.equal(r.message, HINT_UNSURE);
  r = nextHint(r.state, { facePresent: true, now: 1800 });
  assert.equal(r.message, HINT_UNSURE);
  r = nextHint(r.state, { facePresent: false, now: 1800 + HINT_GAP_MS });
  assert.equal(r.message, null);
  r = nextHint(r.state, { facePresent: true, now: 1800 + HINT_GAP_MS + 100 });
  assert.equal(r.message, null); // starts counting again from scratch
});

test('nextHint: a too-small face asks to come closer; turned/usable faces say unsure', () => {
  assert.equal(run([0, 2000].map((now) => ({ facePresent: true, gate: 'too small', now }))).out[1], HINT_CLOSER);
  assert.equal(run([0, 2000].map((now) => ({ facePresent: true, gate: 'turned', now }))).out[1], HINT_UNSURE);
  // gated frames and usable frames count towards the same continuous presence
  const mixed = run([
    { facePresent: true, gate: 'too small', now: 0 },
    { facePresent: true, gate: null, now: 800 },
    { facePresent: true, gate: null, now: 1600 },
  ]);
  assert.deepEqual(mixed.out, [null, null, HINT_UNSURE]);
});

test('nextHint: broken clock or missing state is safe', () => {
  assert.equal(nextHint(undefined, { facePresent: true, now: NaN }).message, null);
  assert.equal(nextHint(null, { facePresent: true, now: 0 }).message, null);
});

// ---- explainDecision --------------------------------------------------------------------------
const T = { accept: 0.65, margin: 0.1 };
const base = { facePresent: true, gate: null, modelOk: true, candidateCount: 2, ...T };

test('explainDecision: accepted matches decide()', () => {
  const r = explainDecision({ ...base, scores: [{ id: 'a', score: 0.8 }, { id: 'b', score: 0.5 }] });
  assert.equal(r.id, 'a');
  assert.equal(r.reason, 'accepted');
  assert.deepEqual(r.best, { id: 'a', score: 0.8 });
  assert.deepEqual(r.second, { id: 'b', score: 0.5 });
});

test('explainDecision: reasons for no match, in priority order', () => {
  const sc = [{ id: 'a', score: 0.8 }, { id: 'b', score: 0.5 }];
  assert.equal(explainDecision({ ...base, facePresent: false, scores: sc }).reason, 'no face');
  assert.equal(explainDecision({ ...base, candidateCount: 0, scores: sc }).reason, 'nobody enrolled');
  assert.equal(explainDecision({ ...base, modelOk: false, scores: sc }).reason, 'model mismatch');
  const g = explainDecision({ ...base, gate: 'too small', scores: sc });
  assert.equal(g.reason, 'gated: too small');
  assert.equal(g.id, null); // gated faces are never accepted, whatever the scores
  assert.equal(explainDecision({ ...base, scores: [{ id: 'a', score: null }] }).reason, 'no comparable scores');
  assert.equal(explainDecision({ ...base, scores: [{ id: 'a', score: 0.6 }, { id: 'b', score: 0.1 }] }).reason, 'best < accept');
  assert.equal(explainDecision({ ...base, scores: [{ id: 'a', score: 0.7 }, { id: 'b', score: 0.7 }] }).reason, 'tie');
  assert.equal(explainDecision({ ...base, scores: [{ id: 'a', score: 0.75 }, { id: 'b', score: 0.7 }] }).reason, 'margin too small');
});

test('explainDecision: one enrolled person, only accept applies (same as decide)', () => {
  assert.equal(explainDecision({ ...base, candidateCount: 1, scores: [{ id: 'a', score: 0.66 }] }).id, 'a');
  const r = explainDecision({ ...base, candidateCount: 1, scores: [{ id: 'a', score: 0.64 }] });
  assert.equal(r.id, null);
  assert.equal(r.reason, 'best < accept');
});

test('explainDecision never accepts what decide() rejects (random sweep)', async () => {
  const { decide } = await import('../src/matcher.js');
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(rnd() * 5);
    const scores = Array.from({ length: n }, (_, k) => ({ id: `p${k}`, score: Math.round(rnd() * 100) / 100 }));
    const r = explainDecision({ ...base, candidateCount: n, scores });
    assert.equal(r.id, decide(scores, T));
    assert.equal(r.reason === 'accepted', r.id !== null);
  }
});
