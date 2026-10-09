# Run locally

From the project root:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000. Routes are hash-based: `#/patient` (default), `#/caregiver`, `#/test`.

`localhost` counts as a secure context, so the service worker and the camera work on the desktop.

**The iPhone needs HTTPS.** Camera access and the service worker do not work over plain `http://` on a phone. To test on an iPhone, use the GitHub Pages URL (`https://aldodejong.github.io/whosthis/`) and install it with Safari's Share → Add to Home Screen.

Note: the service worker is cache-first. After changing a shipped file, bump `CACHE_VERSION` in `sw.js`, or reload with the old copy still cached.

# Deploy

The site is served by GitHub Pages straight from the `main` branch, root folder. There is no build step: the files in the repo are the files the phone gets, so `index.html`, `app.js`, `src/`, `vendor/` and `sw.js` must be committed as they are.

To release:

1. Bump `CACHE_VERSION` in `sw.js` (for example `v9` to `v10`). Do this on every release, whenever any shipped file changes. Without it, phones keep serving the old cached copy.
2. Commit and push to `main`. GitHub Pages republishes the site after the push (check the Actions or Pages status if it takes a while).
3. Open `https://aldodejong.github.io/whosthis/` on the iPhone and check the change. Close the Home Screen app fully and reopen it if it still looks old.

Never commit family photos or other test images. They belong in `testdata/`, which is gitignored.
