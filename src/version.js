// App version, shown to the caregiver. Pure (no DOM, no browser APIs) so node --test can load it.
// MUST equal CACHE_VERSION in sw.js: bump both together on every release.
// tests/version.test.js fails if they drift apart.

export const APP_VERSION = 'v23';
export const CACHE_PREFIX = 'whosthis-';

export const MSG_CHECKING = 'Checking…';
export const MSG_CHECK_FAILED = 'Couldn\'t check for a new version. Check your internet connection and try again.';
export const MSG_DIFFERENT = 'A different version is installed; press Refresh app.';

export function upToDateMessage(version) {
  return `You already have the latest version (${version}).`;
}

// 'v19' -> 19, anything else -> null.
export function versionNumber(v) {
  const m = /^v(\d+)$/.exec(String(v == null ? '' : v));
  return m ? Number(m[1]) : null;
}

// Highest 'whosthis-vNN' among cache names, returned as 'vNN', or null if none/unreadable.
export function cacheVersionFromKeys(keys) {
  if (!Array.isArray(keys)) return null;
  let best = null;
  for (const k of keys) {
    if (typeof k !== 'string' || !k.startsWith(CACHE_PREFIX)) continue;
    const n = versionNumber(k.slice(CACHE_PREFIX.length));
    if (n !== null && (best === null || n > best)) best = n;
  }
  return best === null ? null : `v${best}`;
}

// True when a cache release is known and is not the running code's version.
export function versionsDiffer(running, cacheVersion) {
  return Boolean(cacheVersion) && cacheVersion !== running;
}

// Plain-language line for the About section; empty when nothing needs saying.
export function aboutNote(running, cacheVersion) {
  return versionsDiffer(running, cacheVersion) ? MSG_DIFFERENT : '';
}
