import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/backup.js';
import { DEFAULTS } from '../src/matcher.js';

const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const emb = () => Array.from({ length: 8 }, (_, i) => i / 10 - 0.3);

function person(i, over = {}) {
  return {
    id: `id${i}`, name: `Name${i}`, relationship: 'your daughter', createdAt: 1000 + i, embeddingModel: 'm1',
    displayPhoto: JPG, enrolPhotos: [JPG, PNG, JPG], embeddings: [emb(), emb(), emb()], ...over,
  };
}
const settings = { pinHash: 'a'.repeat(64), speechOn: false, accept: 0.7, margin: 0.2, confirmFrames: 7 };
const make = (people = [person(1), person(2)], s = settings) => JSON.parse(JSON.stringify(B.buildBackup(people, s, 5)));
const bad = (b, re) => { const r = B.validateBackup(b); assert.equal(r.ok, false); if (re) assert.match(r.error, re); };

test('accepts a good backup and keeps stricter settings', () => {
  const r = B.validateBackup(make());
  assert.equal(r.ok, true);
  assert.equal(r.people.length, 2);
  assert.deepEqual(r.settings, { speechOn: false, accept: 0.7, margin: 0.2, confirmFrames: 7, pinHash: 'a'.repeat(64) });
});

test('accepts Float32Array embeddings when building, zero people, and a missing pin', () => {
  const b = JSON.parse(JSON.stringify(B.buildBackup([person(1, { embeddings: [Float32Array.of(0.5, 1), Float32Array.of(1, 2), Float32Array.of(3, 4)] })], settings)));
  assert.equal(B.validateBackup(b).ok, true);
  assert.equal(B.validateBackup(make([])).ok, true);
  const noPin = B.validateBackup(make([person(1)], { ...settings, pinHash: null }));
  assert.equal('pinHash' in noPin.settings, false);
});

test('rejects wrong format and versions', () => {
  bad(null); bad([]); bad('x');
  bad({ ...make(), format: 'other' });
  for (const v of [0, 2, '1', undefined]) bad({ ...make(), version: v }, /different version/);
});

test('rejects more than 5 people and duplicate ids', () => {
  bad(make([1, 2, 3, 4, 5, 6].map((i) => person(i))), /more than 5/);
  assert.equal(B.validateBackup(make([1, 2, 3, 4, 5].map((i) => person(i)))).ok, true);
  bad(make([person(1), person(2, { id: 'id1' })]), /same id/);
});

test('enrolment photo count 3 to 10', () => {
  bad(make([person(1, { enrolPhotos: [JPG, JPG], embeddings: [emb(), emb()] })]), /3 to 10/);
  const eleven = Array(11).fill(JPG);
  bad(make([person(1, { enrolPhotos: eleven, embeddings: eleven.map(emb) })]), /3 to 10/);
  const ten = Array(10).fill(JPG);
  assert.equal(B.validateBackup(make([person(1, { enrolPhotos: ten, embeddings: ten.map(emb) })])).ok, true);
  bad(make([person(1, { embeddings: [emb(), emb()] })]), /different number/);
});

test('rejects bad embeddings', () => {
  const nan = emb(); nan[2] = NaN; // JSON turns NaN into null
  bad(make([person(1, { embeddings: [emb(), nan, emb()] })]), /bad number/);
  const raw = make(); raw.people[0].embeddings[0][0] = 'x';
  bad(raw, /bad number/);
  const inf = make(); inf.people[0].embeddings[0][0] = Infinity; // stays Infinity in memory
  bad(inf, /bad number/);
  bad(make([person(1, { embeddings: [emb(), emb().slice(0, 4), emb()] })]), /same size/);
  bad(make([person(1), person(2, { embeddings: [[1, 2], [1, 2], [1, 2]] })]), /same size/);
  bad(make([person(1, { embeddings: [[], [], []] })]), /not valid/);
});

test('rejects non-image and malformed photo data', () => {
  for (const photo of [
    'data:text/html;base64,PGh0bWw+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGODlh',
    'http://example.com/a.jpg', 'data:image/jpeg;base64,not base64!', 'data:image/jpeg;base64,AAAA', 'data:image/png;base64,/9j/4AAQ',
    '', 5, null,
  ]) {
    bad(make([person(1, { displayPhoto: photo })]));
    bad(make([person(1, { enrolPhotos: [JPG, photo, JPG] })]));
  }
});

test('rejects oversized and non-string text', () => {
  bad(make([person(1, { name: 'x'.repeat(101) })]), /too long/);
  bad(make([person(1, { relationship: 'x'.repeat(101) })]), /too long/);
  bad(make([person(1, { id: 'x'.repeat(101) })]), /too long/);
  bad(make([person(1, { name: '   ' })]), /empty/);
  bad(make([person(1, { name: 42 })]), /text/);
  bad(make([person(1, { embeddingModel: null })]), /text/);
  bad(make([person(1, { createdAt: 'now' })]), /date/);
  bad(make([person(1, { displayPhoto: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(B.MAX_PHOTO_CHARS) })]));
});

test('settings: accept clamped to 0.55-0.80, margin/confirmFrames never below defaults', () => {
  const s = B.sanitizeSettings({ accept: 0.1, margin: 0.0, confirmFrames: 1, speechOn: true });
  assert.equal(s.accept, 0.55);
  assert.equal(s.margin, DEFAULTS.margin);
  assert.equal(s.confirmFrames, DEFAULTS.confirmFrames);
  assert.equal(B.sanitizeSettings({ accept: 0.5 }).accept, 0.55);
  assert.equal(B.sanitizeSettings({ accept: 0.55 }).accept, 0.55);
  assert.equal(B.sanitizeSettings({ accept: 0.62 }).accept, 0.62); // any slider value round-trips
  assert.equal(B.sanitizeSettings({ accept: 0.8 }).accept, 0.8);
  assert.equal(B.sanitizeSettings({ accept: 99 }).accept, 0.8);
  const w = B.sanitizeSettings({ accept: 0.62, margin: -5, confirmFrames: -3 });
  assert.equal(w.margin, DEFAULTS.margin);
  assert.equal(w.confirmFrames, DEFAULTS.confirmFrames);
  assert.equal(B.sanitizeSettings({ margin: 0.05, confirmFrames: 4 }).margin, DEFAULTS.margin);
  assert.equal(B.sanitizeSettings({ margin: 0.05, confirmFrames: 4 }).confirmFrames, DEFAULTS.confirmFrames);
  for (const junk of [{ accept: NaN, margin: 'x', confirmFrames: null }, { accept: null }, { accept: '' }, { accept: 'x' }, null, undefined, 'x', {}]) {
    const j = B.sanitizeSettings(junk);
    assert.equal(j.accept, DEFAULTS.accept, 'garbage accept -> DEFAULTS.accept');
    assert.equal(j.accept, 0.6, 'garbage accept -> 0.60 default');
    assert.ok(j.margin >= DEFAULTS.margin && j.confirmFrames >= DEFAULTS.confirmFrames);
    assert.equal(typeof j.speechOn, 'boolean');
  }
  assert.equal('pinHash' in B.sanitizeSettings({ pinHash: 'nothex' }), false);
  assert.equal('pinHash' in B.sanitizeSettings({ pinHash: 'A'.repeat(64) }), false);
});

test('restoring a backup: accept 0.5 -> 0.55, loose margin/confirmFrames -> defaults', () => {
  const r = B.validateBackup(make(undefined, { ...settings, accept: 0.5, margin: 0, confirmFrames: 1 }));
  assert.equal(r.ok, true);
  assert.equal(r.settings.accept, 0.55);
  assert.equal(r.settings.margin, DEFAULTS.margin);
  assert.equal(r.settings.confirmFrames, DEFAULTS.confirmFrames);
  const low = B.validateBackup(make(undefined, { ...settings, accept: 0.1, margin: 0.09, confirmFrames: 4 }));
  assert.equal(low.settings.accept, 0.55);
  assert.equal(low.settings.margin, DEFAULTS.margin);
  assert.equal(low.settings.confirmFrames, DEFAULTS.confirmFrames);
  const ok = B.validateBackup(make(undefined, { ...settings, accept: 0.58 }));
  assert.equal(ok.settings.accept, 0.58);
  const old = B.validateBackup(make(undefined, { ...settings, accept: 0.65 }));
  assert.equal(old.settings.accept, 0.65, 'a saved 0.65 (old default) is kept');
  const junk = B.validateBackup(make(undefined, { ...settings, accept: 'x' }));
  assert.equal(junk.ok, true);
  assert.equal(junk.settings.accept, 0.6, 'garbage accept restores as the 0.60 default');
});

test('importSummary and decodePhoto', () => {
  assert.equal(B.importSummary(3, [1, 2]), 'Replace the current 3 people with 2 people from the backup?');
  assert.equal(B.importSummary(1, [1]), 'Replace the current 1 person with 1 person from the backup?');
  const d = B.decodePhoto(JPG + '==');
  assert.equal(d.type, 'image/jpeg');
  assert.ok(d.bytes.length > 0);
  assert.throws(() => B.decodePhoto('data:text/plain;base64,AAAA'));
});

test('standalone and iOS detection', () => {
  const mm = (v) => () => ({ matches: v });
  assert.equal(B.isStandalone({ standalone: true }, mm(false)), true);
  assert.equal(B.isStandalone({}, mm(true)), true);
  assert.equal(B.isStandalone({ standalone: false }, mm(false)), false);
  assert.equal(B.isStandalone({}, () => { throw new Error('x'); }), false);
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', standalone: false };
  assert.equal(B.shouldNudgeInstall(iphone, mm(false)), true);
  assert.equal(B.shouldNudgeInstall({ ...iphone, standalone: true }, mm(false)), false);
  assert.equal(B.shouldNudgeInstall({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }, mm(false)), false);
  assert.equal(B.isIos({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }), true);
});
