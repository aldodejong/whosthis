import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSpeak, speakPerson, setEnabled, isEnabled, COOLDOWN_MS } from '../src/speech.js';

test('cooldown default is 45 000 ms', () => assert.equal(COOLDOWN_MS, 45000));

test('shouldSpeak: a person never spoken to is spoken to', () => {
  assert.equal(shouldSpeak(new Map(), 'jane', 1000), true);
});

test('shouldSpeak: blocked inside the 45 s cooldown, allowed exactly at 45 s', () => {
  const last = new Map([['jane', 1000]]);
  assert.equal(shouldSpeak(last, 'jane', 1000 + 44999), false);
  assert.equal(shouldSpeak(last, 'jane', 1000 + 45000), true);
  assert.equal(shouldSpeak(last, 'jane', 1000 + 60000), true);
});

test('shouldSpeak: cooldown is per person', () => {
  const last = new Map([['jane', 1000]]);
  assert.equal(shouldSpeak(last, 'sam', 1500), true);
  assert.equal(shouldSpeak(last, 'jane', 1500), false);
});

test('shouldSpeak: custom cooldown is respected', () => {
  const last = new Map([['jane', 0]]);
  assert.equal(shouldSpeak(last, 'jane', 500, 1000), false);
  assert.equal(shouldSpeak(last, 'jane', 1000, 1000), true);
});

test('shouldSpeak: disabled never speaks', () => {
  assert.equal(shouldSpeak(new Map(), 'jane', 1000, COOLDOWN_MS, false), false);
});

test('shouldSpeak: missing person id or non-finite clock never speaks', () => {
  assert.equal(shouldSpeak(new Map(), null, 1000), false);
  assert.equal(shouldSpeak(new Map(), undefined, 1000), false);
  assert.equal(shouldSpeak(new Map(), 'jane', NaN), false);
  assert.equal(shouldSpeak(new Map(), 'jane', Infinity), false);
});

test('shouldSpeak does not mutate the map', () => {
  const last = new Map([['jane', 1000]]);
  shouldSpeak(last, 'jane', 99999);
  assert.deepEqual([...last], [['jane', 1000]]);
});

test('speakPerson is a silent no-op under node (no speechSynthesis)', () => {
  assert.equal(globalThis.speechSynthesis, undefined);
  assert.equal(speakPerson({ id: 'jane', name: 'Jane', relationship: 'your daughter' }, { now: 1000 }), false);
});

test('setEnabled / isEnabled round-trip, and never throw without speechSynthesis', () => {
  setEnabled(false);
  assert.equal(isEnabled(), false);
  assert.equal(speakPerson({ id: 'jane', name: 'Jane' }, { now: 1000 }), false);
  setEnabled(true);
  assert.equal(isEnabled(), true);
});
