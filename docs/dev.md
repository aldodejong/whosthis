# Run locally

From the project root:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000. Routes are hash-based: `#/patient` (default), `#/caregiver`, `#/test`.

`localhost` counts as a secure context, so the service worker and the camera work on the desktop.

**The iPhone needs HTTPS.** Camera access and the service worker do not work over plain `http://` on a phone. To test on an iPhone, use the GitHub Pages URL (`https://aldodejong.github.io/whosthis/`) and install it with Safari's Share → Add to Home Screen.

Note: the service worker is cache-first. After changing a shipped file, bump `CACHE_VERSION` in `sw.js`; otherwise the browser keeps serving the old cached copy. Even after a bump, the first load runs the old code while the new version installs; reload once more to get it. New files under `src/`, `vendor/` or `icons/` must also be added to `PRECACHE` in `sw.js`.

# Test

```bash
node --test tests/*.test.js
```

On Node 24, `node --test tests/` fails on the directory argument, and plain `node --test` also picks up the browser-only `src/ui/test.js`. The tests cover the pure modules only (`matcher.js`, `patient-logic.js`, `caregiver-logic.js`, `speech.js`).

# Deploy

The site is served by GitHub Pages straight from the `main` branch, root folder. There is no build step: the files in the repo are the files the phone gets, so `index.html`, `app.js`, `src/`, `vendor/` and `sw.js` must be committed as they are.

To release:

1. Bump `CACHE_VERSION` in `sw.js` (for example `v11` to `v12`). Do this on every release, whenever any shipped file changes. Without it, phones keep serving the old cached copy.
2. Commit and push to `main`. GitHub Pages republishes the site after the push (check the Actions or Pages status if it takes a while).
3. Open `https://aldodejong.github.io/whosthis/` on the iPhone and check the change. Close the Home Screen app fully and reopen it if it still looks old.

Never commit family photos or other test images. They belong in `testdata/`, which is gitignored.
