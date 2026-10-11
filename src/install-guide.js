// "OK, show me how" install guide: a full-screen overlay with 3 big steps, shared by the caregiver
// notice and the patient-view line. An iPhone web page CANNOT add itself to the Home Screen (iOS
// Safari has no install prompt), so this only shows the caregiver how. Opened only by a tap.
// The data and helpers at the top are pure (no DOM) so node --test can check them.
// DOM is built with createElement/createElementNS only, never innerHTML.

export const INSTALL_STEPS = [
  {
    title: 'Tap the Share button',
    body: 'It is the square with an arrow pointing up. On an iPhone it is at the bottom of Safari. On an iPad it is at the top right.',
    art: 'share',
  },
  {
    title: 'Scroll down and tap "Add to Home Screen"',
    body: 'Slide the list up with your finger until you see "Add to Home Screen", then tap it.',
    art: 'list',
  },
  {
    title: 'Tap "Add", then open the new icon',
    body: 'Tap "Add" at the top right. Then close Safari and open Who\'s This? from its new icon on the Home Screen. Set up the people there.',
    art: 'add',
  },
];

export const BROWSER_NOTE = 'On an iPhone, please do this in Safari itself. Other browsers, such as Chrome, can have the same Share menu on recent iOS, but the words may be a little different. If you cannot find it, open this page in Safari.';
export const SHARE_NOTE = 'The share menu has "Add to Home Screen" a bit further down. Scroll the list to find it.';
export const SHARE_TITLE = 'Who\'s This?';

/** True when the Web Share API exists (button is hidden otherwise). */
export function canShare(nav) {
  return !!nav && typeof nav.share === 'function';
}

/** Data for navigator.share: the page address without the #/route part. */
export function shareData(href) {
  return { title: SHARE_TITLE, url: String(href || '').split('#')[0] };
}

/** The user closing the share menu is not an error. */
export function isAbortError(err) {
  return !!err && err.name === 'AbortError';
}

// ---- Illustrations: original simple line drawings as data (tag, attributes). Classes are styled in styles.css. ----
// viewBox 0 0 240 160. "ig-line" teal outline, "ig-fill" solid teal, "ig-paper" background-coloured fill,
// "ig-hi" thick ring that marks what to tap.
export const VIEWBOX = '0 0 240 160';
export const ART = {
  share: [
    ['rect', { x: 70, y: 6, width: 100, height: 148, rx: 14, class: 'ig-line ig-paper' }],
    ['rect', { x: 80, y: 20, width: 80, height: 70, rx: 6, class: 'ig-line' }],
    ['line', { x1: 90, y1: 38, x2: 150, y2: 38, class: 'ig-line' }],
    ['line', { x1: 90, y1: 52, x2: 135, y2: 52, class: 'ig-line' }],
    ['line', { x1: 78, y1: 124, x2: 162, y2: 124, class: 'ig-line' }],
    // share icon: open box + arrow up
    ['path', { d: 'M108 140 h-6 v12 h36 v-12 h-6', class: 'ig-line' }],
    ['path', { d: 'M120 146 v-24 M112 130 l8 -8 l8 8', class: 'ig-line' }],
    ['circle', { cx: 120, cy: 136, r: 20, class: 'ig-hi' }],
  ],
  list: [
    ['rect', { x: 50, y: 6, width: 140, height: 148, rx: 14, class: 'ig-line ig-paper' }],
    ['rect', { x: 60, y: 16, width: 120, height: 22, rx: 6, class: 'ig-line' }],
    ['rect', { x: 60, y: 46, width: 120, height: 22, rx: 6, class: 'ig-line' }],
    ['rect', { x: 60, y: 76, width: 120, height: 22, rx: 6, class: 'ig-line' }],
    ['rect', { x: 56, y: 106, width: 128, height: 30, rx: 8, class: 'ig-hi' }],
    ['rect', { x: 66, y: 112, width: 18, height: 18, rx: 4, class: 'ig-line' }],
    ['path', { d: 'M75 116 v10 M70 121 h10', class: 'ig-line' }],
    ['line', { x1: 94, y1: 121, x2: 172, y2: 121, class: 'ig-line' }],
    // swipe-up arrow
    ['path', { d: 'M212 120 v-60 M202 72 l10 -12 l10 12', class: 'ig-line' }],
  ],
  add: [
    ['rect', { x: 30, y: 6, width: 180, height: 148, rx: 14, class: 'ig-line ig-paper' }],
    ['line', { x1: 42, y1: 36, x2: 198, y2: 36, class: 'ig-line' }],
    ['line', { x1: 46, y1: 21, x2: 86, y2: 21, class: 'ig-line' }],
    ['rect', { x: 150, y: 10, width: 44, height: 22, rx: 11, class: 'ig-fill' }],
    ['rect', { x: 144, y: 6, width: 56, height: 30, rx: 15, class: 'ig-hi' }],
    // new app icon
    ['rect', { x: 92, y: 74, width: 56, height: 56, rx: 14, class: 'ig-fill' }],
    ['circle', { cx: 120, cy: 96, r: 8, class: 'ig-face' }],
    ['path', { d: 'M104 120 q16 -16 32 0', class: 'ig-face-line' }],
    ['line', { x1: 96, y1: 144, x2: 144, y2: 144, class: 'ig-line' }],
  ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function drawArt(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', VIEWBOX);
  svg.setAttribute('class', 'ig-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of ART[name] || []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  }
  return svg;
}

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(label, className, onClick) {
  const b = h('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * The big "OK, show me how" button used by both the caregiver notice and the patient-view line.
 * Opens the guide on tap only. className lets each place size it.
 */
export function guideButton(className = '') {
  return btn('OK, show me how', `ig-open ${className}`.trim(), (ev) => openGuide(ev.currentTarget));
}

let current = null; // only one guide at a time

/** Open the full-screen guide. `opener` gets focus back on close. */
export function openGuide(opener) {
  if (current || typeof document === 'undefined') return;
  let page = 0;
  const root = h('div', 'ig');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'ig-title');

  function close() {
    document.removeEventListener('keydown', onKey);
    root.remove();
    current = null;
    try { if (opener && opener.isConnected) opener.focus(); } catch (err) { /* ignore */ }
  }
  function onKey(ev) { if (ev.key === 'Escape') close(); }

  function render() {
    const step = INSTALL_STEPS[page];
    const last = page === INSTALL_STEPS.length - 1;
    const title = h('h1', 'ig-title', `Step ${page + 1} of ${INSTALL_STEPS.length}: ${step.title}`);
    title.id = 'ig-title';
    title.tabIndex = -1;
    const kids = [title, drawArt(step.art), h('p', 'ig-body', step.body)];

    if (page === 0) {
      if (canShare(navigator)) {
        const shareBtn = btn('Open the share menu for me', 'ig-btn ig-secondary', () => {
          // navigator.share must start inside the tap. Unverified on iOS, so failures are ignored.
          let p;
          try { p = navigator.share(shareData(location.href)); } catch (err) { return; }
          if (p && typeof p.catch === 'function') p.catch((err) => { if (!isAbortError(err)) { /* ignore */ } });
        });
        kids.push(shareBtn, h('p', 'ig-note', SHARE_NOTE));
      }
      kids.push(h('p', 'ig-note', BROWSER_NOTE));
    }

    const nav = h('div', 'ig-nav');
    if (page > 0) nav.append(btn('Back', 'ig-btn ig-secondary', () => { page -= 1; render(); }));
    if (!last) nav.append(btn('Next', 'ig-btn', () => { page += 1; render(); }));
    nav.append(btn('Close', last ? 'ig-btn' : 'ig-btn ig-secondary', close));
    kids.push(nav);

    root.replaceChildren(...kids);
    root.scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  current = root;
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  render();
}
