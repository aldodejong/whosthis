// Caregiver view: PIN, people list, person form with photo checks, settings, help.
// Plain DOM only (createElement + textContent); user text never goes through innerHTML.
// The session unlock lives in memory only, so a reload asks for the PIN again.

import * as store from '../store.js';
import {
  MAX_PEOPLE, MIN_ENROL_PHOTOS, MAX_ENROL_PHOTOS, MAX_PHOTO_PX, SHARPNESS_WIDTH,
  ACCEPT_MIN, ACCEPT_MAX, MAX_PIN_TRIES, PIN_LOCK_MS,
  pinProblem, checkPhoto, laplacianVariance, fitWithin, draftProblem, clampAccept,
} from '../caregiver-logic.js';
import { DEFAULTS } from '../matcher.js';

const MAX_PHOTO_ITEMS = 20; // accepted + rejected shown at once, keeps the screen manageable

let faceModule = null;
function loadFace() {
  if (!faceModule) faceModule = import('../face.js').catch((err) => { faceModule = null; throw err; });
  return faceModule;
}

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

const errText = (err) => (err && err.message ? err.message : 'Something went wrong.');

export function mount(container) {
  let unlocked = false;
  let alive = true;
  let wrongTries = 0;
  let lockedUntil = 0;
  const urls = new Set();
  let viewUrls = []; // object URLs belonging to the current screen
  let staleUrls = []; // previous screen's URLs, revoked once the new screen is shown
  let began = false;
  // Call before building a screen whose nodes use makeUrl(), so show() doesn't revoke the new URLs.
  function beginScreen() {
    staleUrls.push(...viewUrls);
    viewUrls = [];
    began = true;
  }

  const root = el('div', { class: 'cg' });
  container.append(root);

  function makeUrl(blob) {
    const u = URL.createObjectURL(blob);
    urls.add(u);
    viewUrls.push(u);
    return u;
  }
  function revoke(list) {
    for (const u of list) { URL.revokeObjectURL(u); urls.delete(u); }
  }
  function show(...nodes) {
    revoke(staleUrls);
    staleUrls = [];
    if (!began) { revoke(viewUrls); viewUrls = []; }
    began = false;
    root.replaceChildren(...nodes);
    window.scrollTo(0, 0);
  }

  const heading = (t) => el('h1', { text: t });
  const message = (cls = 'cg-msg') => el('p', { class: cls, role: 'alert' });
  const button = (text, onclick, cls = '') => el('button', { type: 'button', class: cls, text, onclick });
  function pinInput(label) {
    const input = el('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', autocomplete: 'off', 'aria-label': label, placeholder: label });
    return input;
  }
  function exitBtn() { return button('Exit to patient view', () => { location.hash = '#/patient'; }, 'secondary'); }

  // ---------- PIN screens ----------
  async function start() {
    show(el('p', { class: 'cg-note', text: 'Loading…' }));
    try {
      const s = await store.getSettings();
      if (!alive) return;
      if (!s.pinHash) showSetPin(); else showLogin(s.pinHash);
    } catch (err) {
      if (alive) show(heading('Caregiver'), el('p', { class: 'cg-msg', text: errText(err) }), exitBtn());
    }
  }

  function showSetPin() {
    const a = pinInput('New PIN (4 to 6 digits)');
    const b = pinInput('Enter it again');
    const msg = message();
    show(
      heading('Set a PIN'),
      el('p', { class: 'cg-note', text: 'Choose a 4 to 6 digit PIN. It keeps the caregiver area away from the patient.' }),
      a, b, msg,
      button('Save PIN', async () => {
        msg.textContent = '';
        const bad = pinProblem(a.value);
        if (bad) { msg.textContent = bad; return; }
        if (a.value !== b.value) { msg.textContent = 'The two PINs do not match.'; return; }
        try {
          await store.saveSettings({ pinHash: await store.hashPin(a.value) });
          store.requestPersistence();
          unlocked = true;
          showList();
        } catch (err) { msg.textContent = errText(err); }
      }),
      exitBtn(),
    );
    a.focus();
  }

  function showLogin(pinHash) {
    const input = pinInput('PIN');
    const msg = message();
    async function tryPin() {
      const wait = lockedUntil - Date.now();
      if (wait > 0) { msg.textContent = `Too many wrong tries. Wait ${Math.ceil(wait / 1000)} seconds.`; return; }
      try {
        if (await store.hashPin(input.value) === pinHash) {
          unlocked = true; wrongTries = 0; showList(); return;
        }
      } catch (err) { msg.textContent = errText(err); return; }
      input.value = '';
      wrongTries++;
      if (wrongTries >= MAX_PIN_TRIES) {
        wrongTries = 0;
        lockedUntil = Date.now() + PIN_LOCK_MS;
        msg.textContent = `Too many wrong tries. Wait ${PIN_LOCK_MS / 1000} seconds.`;
      } else {
        msg.textContent = 'That PIN is not right. Try again.';
      }
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPin(); });
    show(heading('Caregiver'), el('p', { class: 'cg-note', text: 'Enter your PIN.' }), input, msg, button('Unlock', tryPin), exitBtn());
    input.focus();
  }

  // ---------- People list ----------
  async function showList() {
    if (!unlocked) return start();
    let people;
    try { people = await store.listPeople(); } catch (err) {
      show(heading('People'), el('p', { class: 'cg-msg', text: errText(err) }), exitBtn());
      return;
    }
    if (!alive) return;
    const stale = await staleModel(people);
    const msg = message();
    beginScreen();
    const items = people.map((p) => {
      const photo = p.displayPhoto ? el('img', { class: 'cg-thumb', alt: '', src: makeUrl(p.displayPhoto) }) : el('div', { class: 'cg-thumb' });
      const needsUpdate = stale && p.embeddingModel !== stale;
      return el('li', { class: 'cg-person' },
        photo,
        el('div', { class: 'cg-person-info' },
          el('strong', { text: p.name }),
          el('span', { text: p.relationship }),
          el('span', { class: 'cg-note', text: `${(p.enrolPhotos || []).length} enrolment photos` }),
          needsUpdate ? el('span', { class: 'cg-msg', text: 'Needs updating: open Edit, then Save.' }) : null),
        el('div', { class: 'cg-row' },
          button('Edit', () => showForm(p)),
          button('Delete', () => {
            if (confirm(`Delete ${p.name}? This cannot be undone.`)) {
              store.deletePerson(p.id).then(showList, (err) => { msg.textContent = errText(err); });
            }
          }, 'danger')));
    });
    show(
      heading('People'),
      people.length ? el('ul', { class: 'cg-list' }, items) : el('p', { class: 'cg-note', text: 'No one enrolled yet.' }),
      msg,
      people.length < MAX_PEOPLE
        ? button('Add a person', () => showForm(null))
        : el('p', { class: 'cg-note', text: `The limit of ${MAX_PEOPLE} people is reached.` }),
      button('Settings', showSettings, 'secondary'),
      el('a', { class: 'btn secondary', href: '#/test', text: 'Test mode' }),
      button('Help', showHelp, 'secondary'),
      exitBtn(),
    );
  }

  // Returns the current embedding model name if any person has an older one, else null.
  async function staleModel(people) {
    if (!people.length) return null;
    try {
      const { EMBEDDING_MODEL } = await loadFace();
      return people.some((p) => p.embeddingModel !== EMBEDDING_MODEL) ? EMBEDDING_MODEL : null;
    } catch (err) { return null; }
  }

  // ---------- Person form ----------
  function showForm(existing) {
    const draft = {
      name: existing ? existing.name : '',
      relationship: existing ? existing.relationship : '',
      displayPhoto: existing ? existing.displayPhoto : null,
      photos: [],
    };
    let photoSeq = 0;
    let chain = Promise.resolve();
    let saving = false;

    const name = el('input', { type: 'text', 'aria-label': 'Name', placeholder: 'Name, e.g. Jane', maxlength: '60', autocomplete: 'off', value: draft.name });
    const rel = el('input', { type: 'text', 'aria-label': 'Relationship', placeholder: 'Relationship, e.g. your daughter', maxlength: '60', autocomplete: 'off', value: draft.relationship });
    name.addEventListener('input', () => { draft.name = name.value; });
    rel.addEventListener('input', () => { draft.relationship = rel.value; });

    const displayBox = el('div', { class: 'cg-display' });
    function renderDisplay() {
      displayBox.replaceChildren();
      if (draft.displayPhoto) displayBox.append(el('img', { class: 'cg-thumb big', alt: 'Display photo', src: makeUrl(draft.displayPhoto) }));
    }
    const displayInput = el('input', { type: 'file', accept: 'image/*', class: 'cg-file', 'aria-label': 'Choose display photo' });
    displayInput.addEventListener('change', async () => {
      const f = displayInput.files && displayInput.files[0];
      displayInput.value = '';
      if (!f) return;
      try {
        const { blob } = await prepareImage(f);
        draft.displayPhoto = blob;
        renderDisplay();
      } catch (err) { msg.textContent = errText(err); }
    });

    const photoList = el('ul', { class: 'cg-photos' });
    const counter = el('p', { class: 'cg-note' });
    const msg = message();
    const saveBtn = button('Save', save);

    const accepted = () => draft.photos.filter((p) => p.status === 'ok');
    const checking = () => draft.photos.some((p) => p.status === 'checking');

    function renderPhotos() {
      photoList.replaceChildren(...draft.photos.map((p) => {
        const state = p.status === 'ok' ? 'Accepted' : p.status === 'checking' ? 'Checking…' : `Rejected: ${p.reason}`;
        return el('li', { class: `cg-photo ${p.status}` },
          el('img', { class: 'cg-thumb', alt: '', src: p.url }),
          el('span', { class: 'cg-photo-state', text: state }),
          button('Remove', () => {
            draft.photos = draft.photos.filter((x) => x !== p);
            URL.revokeObjectURL(p.url); urls.delete(p.url);
            renderPhotos();
          }, 'danger small'));
      }));
      counter.textContent = `${accepted().length} accepted (need ${MIN_ENROL_PHOTOS} to ${MAX_ENROL_PHOTOS}).`;
      saveBtn.disabled = saving || checking();
    }

    // Photo URLs are managed here (not in viewUrls) so re-rendering the list does not revoke them.
    function addPhotoItem(blob, status, extra = {}) {
      const url = URL.createObjectURL(blob);
      urls.add(url);
      const item = { id: ++photoSeq, blob, url, status, reason: '', embedding: null, ...extra };
      draft.photos.push(item);
      return item;
    }

    async function processItem(item) {
      try {
        const face = await loadFace();
        const { canvas, blob } = await prepareImage(item.blob);
        const result = await face.embed(canvas);
        const verdict = checkPhoto(result, sharpnessOf(canvas));
        if (!draft.photos.includes(item)) return; // removed meanwhile
        if (!verdict.ok) { item.status = 'rejected'; item.reason = verdict.reason; }
        else { item.status = 'ok'; item.embedding = result.embedding; item.blob = blob; }
      } catch (err) {
        item.status = 'rejected';
        item.reason = `Could not check this photo (${errText(err)}).`;
      }
      if (alive) renderPhotos();
    }
    const enqueue = (item) => { chain = chain.then(() => processItem(item)); };

    function onPhotos(input) {
      const files = Array.from(input.files || []);
      input.value = '';
      for (const f of files) {
        if (draft.photos.length >= MAX_PHOTO_ITEMS) { msg.textContent = 'Too many photos on screen. Remove some first.'; break; }
        if (accepted().length + draft.photos.filter((p) => p.status === 'checking').length >= MAX_ENROL_PHOTOS) {
          msg.textContent = `You already have ${MAX_ENROL_PHOTOS} photos.`; break;
        }
        enqueue(addPhotoItem(f, 'checking'));
      }
      renderPhotos();
    }
    const camInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'cg-file', 'aria-label': 'Take enrolment photo' });
    const libInput = el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'cg-file', 'aria-label': 'Choose enrolment photos' });
    camInput.addEventListener('change', () => onPhotos(camInput));
    libInput.addEventListener('change', () => onPhotos(libInput));

    async function save() {
      msg.textContent = '';
      const ok = accepted();
      const bad = draftProblem({ name: draft.name, relationship: draft.relationship, hasDisplayPhoto: !!draft.displayPhoto, acceptedPhotos: ok.length });
      if (bad) { msg.textContent = bad; return; }
      saving = true; renderPhotos();
      try {
        const { EMBEDDING_MODEL } = await loadFace();
        await store.savePerson({
          id: existing ? existing.id : undefined,
          createdAt: existing ? existing.createdAt : undefined,
          name: draft.name.trim(),
          relationship: draft.relationship.trim(),
          displayPhoto: draft.displayPhoto,
          enrolPhotos: ok.map((p) => p.blob),
          embeddings: ok.map((p) => p.embedding),
          embeddingModel: EMBEDDING_MODEL,
        });
        store.requestPersistence();
        cleanupPhotos();
        showList();
      } catch (err) {
        saving = false; renderPhotos();
        msg.textContent = errText(err);
      }
    }

    function cleanupPhotos() {
      for (const p of draft.photos) { URL.revokeObjectURL(p.url); urls.delete(p.url); }
      draft.photos = [];
    }

    show(
      heading(existing ? `Edit ${existing.name}` : 'Add a person'),
      el('label', { class: 'cg-label', text: 'Name' }, name),
      el('label', { class: 'cg-label', text: 'Relationship (shown and spoken as written)' }, rel),
      el('h2', { text: 'Display photo' }),
      el('p', { class: 'cg-note', text: 'The photo the patient sees. Any clear photo of this person.' }),
      displayBox,
      el('label', { class: 'btn' }, 'Choose display photo', displayInput),
      el('h2', { text: 'Enrolment photos' }),
      el('p', { class: 'cg-note', text: `Add ${MIN_ENROL_PHOTOS} to ${MAX_ENROL_PHOTOS} photos of only this person, facing the camera, in different light and at different times. Each is checked.` }),
      el('label', { class: 'btn' }, 'Take a photo', camInput),
      el('label', { class: 'btn' }, 'Choose from library', libInput),
      counter, photoList, msg, saveBtn,
      button('Cancel', () => { cleanupPhotos(); showList(); }, 'secondary'),
    );
    // show() cleared viewUrls; the display photo is rendered after so its URL belongs to this screen.
    renderDisplay();
    if (existing) {
      // Reuse stored fingerprints when they come from the current model; otherwise re-check the
      // stored photos so the person ends up with up-to-date fingerprints.
      loadFace().then(({ EMBEDDING_MODEL }) => {
        if (!alive) return;
        const same = existing.embeddingModel === EMBEDDING_MODEL;
        (existing.enrolPhotos || []).forEach((blob, i) => {
          const emb = existing.embeddings && existing.embeddings[i];
          if (same && emb) addPhotoItem(blob, 'ok', { embedding: emb });
          else enqueue(addPhotoItem(blob, 'checking'));
        });
        renderPhotos();
      }).catch((err) => { msg.textContent = errText(err); });
    }
    renderPhotos();
  }

  // ---------- Image helpers ----------
  async function prepareImage(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (err) {
      try { bitmap = await createImageBitmap(file); } catch (err2) { throw new Error('That file is not a readable image.'); }
    }
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_PHOTO_PX);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === 'function') bitmap.close();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress the photo.'))), 'image/jpeg', 0.85);
    });
    return { canvas, blob };
  }

  function sharpnessOf(canvas) {
    const { width, height } = fitWithin(canvas.width, canvas.height, SHARPNESS_WIDTH);
    const small = document.createElement('canvas');
    small.width = width; small.height = height;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, width, height);
    const px = ctx.getImageData(0, 0, width, height).data;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
    return laplacianVariance(gray, width, height);
  }

  // ---------- Settings ----------
  async function showSettings() {
    let s;
    try { s = await store.getSettings(); } catch (err) {
      show(heading('Settings'), el('p', { class: 'cg-msg', text: errText(err) }), button('Back', showList, 'secondary'));
      return;
    }
    const msg = message();
    const flash = (t) => { msg.textContent = t; };

    const speech = el('input', { type: 'checkbox', id: 'cg-speech', class: 'cg-check' });
    speech.checked = !!s.speechOn;
    speech.addEventListener('change', () => store.saveSettings({ speechOn: speech.checked }).then(() => flash('Saved.'), (e) => flash(errText(e))));

    const slider = el('input', { type: 'range', min: String(ACCEPT_MIN), max: String(ACCEPT_MAX), step: '0.01', 'aria-label': 'Match strictness', class: 'cg-range' });
    slider.value = String(clampAccept(s.accept, DEFAULTS.accept));
    const sliderVal = el('span', { class: 'cg-note' });
    const sliderText = () => { sliderVal.textContent = `Threshold ${Number(slider.value).toFixed(2)} (standard is ${DEFAULTS.accept.toFixed(2)}).`; };
    sliderText();
    slider.addEventListener('input', sliderText);
    slider.addEventListener('change', () => store.saveSettings({ accept: clampAccept(slider.value, DEFAULTS.accept) }).then(() => flash('Saved.'), (e) => flash(errText(e))));

    const cur = pinInput('Current PIN');
    const n1 = pinInput('New PIN (4 to 6 digits)');
    const n2 = pinInput('New PIN again');
    const pinMsg = message();
    const changePin = button('Change PIN', async () => {
      pinMsg.textContent = '';
      try {
        const latest = await store.getSettings();
        if (await store.hashPin(cur.value) !== latest.pinHash) { pinMsg.textContent = 'The current PIN is not right.'; return; }
        const bad = pinProblem(n1.value);
        if (bad) { pinMsg.textContent = bad; return; }
        if (n1.value !== n2.value) { pinMsg.textContent = 'The two new PINs do not match.'; return; }
        await store.saveSettings({ pinHash: await store.hashPin(n1.value) });
        cur.value = n1.value = n2.value = '';
        pinMsg.textContent = 'PIN changed.';
      } catch (err) { pinMsg.textContent = errText(err); }
    });

    show(
      heading('Settings'),
      el('label', { class: 'cg-switch', for: 'cg-speech' }, speech, ' Say the name out loud'),
      el('h2', { text: 'Advanced: match strictness' }),
      el('p', { class: 'cg-note', text: 'Stricter shows a name less often but makes a wrong name less likely. When in doubt, the app shows nothing, so it cannot go below the loosest safe setting.' }),
      el('div', { class: 'cg-slider' }, el('span', { text: 'Looser' }), slider, el('span', { text: 'Stricter' })),
      sliderVal,
      el('h2', { text: 'Change PIN' }),
      cur, n1, n2, pinMsg, changePin,
      msg,
      button('Back', showList, 'secondary'),
    );
  }

  // ---------- Help ----------
  function showHelp() {
    show(
      heading('Help'),
      el('h2', { text: 'Lock the phone to this app (Guided Access)' }),
      el('ol', { class: 'cg-help' },
        el('li', { text: 'Open Settings, then Accessibility, then Guided Access, and turn it on.' }),
        el('li', { text: 'Under Passcode Settings, set a Guided Access passcode.' }),
        el('li', { text: 'Open Who\'s This? from the Home Screen.' }),
        el('li', { text: 'Triple-click the side button (or the Home button) and tap Start. The phone now stays in this app.' }),
        el('li', { text: 'To leave, triple-click again and enter the passcode.' })),
      el('h2', { text: 'Your data' }),
      el('p', { text: 'Photos and fingerprints are stored only on this phone and never leave it.' }),
      el('p', { class: 'cg-msg', text: 'If you delete Safari website data (Settings, Safari, Advanced, Website Data), or remove the app and its data, the enrolled people are deleted and must be added again.' }),
      el('h2', { text: 'Good enrolment photos' }),
      el('p', { text: 'Use clear photos of only one person, facing the camera, in good light. Add a few taken at different times so recognition works in different conditions.' }),
      button('Back', showList, 'secondary'),
    );
  }

  start();

  return () => {
    alive = false;
    unlocked = false;
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    root.remove();
  };
}
