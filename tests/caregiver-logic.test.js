import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/caregiver-logic.js';

const good = { face: { faceCount: 1, frameFraction: 0.4, score: 0.95 } };

test('pinProblem', () => {
  assert.equal(L.pinProblem('1234'), null);
  assert.equal(L.pinProblem('123456'), null);
  for (const bad of ['123', '1234567', 'abcd', '12 4', '', null, 1234]) assert.ok(L.pinProblem(bad));
});

test('clampAccept never goes below the safe minimum', () => {
  assert.equal(L.clampAccept(0.3, 0.65), 0.6);
  assert.equal(L.clampAccept(0.95, 0.65), 0.8);
  assert.equal(L.clampAccept(0.7, 0.65), 0.7);
  assert.equal(L.clampAccept('x', 0.65), 0.65);
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
