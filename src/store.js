// IndexedDB wrapper (db "whosthis"). Everything stays on the device.
// Stores: `people` {id, name, relationship, displayPhoto, enrolPhotos, embeddings, embeddingModel, createdAt}
//         `settings` single record under key "main": {pinHash, speechOn, accept, margin, confirmFrames}
// Every function returns a promise that rejects with an Error carrying a plain message.

import { DEFAULTS } from './matcher.js';
import { MAX_PEOPLE, clampAccept, clampMargin, clampConfirmFrames } from './caregiver-logic.js';

const DB_NAME = 'whosthis';
const DB_VERSION = 1;
const SETTINGS_KEY = 'main';

let dbPromise = null;

function plain(err, what) {
  const detail = err && err.message ? err.message : String(err || 'unknown error');
  return new Error(`${what}: ${detail}`);
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Storage is not available in this browser.'));
        return;
      }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (err) { reject(plain(err, 'Could not open storage')); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('people')) db.createObjectStore('people', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(plain(req.error, 'Could not open storage'));
      req.onblocked = () => reject(new Error('Storage is blocked by another open tab. Close other tabs and retry.'));
    }).catch((err) => { dbPromise = null; throw err; });
  }
  return dbPromise;
}

// Runs fn(store, tx) inside a transaction; resolves with fn's request result once the tx completes.
async function withStore(storeName, mode, what, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let result;
    try {
      const tx = db.transaction(storeName, mode);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(plain(tx.error, what));
      tx.onabort = () => reject(plain(tx.error, what));
      const req = fn(tx.objectStore(storeName), tx);
      if (req) req.onsuccess = () => { result = req.result; };
    } catch (err) {
      reject(plain(err, what));
    }
  }).catch((err) => { throw err instanceof Error ? err : plain(err, what); });
}

export function listPeople() {
  return withStore('people', 'readonly', 'Could not load people', (s) => s.getAll())
    .then((rows) => (rows || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
}

export function getPerson(id) {
  return withStore('people', 'readonly', 'Could not load the person', (s) => s.get(id))
    .then((p) => p || null);
}

function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Saves a person. A person without an id is new: limited to MAX_PEOPLE. Resolves to the saved person. */
export async function savePerson(person) {
  try {
    if (!person || typeof person !== 'object') throw new Error('No person to save.');
    const all = await listPeople();
    const existing = person.id ? all.find((p) => p.id === person.id) : null;
    if (!existing && all.length >= MAX_PEOPLE) {
      throw new Error(`You can have at most ${MAX_PEOPLE} people. Delete someone first.`);
    }
    const record = {
      ...person,
      id: existing ? existing.id : (person.id || newId()),
      createdAt: existing ? existing.createdAt : (person.createdAt || Date.now()),
    };
    await withStore('people', 'readwrite', 'Could not save the person', (s) => s.put(record));
    return record;
  } catch (err) {
    throw err instanceof Error ? err : plain(err, 'Could not save the person');
  }
}

export function deletePerson(id) {
  return withStore('people', 'readwrite', 'Could not delete the person', (s) => s.delete(id)).then(() => undefined);
}

function defaultSettings() {
  return { pinHash: null, speechOn: true, accept: DEFAULTS.accept, margin: DEFAULTS.margin, confirmFrames: DEFAULTS.confirmFrames };
}

export async function getSettings() {
  const saved = await withStore('settings', 'readonly', 'Could not load settings', (s) => s.get(SETTINGS_KEY));
  const out = { ...defaultSettings(), ...(saved || {}) };
  out.accept = clampAccept(out.accept, DEFAULTS.accept);
  out.margin = clampMargin(out.margin, DEFAULTS.margin);
  out.confirmFrames = clampConfirmFrames(out.confirmFrames, DEFAULTS.confirmFrames);
  return out;
}

/** Merges a partial settings object into the saved settings. Resolves to the full settings. */
export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...(partial || {}) };
  next.accept = clampAccept(next.accept, DEFAULTS.accept);
  next.margin = clampMargin(next.margin, DEFAULTS.margin);
  next.confirmFrames = clampConfirmFrames(next.confirmFrames, DEFAULTS.confirmFrames);
  next.speechOn = !!next.speechOn;
  await withStore('settings', 'readwrite', 'Could not save settings', (s) => s.put(next, SETTINGS_KEY));
  return next;
}

/**
 * Replaces ALL people and merges settings in ONE transaction: either everything is written or,
 * on any error, nothing is (the transaction aborts). `people` must already be validated.
 * `settingsPatch` is merged into the current settings and clamped like saveSettings().
 */
export async function replaceAll(people, settingsPatch) {
  if (!Array.isArray(people) || people.length > MAX_PEOPLE) throw new Error(`At most ${MAX_PEOPLE} people can be stored.`);
  const current = await getSettings();
  const next = { ...current, ...(settingsPatch || {}) };
  next.accept = clampAccept(next.accept, DEFAULTS.accept);
  next.margin = clampMargin(next.margin, DEFAULTS.margin);
  next.confirmFrames = clampConfirmFrames(next.confirmFrames, DEFAULTS.confirmFrames);
  next.speechOn = !!next.speechOn;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(['people', 'settings'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(plain(tx.error, 'Could not restore the backup'));
      tx.onabort = () => reject(plain(tx.error, 'Could not restore the backup'));
      const ps = tx.objectStore('people');
      ps.clear();
      for (const p of people) ps.put(p);
      tx.objectStore('settings').put(next, SETTINGS_KEY);
    } catch (err) {
      try { if (tx) tx.abort(); } catch (e) { /* ignore */ }
      reject(plain(err, 'Could not restore the backup'));
    }
  });
  return next;
}

/** Asks the browser not to evict our data. Never throws. Resolves to true/false. */
export async function requestPersistence() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      return !!(await navigator.storage.persist());
    }
  } catch (err) { /* ignore */ }
  return false;
}

/** SHA-256 of the PIN as lowercase hex. */
export async function hashPin(pin) {
  if (!globalThis.crypto || !crypto.subtle) throw new Error('PIN protection needs a secure (HTTPS) connection.');
  const bytes = new TextEncoder().encode(String(pin));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
