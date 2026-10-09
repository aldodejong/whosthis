// Pure caregiver-mode logic (no DOM, no face library, no storage) so it can run under `node --test`.

export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const MAX_PEOPLE = 5;
export const MIN_ENROL_PHOTOS = 3;
export const MAX_ENROL_PHOTOS = 10;

// Photo checks (enrolment).
export const MIN_FACE_FRACTION = 0.15; // face width / image width, same as the live pipeline
export const MIN_FACE_SCORE = 0.7;     // library face confidence, 0..1
// Laplacian variance of a 256px-wide greyscale copy. Sharp phone photos land well above 100;
// out-of-focus ones fall below ~30. Starting value, tune with real photos.
export const MIN_SHARPNESS = 30;
export const SHARPNESS_WIDTH = 256;
export const MAX_PHOTO_PX = 1024;

// Match strictness (accept threshold). Never below 0.60: when in doubt, show nothing.
export const ACCEPT_MIN = 0.6;
export const ACCEPT_MAX = 0.8;

// Wrong-PIN throttle.
export const MAX_PIN_TRIES = 5;
export const PIN_LOCK_MS = 30000;

/** Returns an error message for an invalid PIN, or null if it is 4-6 digits. */
export function pinProblem(pin) {
  if (typeof pin !== 'string' || !/^\d+$/.test(pin)) return 'The PIN must be digits only.';
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return `The PIN must be ${PIN_MIN} to ${PIN_MAX} digits.`;
  return null;
}

/** Clamp a strictness value into the safe range. Non-numbers fall back to `fallback`. */
export function clampAccept(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(ACCEPT_MAX, Math.max(ACCEPT_MIN, n));
}

/**
 * Decide whether an enrolment photo is usable.
 * `result` is face.embed() output ({ face: { faceCount, frameFraction, score } }) or null.
 * Returns { ok: true } or { ok: false, reason } with a plain-English reason.
 */
export function checkPhoto(result, sharpness) {
  if (!result || !result.face) return { ok: false, reason: 'No face found. Use a clear photo of the face.' };
  const f = result.face;
  if (f.faceCount > 1) return { ok: false, reason: 'More than one face in the photo. Use a photo with only this person.' };
  if (!(f.frameFraction >= MIN_FACE_FRACTION)) return { ok: false, reason: 'The face is too small. Move closer or crop the photo.' };
  if (!(f.score >= MIN_FACE_SCORE)) return { ok: false, reason: 'The face is not clear enough. Try a brighter photo facing the camera.' };
  if (!(sharpness >= MIN_SHARPNESS)) return { ok: false, reason: 'The photo is blurry. Hold the phone steady and try again.' };
  return { ok: true };
}

/** Variance of the Laplacian over a greyscale buffer (Uint8/number array), width x height. */
export function laplacianVariance(gray, width, height) {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Scale (w, h) down so the longest side is at most `max`. Never upscales. */
export function fitWithin(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Returns an error message if the draft can't be saved, else null. */
export function draftProblem({ name, relationship, hasDisplayPhoto, acceptedPhotos }) {
  if (!String(name || '').trim()) return 'Please enter a name.';
  if (!String(relationship || '').trim()) return 'Please enter the relationship, for example "your daughter".';
  if (!hasDisplayPhoto) return 'Please add a display photo.';
  if (acceptedPhotos < MIN_ENROL_PHOTOS) {
    return `Add at least ${MIN_ENROL_PHOTOS} accepted enrolment photos (you have ${acceptedPhotos}).`;
  }
  if (acceptedPhotos > MAX_ENROL_PHOTOS) return `Use at most ${MAX_ENROL_PHOTOS} enrolment photos.`;
  return null;
}
