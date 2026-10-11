import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/caregiver-logic.js';

const good = { face: { faceCount: 1, frameFraction: 0.4, score: 0.95 } };

test('pinProblem', () => {
  assert.equal(L.pinProblem('1234'), null);
  assert.equal(L.pinProblem('123456'), null);
  for (const bad of ['123', '1234567', 'abcd', '12 4', '', null, 1234]) assert.ok(L.pinProblem(bad));
});

test('accept range is 0.55-0.80; default is 0.60 (owner decisions 2026-10-11)', async () => {
  const { DEFAULTS } = await import('../src/matcher.js');
  assert.equal(L.ACCEPT_MIN, 0.55);
  assert.equal(L.ACCEPT_MAX, 0.8);
  assert.equal(DEFAULTS.accept, 0.6);
  assert.ok(L.ACCEPT_MIN <= DEFAULTS.accept && DEFAULTS.accept <= L.ACCEPT_MAX);
});

test('clampAccept keeps values inside [0.55, 0.80]', () => {
  assert.equal(L.clampAccept(0.55, 0.6), 0.55);
  assert.equal(L.clampAccept(0.8, 0.6), 0.8);
  assert.equal(L.clampAccept(0.54, 0.6), 0.55);
  assert.equal(L.clampAccept(0.5, 0.6), 0.55);
  assert.equal(L.clampAccept(0.3, 0.6), 0.55);
  assert.equal(L.clampAccept(-1, 0.6), 0.55);
  assert.equal(L.clampAccept(0.81, 0.6), 0.8);
  assert.equal(L.clampAccept(0.95, 0.6), 0.8);
  assert.equal(L.clampAccept(0.7, 0.6), 0.7);
  assert.equal(L.clampAccept(0.6, 0.6), 0.6);
  assert.equal(L.clampAccept(0.65, 0.6), 0.65); // the old default stays valid
  assert.equal(L.clampAccept('0.57', 0.6), 0.57); // slider values are strings
  assert.equal(L.clampAccept('0.4', 0.6), 0.55);
});

test('clampAccept: NaN / garbage falls back to the 0.60 default, never to the floor', () => {
  for (const junk of [NaN, Infinity, -Infinity, 'x', '', '  ', null, undefined, true, false, {}, [], [0.5]]) {
    assert.equal(L.clampAccept(junk, 0.6), 0.6, `junk ${String(junk)}`);
  }
});

test('clampAccept with the real default: garbage -> DEFAULTS.accept (0.60), old default 0.65 kept as saved', async () => {
  const { DEFAULTS } = await import('../src/matcher.js');
  for (const junk of [NaN, 'x', '', null, undefined, true, {}]) {
    assert.equal(L.clampAccept(junk, DEFAULTS.accept), 0.6, `junk ${String(junk)}`);
  }
  // Someone who already saved 0.65 (the old default) keeps it.
  assert.equal(L.clampAccept(0.65, DEFAULTS.accept), 0.65);
  // "Reset to recommended" writes DEFAULTS.accept, which survives the clamp unchanged.
  assert.equal(L.clampAccept(DEFAULTS.accept, DEFAULTS.accept), 0.6);
  assert.equal(L.clampAccept(String(DEFAULTS.accept), DEFAULTS.accept), 0.6);
});

test('clampAccept: nothing outside [0.55, 0.80] ever comes out (sweep)', () => {
  for (let v = -2; v <= 2; v += 0.001) {
    const a = L.clampAccept(v, 0.6);
    assert.ok(a >= 0.55 && a <= 0.8, `value ${v} -> ${a}`);
  }
});

test('clampMargin / clampConfirmFrames never go below the tuned defaults', () => {
  assert.equal(L.clampMargin(0, 0.1), 0.1);
  assert.equal(L.clampMargin(-1, 0.1), 0.1);
  assert.equal(L.clampMargin(0.15, 0.1), 0.15);
  assert.equal(L.clampMargin(5, 0.1), 1);
  assert.equal(L.clampMargin(undefined, 0.1), 0.1);
  assert.equal(L.clampMargin(NaN, 0.1), 0.1);
  assert.equal(L.clampConfirmFrames(1, 5), 5);
  assert.equal(L.clampConfirmFrames(0, 5), 5);
  assert.equal(L.clampConfirmFrames(7.9, 5), 7);
  assert.equal(L.clampConfirmFrames(1000, 5), 50);
  assert.equal(L.clampConfirmFrames('x', 5), 5);
  assert.equal(L.clampConfirmFrames(null, 5), 5);
});

test('checkPhoto decisions', () => {
  assert.equal(L.checkPhoto(good, 100).ok, true);
  assert.equal(L.checkPhoto(null, 100).ok, false);
  assert.match(L.checkPhoto({ face: { ...good.face, faceCount: 2 } }, 100).reason, /more than one/i);
  assert.match(L.checkPhoto({ face: { ...good.face, frameFraction: 0.1 } }, 100).reason, /too small/i);
  assert.match(L.checkPhoto({ face: { ...good.face, score: 0.4 } }, 100).reason, /not clear/i);
  assert.match(L.checkPhoto(good, 5).reason, /blurry/i);
  assert.equal(L.checkPhoto({ face: { ...good.face, score: NaN } }, 100).ok, false);
  assert.equal(L.checkPhoto(good, NaN).ok, false);
});

test('laplacianVariance: flat is 0, edges are higher', () => {
  const flat = new Float32Array(16 * 16).fill(128);
  const checker = Float32Array.from({ length: 256 }, (_, i) => ((i % 16) + Math.floor(i / 16)) % 2 ? 255 : 0);
  assert.equal(L.laplacianVariance(flat, 16, 16), 0);
  assert.ok(L.laplacianVariance(checker, 16, 16) > L.MIN_SHARPNESS);
});

test('fitWithin', () => {
  assert.deepEqual(L.fitWithin(4000, 3000, 1024), { width: 1024, height: 768 });
  assert.deepEqual(L.fitWithin(500, 400, 1024), { width: 500, height: 400 });
});

test('draftProblem', () => {
  const ok = { name: 'Jane', relationship: 'your daughter', hasDisplayPhoto: true, acceptedPhotos: 3 };
  assert.equal(L.draftProblem(ok), null);
  assert.ok(L.draftProblem({ ...ok, name: ' ' }));
  assert.ok(L.draftProblem({ ...ok, relationship: '' }));
  assert.ok(L.draftProblem({ ...ok, hasDisplayPhoto: false }));
  assert.ok(L.draftProblem({ ...ok, acceptedPhotos: 2 }));
  assert.ok(L.draftProblem({ ...ok, acceptedPhotos: 11 }));
});
