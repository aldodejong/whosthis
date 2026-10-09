// speech.js against a fake speechSynthesis (this file runs in its own process under node --test).
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeUtterance {
  constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.volume = 1; this.rate = 1; }
}
function fakeSynth() {
  return {
    speaking: false, pending: false, paused: false, calls: [], voices: [],
    speak(u) { this.calls.push(['speak', u]); },
    cancel() { this.calls.push(['cancel']); this.speaking = false; this.pending = false; },
    resume() { this.calls.push(['resume']); this.paused = false; },
    getVoices() { return this.voices; },
    addEventListener() {},
  };
}
globalThis.SpeechSynthesisUtterance = FakeUtterance;
const synth = fakeSynth();
globalThis.speechSynthesis = synth;

const speech = await import('../src/speech.js');
const { speakPerson, unlock, planSpeak, chooseVoice, resetCooldowns, setEnabled, AFTER_CANCEL_MS } = speech;
const jane = { id: 'jane', name: 'Jane', relationship: 'your daughter' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fresh() { synth.calls = []; synth.speaking = false; synth.pending = false; synth.paused = false; synth.voices = []; resetCooldowns(); setEnabled(true); }

test('planSpeak: no cancel when idle; cancel + delay when busy; resume when paused', () => {
  assert.deepEqual(planSpeak({}), { cancelFirst: false, resume: false, delayMs: 0 });
  assert.deepEqual(planSpeak({ speaking: true }), { cancelFirst: true, resume: false, delayMs: AFTER_CANCEL_MS });
  assert.deepEqual(planSpeak({ pending: true, paused: true }), { cancelFirst: true, resume: true, delayMs: AFTER_CANCEL_MS });
  assert.equal(planSpeak({ paused: true }).resume, true);
});

test('chooseVoice: default English, then local en-US, then en-US; null for empty', () => {
  assert.equal(chooseVoice([]), null);
  assert.equal(chooseVoice(undefined), null);
  const remote = { name: 'Remote', lang: 'en-US', localService: false };
  const local = { name: 'Local', lang: 'en-US', localService: true };
  const gb = { name: 'GB', lang: 'en_GB', localService: true, default: true };
  const nl = { name: 'NL', lang: 'nl-NL', default: true };
  assert.equal(chooseVoice([remote, local]), local);
  assert.equal(chooseVoice([remote]), remote);
  assert.equal(chooseVoice([remote, local, gb]), gb);
  assert.equal(chooseVoice([nl, remote, local]), local);
  assert.equal(chooseVoice([nl]), null);
});

test('speakPerson when idle: speaks at once, no cancel, en-US, rate 0.85, sentence', () => {
  fresh();
  assert.equal(speakPerson(jane, { now: 1000 }), true);
  assert.deepEqual(synth.calls.map((c) => c[0]), ['speak']);
  const u = synth.calls[0][1];
  assert.equal(u.text, 'This is Jane, your daughter.');
  assert.equal(u.lang, 'en-US');
  assert.equal(u.rate, 0.85);
  assert.equal(u.volume, 1);
  assert.equal(u.voice, null); // voices not loaded yet: engine default, no waiting
});

test('speakPerson when busy: cancel first, then speak after a delay (not in the same tick)', async () => {
  fresh();
  synth.speaking = true;
  assert.equal(speakPerson(jane, { now: 1000 }), true);
  assert.deepEqual(synth.calls.map((c) => c[0]), ['cancel']);
  await sleep(AFTER_CANCEL_MS + 30);
  assert.deepEqual(synth.calls.map((c) => c[0]), ['cancel', 'speak']);
});

test('speakPerson resumes a paused engine', () => {
  fresh();
  synth.paused = true;
  speakPerson(jane, { now: 1000 });
  assert.ok(synth.calls.some((c) => c[0] === 'resume'));
  assert.ok(synth.calls.some((c) => c[0] === 'speak'));
});

test('speakPerson uses a loaded voice and respects the cooldown', () => {
  fresh();
  const local = { name: 'Local', lang: 'en-US', localService: true };
  synth.voices = [local];
  assert.equal(speakPerson(jane, { now: 1000 }), true);
  assert.equal(synth.calls[0][1].voice, local);
  assert.equal(speakPerson(jane, { now: 2000 }), false);
  assert.equal(speakPerson(jane, { now: 1000 + 45000 }), true);
});

test('a hard error event clears the cooldown; an interruption does not', () => {
  fresh();
  speakPerson(jane, { now: 1000 });
  synth.calls[0][1].onerror({ error: 'not-allowed' });
  assert.equal(speakPerson(jane, { now: 1100 }), true);
  synth.calls[1][1].onerror({ error: 'interrupted' });
  assert.equal(speakPerson(jane, { now: 1200 }), false);
});

test('switched off: never speaks', () => {
  fresh();
  setEnabled(false);
  assert.equal(speakPerson(jane, { now: 1000 }), false);
  assert.ok(!synth.calls.some((c) => c[0] === 'speak'));
  setEnabled(true);
});

test('unlock: silent utterance, no cancel when idle', () => {
  fresh();
  unlock();
  assert.deepEqual(synth.calls.map((c) => c[0]), ['speak']);
  assert.equal(synth.calls[0][1].volume, 0);
  synth.calls = [];
  synth.pending = true;
  unlock();
  assert.deepEqual(synth.calls.map((c) => c[0]), ['cancel', 'speak']);
});
