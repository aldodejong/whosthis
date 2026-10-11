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
7. The only controls are the start button and a small **settings icon (gear with "3s") in the top-left corner** (user-requested, replacing the invisible hot-spot). Opening caregiver mode takes a **3-second press-and-hold on it**, then the PIN.
8. The screen stays awake (Wake Lock API) while in patient mode.

### Caregiver mode (behind a PIN)

- On first run, the caregiver sets a 4–6 digit PIN. Only its SHA-256 hash is stored, and it serves as a child-lock rather than real security.
- **People list** (maximum 5): add, edit or delete. Each person has:
  - name, e.g. "Jane",
  - relationship, e.g. "your daughter" (free text, shown and spoken as written),
  - display photo, the one shown to the patient,
  - **3–10 enrolment photos**, taken with the camera or picked from the photo library.
- Enrolment checks each photo. A photo with no face, more than one face, or a face that's too small or blurry is rejected with a plain-English reason.
- **Settings:** speech on/off, PIN change, and an advanced match-strictness slider (ACCEPT 0.55–0.80, recommended default 0.60 (was 0.65 from the tuning in step 4; owner decision 2026-10-11, see below), with the current value, a plain-English "lower = recognises more easily but may name the wrong person" line and a "Reset to recommended" button). MARGIN and N have no UI and can only be stricter than their defaults.

### Strictness floor: owner decision (2026-10-11)

The project owner decided, overriding the earlier rule that settings can only be stricter than the defaults **for ACCEPT only**: in real iPhone use 0.65 was too hard to meet, so the caregiver slider (and stored settings and restored backups) may go down to **ACCEPT = 0.55**. Range 0.55–0.80, step 0.01; anything outside is clamped, garbage falls back to the default. MARGIN 0.10 and N 5 are unchanged, and **MARGIN (≥ 0.10) and N (≥ 5) stay stricter-only**, including via backup restore. Risk: in the phase 4 measurement (non-family sample photos) ACCEPT 0.60 already named about **3.6% of unenrolled (impostor) frames** (0.97% at 0.65); 0.55 will be worse. So any value below 0.65 (now including the 0.60 default, see below) must be chosen with real family photos in Test mode (set it above the highest score any wrong person or stranger reaches). The MARGIN rule is independent of ACCEPT, so two enrolled people with close scores still give no name at any ACCEPT; what a lower ACCEPT loosens is mainly *strangers* (and a single enrolled person, where only ACCEPT applies) being named. Nothing of this is verified on the iPhone.

**Second owner decision (2026-10-11): default ACCEPT = 0.60 (was 0.65).** Reason: in real iPhone use 0.65 was too hard to meet, so the recommended starting value is lowered. `DEFAULTS.accept` in `src/matcher.js` is 0.60; it is used by fresh installs, by every fallback for a missing/invalid stored or restored value, by the "Reset to recommended (0.60)" button, and as the line for the "Looser than recommended" warning (shown below 0.60). Anyone who already has an accept value saved (including 0.65) keeps it. Slider range stays 0.55-0.80; MARGIN 0.10 and N 5 unchanged and stricter-only; no matching logic changed. Evidence to weigh: on the phase 4 non-family data, 0.60 named about **3.6% of unenrolled (impostor) frames vs 0.97% at 0.65** (genuine right 89% vs 72%). So 0.60 is a starting point only: Test-mode tuning with real family photos (and a stranger's face) is required, and ACCEPT should be raised if any wrong person or stranger reaches 0.60. sw.js CACHE_VERSION v18. Not verified in a browser or on the iPhone.
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
icons/                  app icons incl. apple-touch-icon; icon.svg is the source (teal #1f6f78, white rounded-stroke smiling headshot + question mark) and is also shown beside the heading on the caregiver PIN and People screens
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
| 2 | Choose and vendor the face library; implement `src/face.js` | Opus | detect + embed run in Safari on an iPhone, model size and speed noted in this file. ⏳ NOT ticked: the iPhone timings are still owed (see "Open items" at the end). Notes: chose `@vladmandic/human` 3.3.6 (MIT; bundles TF.js 4.22.0) over face-api because it is maintained, reports head yaw/pitch/roll (needed for the angle limit), rotation-corrects the crop before the fingerprint, and is smaller (face-api with its SSD detector is ~13.8 MB). Pipeline BlazeFace + FaceMesh + FaceRes (1024-number fingerprint, compare with cosine). Vendor total 12.0 MB (11.3 MB lib+models, 0.7 MB wasm fallback), see `vendor/README.md`. Backend order humangl → webgl → wasm → cpu; all result caching/frame-skipping off. `embed()` also returns the `face` from detect, so the loop needs one call per frame. Verified on desktop only: syntax, and in Node (wasm backend, no WebGL) detect + embed on sample photos: same face flipped ≈ 0.88–0.94 cosine vs 0.30–0.51 for other faces, blank frame → null, only same-site vendor files fetched. NOT verified: WebGL/Safari/iPhone. User to measure on the iPhone: `init()` time (first and cached load) and which backend it picked, and per-frame `detect()` and `embed()` ms with a face in view |
| 3 | Camera + detection loop (`src/camera.js`) | Sonnet | live preview, largest-face box in test view ✅ (verified on desktop webcam; rear camera/iPhone not yet tested). `camera.js` is `createCamera({video,onFrame,onError,fps})`; test view uses MAX_ANGLE_DEG=30 and MIN_FACE_FRACTION=0.15 constants for now. Fix-up (scores, NOT yet verified in a browser): test view now uses `face.embed()` and the patient pipeline (same gate, `buildCandidates`, `decide`, tracker) and shows every enrolled person's score (mean of 3 best, 2 decimals; old-model people listed as not comparable), best marked `*`, accepted `>>`, the decision or the reason for no match (pure `explainDecision` in `src/patient-logic.js`: no face / nobody enrolled / model mismatch / gated / best < accept / tie / margin too small), tracker confirmed + streak, and live accept/margin/confirmFrames from settings. Box: amber gated, green usable, teal + name/score label when accepted; the best candidate's score is drawn in brackets otherwise. Gate constants now live only in `patient-logic.js` (`gateReason`) |
| 4 | Matcher + unit tests; tune ACCEPT/MARGIN/N | Opus | `node --test` passes; defaults written into this file ✅ (42/42 in `tests/matcher.test.js`; run as `node --test tests/*.test.js`: on Node 24 `node --test tests/` errors on the directory argument, and plain `node --test` also picks up the browser file `src/ui/test.js`, which fails in Node). **Defaults: `ACCEPT = 0.60` (was 0.65 until 2026-10-11, lowered by owner decision because 0.65 was too hard to meet on the iPhone; on this non-family data 0.60 names ~3.6% of impostor frames vs 0.97% at 0.65, so Test-mode tuning with real family photos is required), `MARGIN = 0.10`, `N (confirmFrames) = 5`**, drop after 2000 ms, score = mean of 3 best enrolment cosines (`DEFAULTS` in `src/matcher.js`; every function takes explicit params so `settings` can override). Decisions: one enrolled person → no rival, so only ACCEPT applies; a tie for first is always null; unusable vectors (wrong length, zero, NaN) are skipped, and a person with none left can't be named; a non-finite timestamp resets the tracker to nobody; the confirmed person's 2 s window restarts only on frames that name them, so a flickering other candidate doesn't keep them on screen. **Evidence (thin, NOT family photos):** `src/face.js` was run in Node (wasm backend) on the sample images shipped in the human/face-api npm packages (scratchpad only, nothing committed): 102 real face crops, 57 identities, but only ONE person with many genuinely different photos (the library author, 21 photos, mostly ~45–60 px thumbnails upscaled), plus 5 visually checked same-person pairs. 20 "impostor" pairs at 0.81–0.92 were copies of the same photo and were merged out. Single photo vs photo: same person (M, 210 pairs) p05 0.50 / median 0.66 / max 0.90; different people (4,913 pairs) median 0.39 / p99 0.62 / max 0.74; large-face impostors max 0.63; impostors vs M max 0.61. Simulated matcher (real `scorePeople`/`decide`, 1–5 enrolled, M enrolled with 3/5/7 photos, 400 trials): at 0.65/0.10, per frame: genuine right 72%, null 28%, wrong name 0%; unenrolled face named 0.97% (all from low-res thumbnails scoring 0.65–0.74, some possibly the same person, unverified). At 0.60: 89% right, but 3.6% impostor frames named; at 0.70: 53% right, 0.05%. MARGIN 0.10 cost < 1% of genuine frames (genuine lead over the best rival p05 0.145; impostor best-vs-second median 0.05). N = 5 only stops brief flicker: a steady look-alike scores steadily, so ACCEPT has to carry the safety margin. **Caveats:** relatives look alike (expect higher impostor scores inside a family, hence MARGIN); live iPhone frames at ≥15% frame width should score higher than these thumbnails for genuine matches, so ACCEPT may be too strict. Never measured: iPhone camera, real family members, lighting, glasses, age gaps between enrolment photos. **Must be re-tuned with real enrolment photos in Test mode (phase 5/6 era):** for each enrolled person, check their own score when in view and every other person's score, then set ACCEPT just above the highest score any wrong person or stranger reaches. Only raise ACCEPT or MARGIN to fix wrong names; never lower MARGIN or N below these defaults. (Updated 2026-10-11, owner decision: ACCEPT may be lowered to 0.55 by the caregiver, but only on the basis of that Test-mode data; see "Strictness floor: owner decision".) |
| 5 | Caregiver mode: PIN, people CRUD, enrolment with photo checks, store.js | Sonnet | 5 people enrolled, data survives a reload ✅ Notes: not yet verified in a browser. Photo checks live in `src/caregiver-logic.js` (face >= 15% width, score >= 0.7, Laplacian variance >= 30 on 256px; starting values to tune). Strictness slider is 0.60-0.80 (clamped again in store.js); 0.55-0.80 since 2026-10-11 (owner decision, `ACCEPT_MIN` in `src/caregiver-logic.js`). Photos are stored as <=1024px JPEG. Stale fingerprints (model changed) are re-computed when the person is opened with Edit and saved. 5 wrong PINs lock entry for 30 s (in memory). |
| 6 | Patient mode UI | Sonnet | card appears and fades as specified ✅ (desktop-tested with 3 people; a child needed extra varied photos before matching — children are a weak spot, no score readout in test view yet)Notes (phase 6, NOT yet verified in a browser/iPhone): `src/ui/patient.js` + pure `src/patient-logic.js` (angle/size gate, candidate list, card text; tests in `tests/patient-logic.test.js`). Exports `setStartHandler(fn)` (called synchronously in the Tap-to-start click, for speech unlock) and `setConfirmHandler(fn(person))` (called on a new confirmation) for phase 7. Wake Lock requested on start and re-acquired on visibilitychange, failing silently. Any failure (init, camera, permission) silently returns to the Tap to start button. Long-press tolerates 12 px of movement. People/settings are loaded once per tap (changes in caregiver mode apply on the next start). Gate constants MAX_ANGLE_DEG/MIN_FACE_FRACTION are duplicated in patient-logic.js and ui/test.js. Card fade is 300 ms CSS opacity; the 2 s drop is the tracker's. sw.js CACHE_VERSION v6. Fix-up (user decision, NOT yet verified in a browser): "Not sure who this is" / "Please come a little closer" hint, see Patient mode item 6; timing in pure `nextHint` (`HINT_DELAY_MS` 1500, `HINT_GAP_MS` 400) with tests; element `.pt-hint` (top, #111418 on #fff, z-index under the long-press corner, pointer-events none). Matching and thresholds unchanged. sw.js CACHE_VERSION v8. |
| 7 | Speech + on/off switch + cooldown + tap-to-start | Haiku | speaks once per 45 s per person ✅ (desktop-verified; iPhone silent-switch/volume behaviour untested). Notes (phase 7, NOT yet verified in a browser/iPhone): `src/speech.js` (`unlock`, `speakPerson`, `setEnabled`/`isEnabled`, pure `shouldSpeak` with a 45 000 ms per-person cooldown recorded only after speak; rate 0.85, en-US voice if found). Wired in `src/ui/patient.js` via the phase 6 hooks: unlock in the Tap-to-start click, speak on new confirmation, `speechOn` read in `loadData` when patient mode starts (default on). Tests in `tests/speech.test.js`, run as `node --test tests/*.test.js`. sw.js CACHE_VERSION v7. Caveats not handled: iPhone silent switch/volume, and the cooldown map lives in memory, so it resets on page reload. Fix-up (no speech heard on desktop; NOT verified in a browser): the confirm hook was reached (card shown ⇒ handler called, speech on by default), so the likely cause is in `speakPerson`: it called `speechSynthesis.cancel()` and then `speak()` in the same tick on every call, a pattern Chrome and Safari are known to drop silently; it also kept no reference to the utterance (Chrome GC bug) and picked the first en-US voice, which in Chrome can be a network or novelty voice. Moderate confidence only; a stale service-worker cache (cache-first, so the first load after an update still runs the old code) could also explain it. Now: cancel only if speaking/pending and then speak after 120 ms, resume() if paused, module-level utterance reference, voice = default English → local en-US → en-US (never waits for voices), lang en-US, a hard error clears that person's cooldown, and a `[whosthis speech]` console.debug trail (skipped/queued/started/ended/error, no personal data beyond the sentence). Fake-engine tests in `tests/speech-engine.test.js`. sw.js CACHE_VERSION v8 |
| 8 | GitHub Pages deploy + docs/install.md | Haiku | public URL works on an iPhone ✅ (live at https://aldodejong.github.io/whosthis/ ; opens and caregiver entry works on iPhone; install.md written; iPhone timings/offline not yet reported) |
| 9 | Full code review | Opus | findings fixed or noted ✅ Notes (phase 9, NOT verified in a browser/iPhone): 9 low-risk fixes (stale card after lock, frozen-camera frames, <3 fingerprints, settings floors, PIN-lockout reset, test-view exit, SW precache bypassing HTTP cache, two leaks/races), 86/86 tests; no threshold/default changed; see "Review findings" below. sw.js CACHE_VERSION v11; later v15 (backup/restore, early persistence, install nudge, new app icon in icons/ and in caregiver mode; icon PNGs were rendered with a throwaway Node script, nothing is verified on the iPhone); v12 had the solid-cog settings icon (see Patient mode item 7); v13: cog teeth narrowed so tooth and gap are about equal (user feedback after seeing it on the iPhone); v14: persistence at startup, backup/restore and install-first nudge (see Open items, "Data loss report"; not verified in a browser); v16 (2026-10-11): ACCEPT floor lowered to 0.55 by owner decision (see "Strictness floor: owner decision"): `ACCEPT_MIN` 0.55, `clampAccept` now treats null/''/booleans as garbage (→ 0.65 default, previously `null` became the floor), backup restore uses the same clamp (no longer floored at 0.65), settings screen shows the current value vs recommended 0.65 with a warning when looser and a "Reset to recommended" button, Help explains choosing a value with Test mode; 102/102 tests; not verified in a browser or on the iPhone; v18 (2026-10-11): default ACCEPT 0.65 -> 0.60 by owner decision (see "Strictness floor: owner decision"), saved values kept, 110/110 tests, not verified on the iPhone |

Real-device testing (camera, faces, speech) is done by the user on an iPhone. Claude checks layout and logic in a desktop browser.

## Open decisions

- Which face library to use (phase 2). Candidates: `@vladmandic/human` (detection + face fingerprints, maintained, WebGL/WASM), `@vladmandic/face-api` (simpler, older models). Choose for Safari compatibility, download size and accuracy.

## Review findings (phase 9)

Code review of all first-party files; `node --check` on every JS file and `node --test tests/*.test.js` (86/86) pass. Nothing was run in a browser or on the iPhone. Thresholds, defaults and user-approved behaviour (gear "3s" entry, "Not sure who this is" hint) are unchanged.

### Fixed

1. **Old card after the phone is locked** (`src/ui/patient.js:160`). The card stayed up while the page was hidden, and the tracker only drops someone when a new frame arrives. If the camera came back slowly or frozen, the old name could still be on screen when the phone was pointed at someone else. Now hiding the page resets the tracker and hides the card and hint. The camera keeps running and the speech cooldown is unchanged. Results that arrive while hidden or after a stop are dropped (`patient.js:179`).
2. **Frozen camera frames analysed as live** (`src/camera.js:68-76, 109`). While the video track is muted or ended, `<video>` can keep showing its last picture, which would keep naming (or re-confirming) whoever was in it. Now those ticks call `onFrame(null)`, and both views treat that as no face. If the track ends by itself, the camera stops and reports it. The patient view then goes back to Tap to start silently (`patient.js:199`), and the test view shows "The camera stopped.".
3. **A person with fewer than 3 usable fingerprints could be named** (`src/patient-logic.js:11, 42-50`). Damaged records (NaN or zero vectors, or vectors of mixed lengths) could leave a single fingerprint carrying the score. `buildCandidates` now drops unusable vectors and requires ≥ 3 of the same length (`MIN_FINGERPRINTS`). The caregiver form already enforces 3, so normal records are unaffected. Tests added. The test view explains the exclusion.
4. **`margin` and `confirmFrames` from storage were not clamped** (`src/caregiver-logic.js:30-39`, `src/store.js:108-119`). Only `accept` was. They can now only be stricter than the defaults: margin in [0.10, 1], confirmFrames in [5, 50]. There is no UI for them. Tests added. (Still true after the 2026-10-11 decision, which only lowered the ACCEPT floor to 0.55.)
5. **Wrong-PIN lockout reset by leaving the view** (`src/ui/caregiver.js:38`). The counter lived inside `mount()`, so going back to the patient view and holding the gear again gave 5 fresh tries. It now lives at module level and is still memory-only.
6. **No way out of Test mode in the Home Screen app** (`src/ui/test.js:42`). The standalone app has no back button, so the test view was a dead end. It now has a Back button (top right) that returns to the caregiver area, which asks for the PIN again.
7. **New releases could precache stale files** (`sw.js:44-46`). `cache.addAll` went through the HTTP cache (GitHub Pages max-age 600 s), so a new `CACHE_VERSION` could store a mix of old and new files. Precache now uses `cache: 'reload'`. CACHE_VERSION bumped to v11.
8. Object-URL leak when leaving the caregiver area while the people list was loading (`caregiver.js:158`).
9. Docs: `docs/dev.md` now has the working test command, the "first load after an update runs the old code" note and the PRECACHE reminder. `docs/install.md` troubleshooting now covers "Tap to start comes back".

### Noted, not fixed (needs a decision or real data)

- **A stranger can see the previous name for up to 2 s** (`src/matcher.js` tracker, by design per spec). If Jane walks away and someone else steps straight in, the card still says Jane until the 2 s drop, because only frames that name Jane restart the window; a usable face that scores below accept does not end it early. Possible follow-up: drop sooner (e.g. after ~0.5 s) when a usable face is in view that does not match the confirmed person. That changes approved timing, so it is the user's call.
- **Enrolment photos are not checked against each other** (`caregiver.js:274`, `checkPhoto`). A photo of the wrong person added to Jane makes that person match as Jane. The display photo is not checked either. Possible follow-up: reject an enrolment photo whose mean cosine to the person's other photos is low, and warn when a photo matches another enrolled person better.
- **Enrolment does not apply the angle gate** (`caregiver-logic.js:60`). Strongly turned photos are accepted, while live frames beyond 30° are skipped. Suggest rejecting enrolment photos beyond `MAX_ANGLE_DEG`. Not changed because it changes which photos the caregiver can add.
- **`scorePeople` still averages fewer than topK** when a person has fewer usable vectors (`matcher.js:68-91`). This is now unreachable from the app through `buildCandidates`, so it was left to keep the phase 4 tests and semantics.
- **Test mode needs no PIN** (`#/test`). It shows names and scores, but needs a typed URL, which the Home Screen app and Guided Access don't offer. Low risk; gate it behind the caregiver session if wanted.
- **The PIN hash is unsalted SHA-256 of 4–6 digits**, and the lockout resets on reload. That is acceptable for a child-lock, as the spec says.
- **The speech debug log contains the spoken sentence** (name + relationship) via `console.debug` (`src/speech.js:146`). This was intended in phase 7 and is visible only with Web Inspector attached. Remove it once speech is verified on the iPhone.
- **Hidden page keeps the camera on.** The loop is throttled or suspended by the OS, and the camera is not stopped on `visibilitychange` (stopping it would mean a new tap after every lock). Battery use while locked is unmeasured.
- **SW update flow:** `skipWaiting` + `clients.claim` deletes the old cache while an old page may still be open. All modules are imported statically at load, so the risk is low. There is no "update available" reload, so the first launch after a release runs the old code (documented).
- **Patient sees a black screen while models load** after Tap to start (first load can take seconds). Spec forbids error text; a calm "Starting…" is a possible follow-up.
- `savePerson` checks the 5-person limit and writes in separate transactions. Two concurrent saves could exceed 5, but the UI disables Save while saving.
- Failed backends in `face.js` `tryBackend` are not disposed (one extra WebGL context at most). Human runs with `deallocate: true` and every warm-up tensor is disposed, so no per-frame tensor growth was found by reading the code (unmeasured).
- Verified by reading: `vendor/README.md` sizes and SHA-256 match the files on disk. The model JSONs reference only their local `.bin`. Human's default CDN `wasmPath` is overridden by `face.js` (`wasmPath`, `setWasmPaths`, `wasmPlatformFetch: false`, `cacheModels: false`). The only first-party `fetch` is in `sw.js` and is same-origin only. No `innerHTML`. Every file the app loads is in PRECACHE, and every PRECACHE entry exists.

### Check on the iPhone (unverified)

- Lock and unlock the phone with a person confirmed: the card should be gone on return, and should come back within ~0.5 s if they're still in view, without speaking again inside 45 s.
- **If nothing is ever recognised after this update**, open Test mode. If it always says "no face", the iPhone may report the camera track as `muted` while delivering frames (fix 2), so report it.
- Take the camera away (e.g. open the Camera app, or take a call) and come back: you should see "Tap to start" (or the camera resumes), never a frozen picture with a name.
- Test mode: the Back button works and is reachable under the notch.
- Unverified doc claims in `docs/install.md`: whether clearing *Safari* website data also clears an installed Home Screen app's data (on recent iOS the Home Screen app has its own storage), and the camera-permission path (on iOS it is usually Settings → Apps → Safari → Camera, not Privacy & Security). Check both on the phone and correct the guide.
- Still open from earlier phases: backend, init and per-frame timings, offline launch, the silent switch, and re-tuning ACCEPT with real family photos.

## Open items (carried over to the next session)

Everything below is open after phase 9. Phases 1 and 3-9 are ticked; phase 2 stays unticked until the iPhone numbers exist.

### Owed from the iPhone (user runs, then report)
- Phase 2: which backend was picked, `init()` time (first and cached load), `detect()` and `embed()` ms with a face in view. Test mode shows these. Then tick row 2.
- Cog v13 (8 teeth, gaps about as wide as the teeth; v12 teeth were too fat): confirm it looks right on the phone.
- **Data loss report (iPhone, after the v12 update):** the app asked for a new PIN, as if the stored data was gone. No code change touched the DB name/version (`whosthis` v1) or the origin. Likely cause (user enrolled in a Safari tab, then installed): on iPhone a Safari tab and the Home Screen app have SEPARATE IndexedDB storage. **Addressed in v14, NOT verified in a browser or on an iPhone:** (1) `store.requestPersistence()` now also runs at app start (`app.js`; caregiver calls kept). (2) Backup / restore in the caregiver home screen under "Back up / move to another install": pure `src/backup.js` (format `whosthis-backup` v1, JSON with data: URL photos, plain-array embeddings, settings; strict `validateBackup`, max 5 people, 3-10 photos, finite equal-length embeddings, image/jpeg|png magic bytes checked, string length limits, 60 MB file cap) with `tests/backup.test.js`; `store.replaceAll()` writes people and settings in ONE IndexedDB transaction after everything was validated and decoded. Imported settings go through the existing clamps plus a floor at the defaults (accept >= 0.65, margin >= 0.10, confirmFrames >= 5), so a backup can never loosen matching (note the settings slider itself still allows accept down to 0.60). **Changed 2026-10-11 (owner decision):** imported accept now uses the slider's clamp, 0.55-0.80 (a backup with 0.5 restores as 0.55), so a value set on the slider survives a backup; margin >= 0.10 and confirmFrames >= 5 floors unchanged. The PIN hash from a valid backup replaces the current one; a backup without one keeps the current PIN. (3) Install-first nudge: shown only on iOS in a non-standalone tab (`shouldNudgeInstall`), as a bold notice at the top of the caregiver people list and as one small calm line under "Tap to start" (`.pt-install`, hidden when standalone, hidden while running). `docs/install.md` now says install first and documents the backup route. Unverified: share sheet with a file (`navigator.share({files})`) and file picking from Files on iOS, standalone detection, a ~10 MB backup size, and the layout of the new line.
- **Install guide ("OK, show me how"), v17, NOT verified in a browser or on an iPhone:** true one-tap install is impossible on iOS Safari (no install prompt API, a page cannot add itself to the Home Screen), so `src/install-guide.js` (pure step data + DOM overlay, in PRECACHE, tests in `tests/install-guide.test.js`) gives a full-screen 3-step guide with original inline SVG drawings (Share button, "Add to Home Screen" in the list, "Add" top right + new icon), a Back/Next/Close flow, a short Safari-in-another-browser note and an "Open the share menu for me" button that calls `navigator.share({title, url})` inside the tap (hidden if `navigator.share` is missing, AbortError ignored, other errors ignored). Whether that share sheet opens on iOS, and whether it lists "Add to Home Screen", is UNVERIFIED. The drawings and layout are unverified too. Opened by a button in the caregiver install notice and in the small patient-view line (still only on iOS in a non-standalone tab); it never opens automatically and does not block "Tap to start". Check on the phone: button size and layout under "Tap to start", the guide in light and dark mode, Reduce Motion, Close/Back, and the share button.
- **Refresh app, v19, NOT verified on an iPhone:** caregiver People screen has an About section (`src/version.js` APP_VERSION, active cache name from `caches.keys()`) and a Refresh app button (registration.update(), wait up to 20 s for the new worker to activate, then reload; touches no data). Test: with v19 installed, push v20, press Refresh app, confirm it reloads showing v20 with people and settings intact; also try offline (expect the calm 'Couldn't check' message) and with no update (expect 'latest version'). Release rule: bump `CACHE_VERSION` and `APP_VERSION` together (test enforces).
- Push `2d3d42d` and later commits (`git push`), then reopen the Home Screen app twice (the first launch after a release runs the old code).
- Offline launch (airplane mode), silent switch and volume behaviour for speech, lock/unlock behaviour (card gone on return), Test mode Back button.
- Correct `docs/install.md` for the two unverified claims: Home Screen app storage vs clearing Safari website data, and the camera-permission path in Settings.
- Re-tune ACCEPT/MARGIN with real family photos using the Test view scores (see phase 4 row). Only raise them to fix wrong names; ACCEPT may go down to 0.55 (owner decision 2026-10-11) but only when Test mode shows no wrong person or stranger scoring that high.
- v16 settings screen on the iPhone (v18: recommended is now 0.60): slider reaches 0.55 and 0.80, value line and warning update while dragging, "Reset to recommended (0.60)" works, the value survives a reload and a backup + restore, Help text reads well.

### Small clean-ups
- Remove the `[whosthis speech]` `console.debug` lines in `src/speech.js` once speech is confirmed on the iPhone.

### Decisions for the user (phase 9, see "Review findings")
- Drop a stale name sooner (about 0.5 s) when a different usable face is in view (changes approved timing).
- Cross-check enrolment photos against the person's other photos and against other enrolled people.
- Reject enrolment photos turned more than `MAX_ANGLE_DEG`.
- Put Test mode behind the caregiver PIN.
- Show a calm "Starting..." instead of a black screen while models load.
- Stop the camera while the phone is locked (needs a new tap after each lock).

### Known weak spots
- Children and look-alike relatives score close together; needs more varied enrolment photos and real-data tuning.
- Thresholds so far come from non-family data.
