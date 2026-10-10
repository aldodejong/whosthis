# whosthis

iPhone web app (installed to the Home Screen) that recognises up to 5 enrolled people with the camera and shows/speaks "This is Jane — your daughter" for a person with Alzheimer's. **Read `SPEC.md` before doing anything.** It is the source of truth and lists the build phases.

## Rules

- Plain HTML/CSS/JS with ES modules. No build step, no bundler, no npm runtime dependencies. Third-party code lives pinned in `vendor/`.
- No network calls at runtime besides same-site app files. No CDNs, no analytics.
- Never commit photos of real people. Test images go in `testdata/` (gitignored).
- `src/face.js` is the only file that imports the face library. `src/matcher.js` stays pure (no DOM, no library) so it can be tested with `node --test`.
- When in doubt, show nothing: any change to matching must not make wrong names more likely.
- Only do the phase you were given. Update its row in SPEC.md when done and note any decisions made.

## Run

```bash
python3 -m http.server 8000
```

Open http://localhost:8000 (camera works on localhost). The iPhone needs HTTPS, so test on a phone through the GitHub Pages URL.

## Test

```bash
node --test tests/*.test.js
```
