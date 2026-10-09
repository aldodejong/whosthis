# Who's This? — Spec (proof of concept)

A web app for iPhone that helps a person with Alzheimer's recognise up to 5 family members and friends. The person points the phone at someone. If the app is confident who it is, it shows **"This is Jane — your daughter"** with a familiar photo of Jane, and can say it aloud.

## Goals

- Recognise up to **5 enrolled people** from the iPhone's rear camera.
- **When in doubt, show nothing.** Naming the wrong person is worse than naming nobody.
- **All processing on the phone.** No photos, face data, analytics or other data leave the device.
- Free to run and share: hosted on GitHub Pages, installed with Safari's "Add to Home Screen".
- English only. Uses the built-in iOS voice.

## Non-goals (for now)

- App Store / native app (possible later; the matching logic and threshold should carry over).
- Cloud sync, multiple caregivers, more than 5 people, languages other than English.
- Recognising people in group shots. Only the largest face in view counts.

## Platform

- iPhone with iOS 17 or later, Safari or a Home Screen web app.
- Plain HTML, CSS and JavaScript with ES modules. **No build step and no npm runtime dependencies.**
- The face library and its model files are copied into `vendor/` (version pinned), so the app works offline once loaded.
- Camera access needs HTTPS. GitHub Pages provides it, and `localhost` counts as secure for desktop testing.
- Hosting: public repo `aldodejong/whosthis` → `https://aldodejong.github.io/whosthis/`.

## Users and modes

### Patient mode (default)

1. On first open each session, a large **"Tap to start"** button appears. The tap unlocks the camera and sound (iOS requires a tap first).
2. A full-screen live view from the rear camera, so the person can aim.
3. When a person is confirmed, a card appears covering the bottom ~45% of the screen:
   - their display photo (large, rounded),
   - **"This is Jane"** at 48pt or larger, bold, high contrast,
   - **"your daughter"** at 32pt or larger.
4. If speech is on, the app says *"This is Jane, your daughter."* (rate about 0.85).
5. The card stays up while the person is in view and fades 2 seconds after they leave.
6. Nothing is shown for no face. No error messages, ever: nothing technical is ever shown to the patient. **Exception (user-requested after desktop testing, because a blank screen was confusing):** when a face has been continuously in view (usable, or too small/turned) for about 1.5 s without a confirmed person, a calm, small, large-type line appears at the top of the screen, away from the card: *"Not sure who this is"*, or *"Please come a little closer"* when the face is too small. It hides as soon as a person is confirmed or the face has been gone for ~0.4 s (a single dropped detection doesn't make it blink), with the same 300 ms fade (none under Reduce Motion). Contrast ≥ 7:1. It never changes matching: unknown and low-confidence faces are still never named.
7. There are no visible buttons. Opening caregiver mode takes a **3-second long-press in the top-left corner**, then the PIN.
8. The screen stays awake (Wake Lock API) while in patient mode.

### Caregiver mode (behind a PIN)

- On first run, the caregiver sets a 4–6 digit PIN. Only its SHA-256 hash is stored, and it serves as a child-lock rather than real security.
- **People list** (maximum 5): add, edit or delete. Each person has:
  - name, e.g. "Jane",
  - relationship, e.g. "your daughter" (free text, shown and spoken as written),
  - display photo, the one shown to the patient,
  - **3–10 enrolment photos**, taken with the camera or picked from the photo library.
- Enrolment checks each photo. A photo with no face, more than one face, or a face that's too small or blurry is rejected with a plain-English reason.
- **Settings:** speech on/off, PIN change, and an advanced match-strictness slider (default from the tuning in step 4).
- **Test mode:** the live camera plus a debug panel showing each enrolled person's score and the current decision. Used for tuning.
- A **Help** page with instructions for setting up Guided Access (Settings → Accessibility → Guided Access) to lock the phone to the app.

## Recognition pipeline

1. Rear camera stream at about 10 frames per second for analysis. The preview runs at full frame rate.
2. **Detect** faces and keep only the largest. Skip it if it is smaller than ~15% of frame width, or if the library reports it at an angle beyond the limit.
3. **Align** the face with landmarks and **embed** it as a face fingerprint (a list of numbers from the library's recognition model).
4. **Match** (pure function in `src/matcher.js`):
   - score for each person = cosine similarity, averaged over that person's 3 best-matching enrolment fingerprints;
   - accept the best candidate only if `best ≥ ACCEPT` **and** `best − secondBest ≥ MARGIN`;
   - **confirm** a person only once the same candidate is accepted in `N` consecutive analysed frames (start with N = 5, about 0.5 s);
   - a different confirmed person replaces the current one immediately, while dropping to "nobody" needs 2 s without a match.
   - Initial `ACCEPT`, `MARGIN` and `N` are placeholders, set in step 4 from real photos. Bias towards false negatives.
5. **Speak** when a person is newly confirmed, at most once per person every **45 s**.

## Storage (IndexedDB, on the device only)

- `people`: `{ id, name, relationship, displayPhoto: Blob, enrolPhotos: Blob[], embeddings: Float32Array[], embeddingModel: string, createdAt }`
  - `embeddingModel` records which library/model version produced the fingerprints, so they can be rebuilt from `enrolPhotos` if the library changes.
- `settings`: `{ pinHash, speechOn, accept, margin, confirmFrames }`
- Ask for persistent storage (`navigator.storage.persist()`). The Help page notes that deleting Safari website data deletes the people.

## Privacy

- No network requests after load except the service worker updating app files from the same site.
- No analytics, no third-party scripts at runtime, no CDN (everything vendored).
- Family photos never go into the git repo.

## Accessibility

- Patient card colours have contrast of at least 7:1. Respect the system dark mode, but default to light.
- Large touch targets (at least 60pt) on the start button and caregiver controls.
- No motion beyond a 300 ms fade, and none if the system's Reduce Motion setting is on.

## File layout

```
index.html              entry, loads app.js
app.js                  routes between patient / caregiver / test views
styles.css
manifest.webmanifest    Home Screen app manifest
sw.js                   service worker: caches the app files + vendor/ for offline use
icons/                  app icons incl. apple-touch-icon
src/camera.js           getUserMedia, frame loop
src/face.js             wraps the face library: detect(), embed()  ← only file that knows the library
src/matcher.js          pure matching + confirmation state machine (no DOM)
src/store.js            IndexedDB access
src/speech.js           speechSynthesis wrapper, cooldown, on/off switch
src/ui/patient.js
src/ui/caregiver.js
src/ui/test.js
vendor/                 pinned face library + model files
tests/*.test.js         node --test, pure modules only
docs/install.md         guide for friends: open link → Add to Home Screen → Guided Access
```

## Build phases and models

The coordinating session runs on Opus and hands each phase to a helper agent on the model below. Each helper reads `CLAUDE.md` + this file, not the chat history.

| # | Phase | Model | Done when |
|---|-------|-------|-----------|
| 0 | Spec + CLAUDE.md | Opus | this file exists ✅ |
| 1 | Skeleton: index.html, app.js routing, styles, manifest, sw.js, icons, local server notes | Haiku | page loads on localhost, installs to the Home Screen ✅ (files + syntax checked; live serve not yet tested). Notes: SW is cache-first, so bump `CACHE_VERSION` in sw.js and add new src/vendor files to its precache list; icons are plain solid colour; no `.gitignore` yet (add `testdata/` before phase 4) |
| 2 | Choose and vendor the face library; implement `src/face.js` | Opus | detect + embed run in Safari on an iPhone, model size and speed noted in this file. Notes: chose `@vladmandic/human` 3.3.6 (MIT; bundles TF.js 4.22.0) over face-api because it is maintained, reports head yaw/pitch/roll (needed for the angle limit), rotation-corrects the crop before the fingerprint, and is smaller (face-api with its SSD detector is ~13.8 MB). Pipeline BlazeFace + FaceMesh + FaceRes (1024-number fingerprint, compare with cosine). Vendor total 12.0 MB (11.3 MB lib+models, 0.7 MB wasm fallback), see `vendor/README.md`. Backend order humangl → webgl → wasm → cpu; all result caching/frame-skipping off. `embed()` also returns the `face` from detect, so the loop needs one call per frame. Verified on desktop only: syntax, and in Node (wasm backend, no WebGL) detect + embed on sample photos: same face flipped ≈ 0.88–0.94 cosine vs 0.30–0.51 for other faces, blank frame → null, only same-site vendor files fetched. NOT verified: WebGL/Safari/iPhone. User to measure on the iPhone: `init()` time (first and cached load) and which backend it picked, and per-frame `detect()` and `embed()` ms with a face in view |
| 3 | Camera + detection loop (`src/camera.js`) | Sonnet | live preview, largest-face box in test view ✅ (verified on desktop webcam; rear camera/iPhone not yet tested). `camera.js` is `createCamera({video,onFrame,onError,fps})`; test view uses MAX_ANGLE_DEG=30 and MIN_FACE_FRACTION=0.15 constants for now. Fix-up (scores, NOT yet verified in a browser): test view now uses `face.embed()` and the patient pipeline (same gate, `buildCandidates`, `decide`, tracker) and shows every enrolled person's score (mean of 3 best, 2 decimals; old-model people listed as not comparable), best marked `*`, accepted `>>`, the decision or the reason for no match (pure `explainDecision` in `src/patient-logic.js`: no face / nobody enrolled / model mismatch / gated / best < accept / tie / margin too small), tracker confirmed + streak, and live accept/margin/confirmFrames from settings. Box: amber gated, green usable, teal + name/score label when accepted; the best candidate's score is drawn in brackets otherwise. Gate constants now live only in `patient-logic.js` (`gateReason`) |
| 4 | Matcher + unit tests; tune ACCEPT/MARGIN/N | Opus | `node --test` passes; defaults written into this file ✅ (42/42 in `tests/matcher.test.js`; run as `node --test tests/*.test.js`: on Node 24 `node --test tests/` errors on the directory argument, and plain `node --test` also picks up the browser file `src/ui/test.js`, which fails in Node). **Defaults: `ACCEPT = 0.65`, `MARGIN = 0.10`, `N (confirmFrames) = 5`**, drop after 2000 ms, score = mean of 3 best enrolment cosines (`DEFAULTS` in `src/matcher.js`; every function takes explicit params so `settings` can override). Decisions: one enrolled person → no rival, so only ACCEPT applies; a tie for first is always null; unusable vectors (wrong length, zero, NaN) are skipped, and a person with none left can't be named; a non-finite timestamp resets the tracker to nobody; the confirmed person's 2 s window restarts only on frames that name them, so a flickering other candidate doesn't keep them on screen. **Evidence (thin, NOT family photos):** `src/face.js` was run in Node (wasm backend) on the sample images shipped in the human/face-api npm packages (scratchpad only, nothing committed): 102 real face crops, 57 identities, but only ONE person with many genuinely different photos (the library author, 21 photos, mostly ~45–60 px thumbnails upscaled), plus 5 visually checked same-person pairs. 20 "impostor" pairs at 0.81–0.92 were copies of the same photo and were merged out. Single photo vs photo: same person (M, 210 pairs) p05 0.50 / median 0.66 / max 0.90; different people (4,913 pairs) median 0.39 / p99 0.62 / max 0.74; large-face impostors max 0.63; impostors vs M max 0.61. Simulated matcher (real `scorePeople`/`decide`, 1–5 enrolled, M enrolled with 3/5/7 photos, 400 trials): at 0.65/0.10, per frame: genuine right 72%, null 28%, wrong name 0%; unenrolled face named 0.97% (all from low-res thumbnails scoring 0.65–0.74, some possibly the same person, unverified). At 0.60: 89% right, but 3.6% impostor frames named; at 0.70: 53% right, 0.05%. MARGIN 0.10 cost < 1% of genuine frames (genuine lead over the best rival p05 0.145; impostor best-vs-second median 0.05). N = 5 only stops brief flicker: a steady look-alike scores steadily, so ACCEPT has to carry the safety margin. **Caveats:** relatives look alike (expect higher impostor scores inside a family, hence MARGIN); live iPhone frames at ≥15% frame width should score higher than these thumbnails for genuine matches, so ACCEPT may be too strict. Never measured: iPhone camera, real family members, lighting, glasses, age gaps between enrolment photos. **Must be re-tuned with real enrolment photos in Test mode (phase 5/6 era):** for each enrolled person, check their own score when in view and every other person's score, then set ACCEPT just above the highest score any wrong person or stranger reaches. Only raise ACCEPT or MARGIN to fix wrong names; never lower them below these defaults without that data |
| 5 | Caregiver mode: PIN, people CRUD, enrolment with photo checks, store.js | Sonnet | 5 people enrolled, data survives a reload ✅ Notes: not yet verified in a browser. Photo checks live in `src/caregiver-logic.js` (face >= 15% width, score >= 0.7, Laplacian variance >= 30 on 256px; starting values to tune). Strictness slider is 0.60-0.80 (clamped again in store.js). Photos are stored as <=1024px JPEG. Stale fingerprints (model changed) are re-computed when the person is opened with Edit and saved. 5 wrong PINs lock entry for 30 s (in memory). |
| 6 | Patient mode UI | Sonnet | card appears and fades as specified ✅ (desktop-tested with 3 people; a child needed extra varied photos before matching — children are a weak spot, no score readout in test view yet)Notes (phase 6, NOT yet verified in a browser/iPhone): `src/ui/patient.js` + pure `src/patient-logic.js` (angle/size gate, candidate list, card text; tests in `tests/patient-logic.test.js`). Exports `setStartHandler(fn)` (called synchronously in the Tap-to-start click, for speech unlock) and `setConfirmHandler(fn(person))` (called on a new confirmation) for phase 7. Wake Lock requested on start and re-acquired on visibilitychange, failing silently. Any failure (init, camera, permission) silently returns to the Tap to start button. Long-press tolerates 12 px of movement. People/settings are loaded once per tap (changes in caregiver mode apply on the next start). Gate constants MAX_ANGLE_DEG/MIN_FACE_FRACTION are duplicated in patient-logic.js and ui/test.js. Card fade is 300 ms CSS opacity; the 2 s drop is the tracker's. sw.js CACHE_VERSION v6. Fix-up (user decision, NOT yet verified in a browser): "Not sure who this is" / "Please come a little closer" hint, see Patient mode item 6; timing in pure `nextHint` (`HINT_DELAY_MS` 1500, `HINT_GAP_MS` 400) with tests; element `.pt-hint` (top, #111418 on #fff, z-index under the long-press corner, pointer-events none). Matching and thresholds unchanged. sw.js CACHE_VERSION v8. |
| 7 | Speech + on/off switch + cooldown + tap-to-start | Haiku | speaks once per 45 s per person ✅ (desktop-verified; iPhone silent-switch/volume behaviour untested). Notes (phase 7, NOT yet verified in a browser/iPhone): `src/speech.js` (`unlock`, `speakPerson`, `setEnabled`/`isEnabled`, pure `shouldSpeak` with a 45 000 ms per-person cooldown recorded only after speak; rate 0.85, en-US voice if found). Wired in `src/ui/patient.js` via the phase 6 hooks: unlock in the Tap-to-start click, speak on new confirmation, `speechOn` read in `loadData` when patient mode starts (default on). Tests in `tests/speech.test.js`, run as `node --test tests/*.test.js`. sw.js CACHE_VERSION v7. Caveats not handled: iPhone silent switch/volume, and the cooldown map lives in memory, so it resets on page reload. Fix-up (no speech heard on desktop; NOT verified in a browser): the confirm hook was reached (card shown ⇒ handler called, speech on by default), so the likely cause is in `speakPerson`: it called `speechSynthesis.cancel()` and then `speak()` in the same tick on every call, a pattern Chrome and Safari are known to drop silently; it also kept no reference to the utterance (Chrome GC bug) and picked the first en-US voice, which in Chrome can be a network or novelty voice. Moderate confidence only; a stale service-worker cache (cache-first, so the first load after an update still runs the old code) could also explain it. Now: cancel only if speaking/pending and then speak after 120 ms, resume() if paused, module-level utterance reference, voice = default English → local en-US → en-US (never waits for voices), lang en-US, a hard error clears that person's cooldown, and a `[whosthis speech]` console.debug trail (skipped/queued/started/ended/error, no personal data beyond the sentence). Fake-engine tests in `tests/speech-engine.test.js`. sw.js CACHE_VERSION v8 |
| 8 | GitHub Pages deploy + docs/install.md | Haiku | public URL works on an iPhone |
| 9 | Full code review | Opus | findings fixed or noted |

Real-device testing (camera, faces, speech) is done by the user on an iPhone. Claude checks layout and logic in a desktop browser.

## Open decisions

- Which face library to use (phase 2). Candidates: `@vladmandic/human` (detection + face fingerprints, maintained, WebGL/WASM), `@vladmandic/face-api` (simpler, older models). Choose for Safari compatibility, download size and accuracy.
