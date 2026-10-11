// Pure backup / import logic (no DOM, no storage, no face library) so it runs under `node --test`.
// A backup is one JSON file. Photos are data: URLs (image/jpeg or image/png, base64).
// validateBackup() checks EVERYTHING before the caller writes anything, and sanitizeSettings()
// applies the same limits as the settings screen: accept in [ACCEPT_MIN 0.55, ACCEPT_MAX 0.80]
// (owner decision 2026-10-11), margin and confirmFrames never looser than the tuned defaults.

import { DEFAULTS } from './matcher.js';
import {
  MAX_PEOPLE, MIN_ENROL_PHOTOS, MAX_ENROL_PHOTOS, clampAccept, clampMargin, clampConfirmFrames,
} from './caregiver-logic.js';

export const BACKUP_FORMAT = 'whosthis-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 60 * 1024 * 1024; // refuse bigger files before reading them
export const MAX_NAME_LEN = 100;
export const MAX_ID_LEN = 100;
export const MAX_MODEL_LEN = 100;
export const MAX_PHOTO_CHARS = 4 * 1024 * 1024; // one photo as a data: URL string
export const MAX_EMBEDDING_LEN = 4096;

const PHOTO_RE = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
// First base64 characters of real JPEG (FF D8 FF) and PNG (89 50 4E 47) data.
const MAGIC = { jpeg: '/9j/', png: 'iVBOR' };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Settings from outside (a backup) -> safe settings. accept is clamped to the slider range
 * (0.55-0.80, garbage -> DEFAULTS.accept, 0.60); margin/confirmFrames can only be stricter than defaults.
 */
export function sanitizeSettings(raw) {
  const s = isObj(raw) ? raw : {};
  const out = {
    speechOn: typeof s.speechOn === 'boolean' ? s.speechOn : true,
    // Same clamp as the settings slider and store.js, so a backup can hold any value the slider can.
    accept: clampAccept(s.accept, DEFAULTS.accept),
    margin: clampMargin(s.margin, DEFAULTS.margin),
    confirmFrames: clampConfirmFrames(s.confirmFrames, DEFAULTS.confirmFrames),
  };
  if (typeof s.pinHash === 'string' && HEX64_RE.test(s.pinHash)) out.pinHash = s.pinHash;
  return out;
}

/**
 * people: [{id, name, relationship, createdAt, embeddingModel, displayPhoto: dataUrl, enrolPhotos: [dataUrl], embeddings: [Float32Array|number[]]}]
 * settings: {pinHash, speechOn, accept, margin, confirmFrames}
 */
export function buildBackup(people, settings, now = Date.now()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      createdAt: p.createdAt,
      embeddingModel: p.embeddingModel,
      displayPhoto: p.displayPhoto,
      enrolPhotos: p.enrolPhotos,
      embeddings: p.embeddings.map((e) => Array.from(e)),
    })),
    settings: {
      pinHash: settings.pinHash ?? null,
      speechOn: !!settings.speechOn,
      accept: settings.accept,
      margin: settings.margin,
      confirmFrames: settings.confirmFrames,
    },
  };
}

function photoProblem(value, label) {
  if (typeof value !== 'string' || value.length > MAX_PHOTO_CHARS) return `${label} is not a valid photo.`;
  const m = PHOTO_RE.exec(value);
  if (!m) return `${label} is not a JPEG or PNG photo.`;
  if (m[2].length % 4 === 1) return `${label} is damaged.`;
  if (!m[2].startsWith(MAGIC[m[1]])) return `${label} is not really a ${m[1].toUpperCase()} photo.`;
  return null;
}

function textProblem(value, label, max) {
  if (typeof value !== 'string') return `${label} must be text.`;
  const t = value.trim();
  if (!t) return `${label} is empty.`;
  if (value.length > max) return `${label} is too long.`;
  return null;
}

/**
 * Strictly validates a parsed backup. Returns { ok: true, people, settings } (people copied, only
 * known fields) or { ok: false, error } with a plain-English reason. Nothing is written here.
 */
export function validateBackup(data) {
  const fail = (error) => ({ ok: false, error });
  if (!isObj(data)) return fail('This is not a Who\'s This? backup file.');
  if (data.format !== BACKUP_FORMAT) return fail('This is not a Who\'s This? backup file.');
  if (data.version !== BACKUP_VERSION) return fail('This backup was made by a different version of the app and cannot be used.');
  if (!Array.isArray(data.people)) return fail('The backup has no list of people.');
  if (data.people.length > MAX_PEOPLE) return fail(`The backup has more than ${MAX_PEOPLE} people.`);

  const people = [];
  const ids = new Set();
  let embLen = null;
  for (let i = 0; i < data.people.length; i++) {
    const p = data.people[i];
    const who = `Person ${i + 1}`;
    if (!isObj(p)) return fail(`${who} is not valid.`);
    let bad = textProblem(p.id, `${who}'s id`, MAX_ID_LEN)
      || textProblem(p.name, `${who}'s name`, MAX_NAME_LEN)
      || textProblem(p.relationship, `${who}'s relationship`, MAX_NAME_LEN)
      || textProblem(p.embeddingModel, `${who}'s model name`, MAX_MODEL_LEN);
    if (bad) return fail(bad);
    if (ids.has(p.id)) return fail(`${who} has the same id as another person.`);
    ids.add(p.id);
    if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) return fail(`${who}'s date is not valid.`);
    bad = photoProblem(p.displayPhoto, `${who}'s display photo`);
    if (bad) return fail(bad);
    if (!Array.isArray(p.enrolPhotos) || !Array.isArray(p.embeddings)) return fail(`${who} has no enrolment photos.`);
    const n = p.enrolPhotos.length;
    if (n < MIN_ENROL_PHOTOS || n > MAX_ENROL_PHOTOS) {
      return fail(`${who} must have ${MIN_ENROL_PHOTOS} to ${MAX_ENROL_PHOTOS} enrolment photos (this one has ${n}).`);
    }
    if (p.embeddings.length !== n) return fail(`${who} has a different number of photos and face fingerprints.`);
    for (let j = 0; j < n; j++) {
      bad = photoProblem(p.enrolPhotos[j], `${who}'s enrolment photo ${j + 1}`);
      if (bad) return fail(bad);
      const e = p.embeddings[j];
      if (!Array.isArray(e) || e.length === 0 || e.length > MAX_EMBEDDING_LEN) return fail(`${who}'s face fingerprint ${j + 1} is not valid.`);
      if (embLen === null) embLen = e.length;
      if (e.length !== embLen) return fail('The face fingerprints in the backup are not all the same size.');
      for (let k = 0; k < e.length; k++) {
        if (typeof e[k] !== 'number' || !Number.isFinite(e[k])) return fail(`${who}'s face fingerprint ${j + 1} has a bad number.`);
      }
    }
    people.push({
      id: p.id,
      name: p.name.trim(),
      relationship: p.relationship.trim(),
      createdAt: p.createdAt,
      embeddingModel: p.embeddingModel,
      displayPhoto: p.displayPhoto,
      enrolPhotos: p.enrolPhotos.slice(),
      embeddings: p.embeddings.map((e) => e.slice()),
    });
  }
  return { ok: true, people, settings: sanitizeSettings(data.settings) };
}

/** Plain-English confirmation question. */
export function importSummary(currentCount, backupPeople) {
  const m = backupPeople.length;
  const noun = (n) => (n === 1 ? 'person' : 'people');
  return `Replace the current ${currentCount} ${noun(currentCount)} with ${m} ${noun(m)} from the backup?`;
}

/** Decodes a validated data: URL to { type, bytes }. Throws on bad input. */
export function decodePhoto(dataUrl) {
  const m = PHOTO_RE.exec(dataUrl);
  if (!m) throw new Error('Not a JPEG or PNG photo.');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: `image/${m[1]}`, bytes };
}

/** Standalone = launched from the Home Screen icon. */
export function isStandalone(nav, matchMediaFn) {
  try {
    if (nav && nav.standalone === true) return true;
    if (typeof matchMediaFn === 'function' && matchMediaFn('(display-mode: standalone)').matches) return true;
  } catch (err) { /* ignore */ }
  return false;
}

/** iPhone / iPad (including iPadOS that reports as a Mac with touch). */
export function isIos(nav) {
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  return /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** True when the install-first nudge should show: iOS, in a browser tab, not the Home Screen app. */
export function shouldNudgeInstall(nav, matchMediaFn) {
  return isIos(nav) && !isStandalone(nav, matchMediaFn);
}
