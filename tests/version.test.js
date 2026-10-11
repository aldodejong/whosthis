import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APP_VERSION, versionNumber, cacheVersionFromKeys, versionsDiffer, aboutNote, upToDateMessage, MSG_DIFFERENT,
} from '../src/version.js';

test('APP_VERSION in src/version.js equals CACHE_VERSION in sw.js', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const m = /const CACHE_VERSION = '([^']+)'/.exec(sw);
  assert.ok(m, 'could not find CACHE_VERSION in sw.js');
  assert.equal(
    m[1], APP_VERSION,
    `VERSION MISMATCH: sw.js CACHE_VERSION is '${m[1]}' but src/version.js APP_VERSION is '${APP_VERSION}'. Bump BOTH together on every release.`,
  );
});

test('src/version.js is in the service worker precache list', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./src/version.js'"), 'add ./src/version.js to PRECACHE in sw.js');
});

test('versionNumber', () => {
  assert.equal(versionNumber('v19'), 19);
  for (const bad of ['19', 'v', 'v1.2', '', null, undefined, 'vx']) assert.equal(versionNumber(bad), null);
});

test('cacheVersionFromKeys picks the highest whosthis cache', () => {
  assert.equal(cacheVersionFromKeys(['whosthis-v9', 'whosthis-v19', 'other-v50']), 'v19');
  assert.equal(cacheVersionFromKeys(['other']), null);
  assert.equal(cacheVersionFromKeys([]), null);
  assert.equal(cacheVersionFromKeys(null), null);
  assert.equal(cacheVersionFromKeys(['whosthis-latest', 5]), null);
});

test('versionsDiffer and aboutNote', () => {
  assert.equal(versionsDiffer('v19', 'v19'), false);
  assert.equal(versionsDiffer('v19', 'v20'), true);
  assert.equal(versionsDiffer('v19', null), false);
  assert.equal(aboutNote('v19', 'v19'), '');
  assert.equal(aboutNote('v19', null), '');
  assert.equal(aboutNote('v19', 'v20'), MSG_DIFFERENT);
  assert.match(upToDateMessage('v19'), /latest version \(v19\)/);
});
