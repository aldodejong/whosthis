// Unit tests for src/matcher.js. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, cosine, scorePeople, decide, createTracker } from '../src/matcher.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// Unit vector in 2D at angle whose cosine to [1, 0] is c (handy for exact scores).
const vecWithCos = (c) => [c, Math.sqrt(1 - c * c)];
const X = [1, 0];

// ---------- DEFAULTS

test('DEFAULTS are sane and frozen', () => {
  assert.ok(DEFAULTS.accept > 0 && DEFAULTS.accept < 1);
  assert.ok(DEFAULTS.margin > 0 && DEFAULTS.margin < DEFAULTS.accept);
  assert.equal(DEFAULTS.confirmFrames, 5);
  assert.equal(DEFAULTS.dropMs, 2000);
  assert.equal(DEFAULTS.topK, 3);
  assert.ok(Object.isFrozen(DEFAULTS));
});

// ---------- cosine

test('cosine: identical, opposite, orthogonal, scale-invariant', () => {
  close(cosine([1, 2, 3], [1, 2, 3]), 1);
  close(cosine([1, 2, 3], [2, 4, 6]), 1);
  close(cosine([1, 0], [-1, 0]), -1);
  close(cosine([1, 0], [0, 5]), 0);
  close(cosine([1, 1], [1, 0]), Math.SQRT1_2);
});

test('cosine: works on Float32Array and mixed array types', () => {
  close(cosine(Float32Array.from([0.5, 0.5]), [1, 1]), 1);
});

test('cosine: never exceeds [-1, 1]', () => {
  const v = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i) * 1e3);
  const c = cosine(v, v);
  assert.ok(c <= 1 && c >= -1);
});

test('cosine: not comparable -> NaN', () => {
  assert.ok(Number.isNaN(cosine([1, 2], [1, 2, 3])), 'length mismatch');
  assert.ok(Number.isNaN(cosine([], [])), 'empty');
  assert.ok(Number.isNaN(cosine([0, 0], [1, 1])), 'zero vector');
  assert.ok(Number.isNaN(cosine([NaN, 1], [1, 1])), 'NaN');
  assert.ok(Number.isNaN(cosine([Infinity, 1], [1, 1])), 'Infinity');
  assert.ok(Number.isNaN(cosine(null, [1])), 'null');
  assert.ok(Number.isNaN(cosine(undefined, undefined)), 'undefined');
  assert.ok(Number.isNaN(cosine(['1', '0'], [1, 0])), 'strings');
  assert.ok(Number.isNaN(cosine([1e200, 1e200], [1e200, 1e200])), 'overflow');
});

// ---------- scorePeople

test('scorePeople: averages the 3 best-matching enrolment fingerprints', () => {
  const people = [{ id: 'jane', embeddings: [0.9, 0.2, 0.8, 0.7, 0.1].map(vecWithCos) }];
  const [s] = scorePeople(X, people);
  assert.equal(s.id, 'jane');
  assert.equal(s.used, 3);
  close(s.score, (0.9 + 0.8 + 0.7) / 3);
});

test('scorePeople: fewer than 3 enrolment fingerprints uses what there is', () => {
  const [one] = scorePeople(X, [{ id: 'a', embeddings: [vecWithCos(0.8)] }]);
  close(one.score, 0.8);
  assert.equal(one.used, 1);
  const [two] = scorePeople(X, [{ id: 'b', embeddings: [vecWithCos(0.8), vecWithCos(0.6)] }]);
  close(two.score, 0.7);
});

test('scorePeople: topK is a parameter', () => {
  const people = [{ id: 'a', embeddings: [0.9, 0.5, 0.1].map(vecWithCos) }];
  close(scorePeople(X, people, { topK: 1 })[0].score, 0.9);
  close(scorePeople(X, people, { topK: 2 })[0].score, 0.7);
});

test('scorePeople: keeps order, one result per person', () => {
  const people = [
    { id: 'a', embeddings: [vecWithCos(0.2)] },
    { id: 'b', embeddings: [vecWithCos(0.9)] },
  ];
  assert.deepEqual(scorePeople(X, people).map((s) => s.id), ['a', 'b']);
});

test('scorePeople: zero people / bad input -> empty list', () => {
  assert.deepEqual(scorePeople(X, []), []);
  assert.deepEqual(scorePeople(X, null), []);
  assert.deepEqual(scorePeople(X, undefined), []);
});

test('scorePeople: unusable fingerprints are skipped; none left -> score null', () => {
  const people = [
    { id: 'mixed', embeddings: [[1, 0, 0], [0, 0], [NaN, 1], vecWithCos(0.6)] },
    { id: 'broken', embeddings: [[1, 0, 0], [0, 0]] },
    { id: 'empty', embeddings: [] },
    { id: 'missing' },
    null,
    { embeddings: [X] }, // no id: ignored
  ];
  const s = scorePeople(X, people);
  assert.deepEqual(s.map((x) => x.id), ['mixed', 'broken', 'empty', 'missing']);
  close(s[0].score, 0.6);
  assert.equal(s[0].used, 1);
  for (const x of s.slice(1)) assert.equal(x.score, null);
});

test('scorePeople: unusable live fingerprint -> everyone null', () => {
  const people = [{ id: 'a', embeddings: [X] }];
  for (const live of [null, [], [0, 0], [NaN, 0], [1, 0, 0]]) {
    assert.equal(scorePeople(live, people)[0].score, null);
  }
});

// ---------- decide

const S = (pairs) => pairs.map(([id, score]) => ({ id, score }));
const opts = { accept: 0.6, margin: 0.1 };

test('decide: accepts when above threshold with a clear lead', () => {
  assert.equal(decide(S([['jane', 0.75], ['bob', 0.4]]), opts), 'jane');
  assert.equal(decide(S([['bob', 0.4], ['jane', 0.75]]), opts), 'jane');
});

test('decide: accept threshold is inclusive and strict below', () => {
  assert.equal(decide(S([['jane', 0.6], ['bob', 0.1]]), opts), 'jane');
  assert.equal(decide(S([['jane', 0.5999], ['bob', 0.1]]), opts), null);
});

test('decide: margin rule rejects close calls', () => {
  assert.equal(decide(S([['jane', 0.75], ['bob', 0.70]]), opts), null);
  assert.equal(decide(S([['jane', 0.75], ['bob', 0.66]]), opts), null);
  assert.equal(decide(S([['jane', 0.75], ['bob', 0.64]]), opts), 'jane');
  // Exactly at the margin is a floating-point coin toss (0.75 - 0.65 = 0.0999...); it must
  // never produce a different name, only jane or null.
  assert.ok([null, 'jane'].includes(decide(S([['jane', 0.75], ['bob', 0.65]]), opts)));
  assert.equal(decide(S([['jane', 0.75], ['bob', 0.68], ['amy', 0.2]]), opts), null, 'second best counts, not the worst');
});

test('decide: a tie for first is never named, even with margin 0', () => {
  assert.equal(decide(S([['jane', 0.8], ['bob', 0.8]]), { accept: 0.5, margin: 0 }), null);
});

test('decide: single person -> only accept applies (margin against 0)', () => {
  assert.equal(decide(S([['jane', 0.7]]), opts), 'jane');
  assert.equal(decide(S([['jane', 0.55]]), opts), null);
  // margin larger than the score itself still blocks
  assert.equal(decide(S([['jane', 0.7]]), { accept: 0.6, margin: 0.8 }), null);
});

test('decide: null/NaN scores are ignored as rivals and never win', () => {
  assert.equal(decide(S([['jane', 0.8], ['bob', null], ['amy', NaN]]), opts), 'jane');
  assert.equal(decide(S([['bob', null], ['amy', NaN]]), opts), null);
  assert.equal(decide(S([['bob', Infinity]]), opts), null);
});

test('decide: zero people / bad input -> null', () => {
  assert.equal(decide([], opts), null);
  assert.equal(decide(null, opts), null);
  assert.equal(decide(undefined), null);
  assert.equal(decide([{ score: 0.99 }], opts), null, 'no id');
});

test('decide: invalid thresholds -> null', () => {
  const s = S([['jane', 0.9]]);
  assert.equal(decide(s, { accept: NaN, margin: 0.1 }), null);
  assert.equal(decide(s, { accept: 0.6, margin: undefined }), 'jane', 'undefined falls back to default');
  assert.equal(decide(s, { accept: 0.6, margin: NaN }), null);
});

test('decide: uses DEFAULTS when no options given', () => {
  const hi = Math.min(0.99, DEFAULTS.accept + 0.05);
  assert.equal(decide(S([['jane', hi]])), 'jane');
  assert.equal(decide(S([['jane', DEFAULTS.accept - 0.01]])), null);
});

test('end to end: scorePeople -> decide', () => {
  const people = [
    { id: 'jane', embeddings: [0.95, 0.9, 0.85, 0.2].map(vecWithCos) },
    { id: 'bob', embeddings: [0.3, 0.2].map(vecWithCos) },
  ];
  assert.equal(decide(scorePeople(X, people), opts), 'jane');
  assert.equal(decide(scorePeople([1, 0, 0], people), opts), null, 'wrong length live vector');
  assert.equal(decide(scorePeople(X, []), opts), null, 'nobody enrolled');
});

// ---------- the key property: never more likely to name the wrong person

test('property: stricter settings never add a name; borderline cases return null', () => {
  // Random score sets; any name returned under stricter settings must also be returned under looser.
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < 2000; t++) {
    const n = 1 + Math.floor(rnd() * 5);
    const scores = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, score: rnd() * 1.2 - 0.2 }));
    const a = 0.3 + rnd() * 0.6;
    const m = rnd() * 0.3;
    const loose = decide(scores, { accept: a, margin: m });
    const strict = decide(scores, { accept: a + rnd() * 0.2, margin: m + rnd() * 0.1 });
    if (strict !== null) assert.equal(strict, loose);
    // Whatever is named is the unique top scorer.
    if (loose !== null) {
      const top = Math.max(...scores.map((s) => s.score));
      assert.equal(scores.find((s) => s.id === loose).score, top);
      assert.equal(scores.filter((s) => s.score === top).length, 1);
    }
  }
});

test('property: adding a near rival can only turn a name into null, never into another name', () => {
  const base = S([['jane', 0.8], ['bob', 0.3]]);
  assert.equal(decide(base, opts), 'jane');
  for (const rival of [0.3, 0.6, 0.71, 0.75, 0.79, 0.8]) {
    const d = decide([...base, { id: 'amy', score: rival }], opts);
    assert.ok(d === 'jane' || d === null, `rival ${rival} gave ${d}`);
  }
  assert.equal(decide([...base, { id: 'amy', score: 0.75 }], opts), null);
});

test('property: borderline scores around default thresholds return null', () => {
  const { accept, margin } = DEFAULTS;
  assert.equal(decide(S([['jane', accept - 1e-6]])), null);
  assert.equal(decide(S([['jane', accept + 0.2], ['bob', accept + 0.2 - margin + 1e-3]])), null);
});

// ---------- tracker

function feed(tracker, seq, start = 0, step = 100) {
  // seq: array of candidate ids/nulls, one per frame at 10 fps
  const out = [];
  seq.forEach((c, i) => out.push(tracker.update(c, start + i * step)));
  return out;
}

test('tracker: confirms only after N consecutive frames', () => {
  const tr = createTracker({ confirmFrames: 5 });
  const out = feed(tr, ['jane', 'jane', 'jane', 'jane', 'jane']);
  assert.deepEqual(out.map((o) => o.confirmedId), [null, null, null, null, 'jane']);
  assert.deepEqual(out.map((o) => o.changed), [false, false, false, false, true]);
  assert.equal(tr.update('jane', 500).changed, false);
});

test('tracker: a null frame resets the count', () => {
  const tr = createTracker({ confirmFrames: 5 });
  const out = feed(tr, ['jane', 'jane', 'jane', 'jane', null, 'jane', 'jane', 'jane', 'jane']);
  assert.ok(out.every((o) => o.confirmedId === null));
  assert.equal(tr.update('jane', 900).confirmedId, 'jane');
});

test('tracker: a different candidate resets the count', () => {
  const tr = createTracker({ confirmFrames: 3 });
  const out = feed(tr, ['jane', 'jane', 'bob', 'jane', 'jane']);
  assert.ok(out.every((o) => o.confirmedId === null));
});

test('tracker: confirmFrames = 1 confirms immediately', () => {
  const tr = createTracker({ confirmFrames: 1 });
  assert.deepEqual(tr.update('jane', 0), { confirmedId: 'jane', changed: true });
});

test('tracker: replacement is immediate once the new person has N frames (no gap of nobody)', () => {
  const tr = createTracker({ confirmFrames: 3 });
  feed(tr, ['jane', 'jane', 'jane']);
  const out = feed(tr, ['bob', 'bob', 'bob'], 300);
  assert.deepEqual(out.map((o) => o.confirmedId), ['jane', 'jane', 'bob']);
  assert.equal(out[2].changed, true);
});

test('tracker: brief other-person noise does not replace the confirmed person', () => {
  const tr = createTracker({ confirmFrames: 3 });
  feed(tr, ['jane', 'jane', 'jane']);
  const out = feed(tr, ['bob', 'bob', 'jane', 'bob', 'bob', null, 'bob', 'bob', 'jane'], 300);
  assert.ok(out.every((o) => o.confirmedId === 'jane'));
});

test('tracker: drops to nobody only after 2000 ms without a match', () => {
  const tr = createTracker({ confirmFrames: 2 });
  feed(tr, ['jane', 'jane']); // confirmed at t=100, last seen t=100
  assert.equal(tr.update(null, 1000).confirmedId, 'jane');
  assert.equal(tr.update(null, 2099).confirmedId, 'jane');
  const r = tr.update(null, 2100);
  assert.deepEqual(r, { confirmedId: null, changed: true });
  assert.equal(tr.update(null, 2200).changed, false);
});

test('tracker: each matching frame restarts the 2 s window', () => {
  const tr = createTracker({ confirmFrames: 1 });
  tr.update('jane', 0);
  tr.update(null, 1500);
  tr.update('jane', 1900);
  assert.equal(tr.update(null, 3800).confirmedId, 'jane');
  assert.equal(tr.update(null, 3900).confirmedId, null);
});

test('tracker: an unconfirmed other candidate does not keep the confirmed one alive', () => {
  const tr = createTracker({ confirmFrames: 5 });
  feed(tr, ['jane', 'jane', 'jane', 'jane', 'jane']); // last seen t=400
  // Bob flickers (never 5 in a row) for over 2 s: Jane must still drop.
  const seq = [];
  for (let i = 0; i < 25; i++) seq.push(i % 4 === 3 ? null : 'bob');
  const out = feed(tr, seq, 500);
  const dropAt = out.findIndex((o) => o.confirmedId === null);
  assert.equal(500 + dropAt * 100, 2400);
  assert.ok(out.slice(dropAt).every((o) => o.confirmedId === null));
});

test('tracker: alternating noise never confirms anyone', () => {
  const tr = createTracker({ confirmFrames: 5 });
  const seq = [];
  for (let i = 0; i < 200; i++) seq.push(['jane', 'bob', null, 'jane', 'jane', 'amy'][i % 6]);
  assert.ok(feed(tr, seq).every((o) => o.confirmedId === null));
});

test('tracker: 4-of-5 flicker never confirms with N = 5', () => {
  const tr = createTracker({ confirmFrames: 5 });
  const seq = [];
  for (let i = 0; i < 100; i++) seq.push(i % 5 === 4 ? null : 'jane');
  assert.ok(feed(tr, seq).every((o) => o.confirmedId === null));
});

test('tracker: flapping between two confirmed people needs N frames each time', () => {
  const tr = createTracker({ confirmFrames: 3 });
  const seq = ['jane', 'jane', 'jane', 'bob', 'bob', 'jane', 'bob', 'bob', 'bob', 'jane', 'jane'];
  const ids = feed(tr, seq).map((o) => o.confirmedId);
  assert.deepEqual(ids, [null, null, 'jane', 'jane', 'jane', 'jane', 'jane', 'jane', 'bob', 'bob', 'bob']);
});

test('tracker: reset() returns to nobody', () => {
  const tr = createTracker({ confirmFrames: 1 });
  tr.update('jane', 0);
  assert.deepEqual(tr.reset(), { confirmedId: null, changed: true });
  assert.deepEqual(tr.reset(), { confirmedId: null, changed: false });
  assert.equal(tr.update('jane', 100).changed, true);
});

test('tracker: bad timestamps fail safe to nobody', () => {
  const tr = createTracker({ confirmFrames: 1 });
  tr.update('jane', 0);
  assert.deepEqual(tr.update('jane', NaN), { confirmedId: null, changed: true });
  assert.equal(tr.update('jane', 'soon').confirmedId, null);
});

test('tracker: uses now() when no timestamp is given', () => {
  let t = 0;
  const tr = createTracker({ confirmFrames: 2, now: () => t });
  tr.update('jane'); t += 100;
  assert.equal(tr.update('jane').confirmedId, 'jane');
  t += 2100;
  assert.equal(tr.update(null).confirmedId, null);
});

test('tracker: invalid options fall back to safe values', () => {
  const zero = createTracker({ confirmFrames: 0 });
  assert.equal(zero.state().confirmFrames, 1);
  const nan = createTracker({ confirmFrames: NaN, dropMs: -5 });
  assert.equal(nan.state().confirmFrames, DEFAULTS.confirmFrames);
  assert.equal(nan.state().dropMs, DEFAULTS.dropMs);
  assert.equal(createTracker({ confirmFrames: 2.7 }).state().confirmFrames, 2);
});

test('tracker: defaults to DEFAULTS.confirmFrames', () => {
  const tr = createTracker();
  const out = feed(tr, Array(DEFAULTS.confirmFrames).fill('jane'));
  assert.equal(out.at(-2).confirmedId, null);
  assert.equal(out.at(-1).confirmedId, 'jane');
});
