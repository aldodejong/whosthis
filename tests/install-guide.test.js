import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTALL_STEPS, ART, BROWSER_NOTE, SHARE_NOTE, canShare, shareData, isAbortError,
} from '../src/install-guide.js';

test('three steps, each with title, body and existing art', () => {
  assert.equal(INSTALL_STEPS.length, 3);
  for (const s of INSTALL_STEPS) {
    assert.ok(s.title && s.body);
    assert.ok(Array.isArray(ART[s.art]) && ART[s.art].length > 3);
  }
  assert.match(INSTALL_STEPS[0].title, /Share/);
  assert.match(INSTALL_STEPS[1].title, /Add to Home Screen/);
  assert.match(INSTALL_STEPS[2].title, /Add/);
});

test('art uses only known tags and no external references', () => {
  const tags = new Set(['rect', 'line', 'path', 'circle']);
  for (const list of Object.values(ART)) {
    for (const [tag, attrs] of list) {
      assert.ok(tags.has(tag), tag);
      assert.ok(!Object.keys(attrs).some((k) => /href|src|on/i.test(k) && k !== 'x1' && k !== 'x2'), tag);
    }
  }
});

test('notes are present', () => {
  assert.match(BROWSER_NOTE, /Safari/);
  assert.match(SHARE_NOTE, /Add to Home Screen/);
});

test('canShare', () => {
  assert.equal(canShare({ share() {} }), true);
  assert.equal(canShare({}), false);
  assert.equal(canShare(null), false);
});

test('shareData strips the hash', () => {
  assert.deepEqual(shareData('https://x.github.io/whosthis/#/caregiver'), { title: "Who's This?", url: 'https://x.github.io/whosthis/' });
  assert.equal(shareData('https://x/y/').url, 'https://x/y/');
  assert.equal(shareData(undefined).url, '');
});

test('isAbortError', () => {
  assert.equal(isAbortError({ name: 'AbortError' }), true);
  assert.equal(isAbortError(new Error('x')), false);
  assert.equal(isAbortError(null), false);
});
