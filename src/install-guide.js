// "OK, show me how" install guide: a full-screen overlay with 3 big steps, shared by the caregiver
// notice and the patient-view line. An iPhone web page CANNOT add itself to the Home Screen (iOS
// Safari has no install prompt), so this only shows the caregiver how. Opened only by a tap.
// The data and helpers at the top are pure (no DOM) so node --test can check them.
// DOM is built with createElement/createElementNS only, never innerHTML.

export const OPEN_NOTE = 'Open Who\'s This? from its new icon. Set up people there, or, if you had already set up people in the browser, set a new PIN and restore your backup file (Restore from a backup file).';

export const INSTALL_STEPS = [
  {
    caption: 'Tap ⋯ at the bottom of the screen',
    art: 'dots',
    help: 'Do this in Safari itself. The three dots are at the bottom right, next to the address bar. On older iPhones there is no dots button: tap the Share button (a square with an arrow pointing up) in the bottom toolbar instead, then go to step 3. On an iPad, Share is at the top right.',
  },
  {
    caption: 'Tap Share',
    art: 'menu',
    help: 'Share is at the top of the menu that opens from the three dots.',
  },
  {
    caption: 'Scroll and tap Add to Home Screen',
    art: 'list',
    help: 'Slide the list up with your finger to find "Add to Home Screen". If you cannot see it, scroll to the bottom and look for "Edit Actions" or "View More".',
  },
  {
    caption: 'Tap Add',
    art: 'add',
    help: 'Add is the blue button at the top right. Leave "Open as Web App" switched on. The name can stay as it is.',
  },
  {
    caption: 'Open the new icon',
    art: 'home',
    help: `Close Safari first. ${OPEN_NOTE}`,
  },
];

// ---- Illustrations: original simple drawings as data (tag, attributes). Classes are styled in styles.css. ----
// Fixed colours (not theme colours) so they read the same in light and dark mode. "ig-ring" is the warm
// dashed ring + "ig-arrow" the warm arrow that mark what to tap; "ig-pulse" is animated only when motion is allowed.
export const VIEWBOX = '0 0 300 220';

// The app icon (same look as icons/icon.svg: teal square, white head, question mark) drawn at x,y, size s.
function appIcon(x, y, s) {
  const t = `translate(${x} ${y}) scale(${s / 100})`;
  return [
    ['rect', { width: 100, height: 100, rx: 22, class: 'ig-tealfill', transform: t }],
    ['circle', { cx: 38, cy: 48, r: 21, class: 'ig-icline', transform: t }],
    ['path', { d: 'M9 93C9 82 21 77 38 77C55 77 67 82 67 93', class: 'ig-icline', transform: t }],
    ['path', { d: 'M30 54Q38 61 46 54', class: 'ig-icline', transform: t }],
    ['path', { d: 'M72 24C72 14 88 14 88 24C88 31 80 30 80 37', class: 'ig-icline', transform: t }],
    ['circle', { cx: 31, cy: 43, r: 3, class: 'ig-icdot', transform: t }],
    ['circle', { cx: 45, cy: 43, r: 3, class: 'ig-icdot', transform: t }],
    ['circle', { cx: 80, cy: 46, r: 3.5, class: 'ig-icdot', transform: t }],
  ];
}
// Big warm arrow. dir: 'down' | 'up' | 'right'; (x,y) is the tip.
function arrow(x, y, dir) {
  const d = {
    down: `M${x} ${y} l-22 -26 h13 v-34 h18 v34 h13 z`,
    up: `M${x} ${y} l-22 26 h13 v34 h18 v-34 h13 z`,
    right: `M${x} ${y} l-26 -22 v13 h-34 v18 h34 v13 z`,
  }[dir];
  return ['path', { d, class: 'ig-arrow ig-pulse' }];
}
function ring(cx, cy, r) {
  return [
    ['circle', { cx, cy, r, class: 'ig-ring-bg' }],
    ['circle', { cx, cy, r, class: 'ig-ring ig-pulse' }],
  ];
}
// Screen cut off at the top: no top edge, no top corners; rounded corners only at the bottom.
function phone(x, y, w, h) {
  const r = 22;
  return ['path', { d: `M${x} ${y} V${y + h - r} a${r} ${r} 0 0 0 ${r} ${r} H${x + w - r} a${r} ${r} 0 0 0 ${r} ${-r} V${y}`, class: 'ig-phone' }];
}
// A whole phone (home screen): all four corners rounded.
function phoneFull(x, y, w, h) {
  return ['rect', { x, y, width: w, height: h, rx: 22, class: 'ig-phone' }];
}
// A sheet that slides up from the bottom of the screen or down from the top: rounded corners on one end only.
// from: 'top' (rounded top, bleeds off the bottom).
function sheetTop(x, y, w, h, r = 14) {
  return ['path', { d: `M${x} ${y + h} V${y + r} a${r} ${r} 0 0 1 ${r} ${-r} H${x + w - r} a${r} ${r} 0 0 1 ${r} ${r} V${y + h}`, class: 'ig-sheet' }];
}

// Glyph outlines (24x24 grid, stroke only) copied from Tabler Icons, MIT licence, https://tabler.io/icons
// (see vendor/README.md). Drawn thin: the CSS uses a fixed 2px stroke (vector-effect: non-scaling-stroke).
const GLYPH = {
  upload: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 9l5 -5l5 5', 'M12 4l0 12'],
  squarePlus: ['M9 12h6', 'M12 9v6', 'M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z'],
  bookmark: ['M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4z'],
  book: ['M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0', 'M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0', 'M3 6l0 13', 'M12 6l0 13', 'M21 6l0 13'],
  plus: ['M12 5l0 14', 'M5 12l14 0'],
  x: ['M18 6l-12 12', 'M6 6l12 12'],
  handFinger: ['M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5', 'M11 11.5v-2a1.5 1.5 0 1 1 3 0v2.5', 'M14 10.5a1.5 1.5 0 0 1 3 0v1.5', 'M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47'],
};
// A glyph drawn with its top-left corner at x,y and size s. cls: 'ig-gl-w' (white), 'ig-gl-d' (dark), 'ig-gl-t' (teal).
function glyph(name, x, y, s, cls) {
  const transform = `translate(${x} ${y}) scale(${s / 24})`;
  return GLYPH[name].map((d) => ['path', { d, class: `ig-gl ${cls}`, transform }]);
}
function grey(x, y, w, h, rx = 5) { return ['rect', { x, y, width: w, height: h, rx, class: 'ig-grey' }]; }
function dark(x, y, w, h, rx) { return ['rect', { x, y, width: w, height: h, rx, class: 'ig-dark' }]; }
// Safari's floating bottom bar: back/forward pill, address pill, round "..." button (centre 214,192).
function safariBar() {
  return [
    dark(58, 178, 46, 28, 14),
    ['path', { d: 'M74 185 l-6 7 l6 7', class: 'ig-gl ig-gl-w' }],
    ['path', { d: 'M88 185 l6 7 l-6 7', class: 'ig-gl ig-gl-w' }],
    dark(108, 178, 82, 28, 14),
    ['rect', { x: 126, y: 189, width: 46, height: 6, rx: 3, class: 'ig-barline' }],
    ['circle', { cx: 214, cy: 192, r: 14, class: 'ig-dark' }],
    ['circle', { cx: 207, cy: 192, r: 2, class: 'ig-barline' }],
    ['circle', { cx: 214, cy: 192, r: 2, class: 'ig-barline' }],
    ['circle', { cx: 221, cy: 192, r: 2, class: 'ig-barline' }],
  ];
}

export const ART = {
  // 1: bottom of Safari with the round "..." button ringed.
  dots: [
    phone(50, -10, 200, 224),
    grey(66, 26, 124, 12),
    grey(66, 48, 100, 9),
    grey(66, 66, 118, 9),
    grey(66, 84, 90, 9),
    grey(66, 102, 112, 9),
    ...safariBar(),
    ...ring(214, 192, 24),
    arrow(214, 164, 'down'),
  ],
  // 2: the dark menu from the "...", "Share" row ringed.
  menu: [
    phone(50, -10, 200, 224),
    grey(66, 26, 100, 12),
    grey(66, 48, 80, 9),
    dark(114, 36, 126, 132, 18),
    ['rect', { x: 120, y: 44, width: 114, height: 30, rx: 10, class: 'ig-darkhi' }],
    ...glyph('upload', 128, 49, 20, 'ig-gl-w'),
    ['text', { x: 156, y: 64, class: 'ig-label ig-label-w', t: 'Share' }],
    ...glyph('bookmark', 128, 83, 18, 'ig-gl-w'),
    ['rect', { x: 156, y: 90, width: 66, height: 6, rx: 3, class: 'ig-barline' }],
    ...glyph('book', 128, 111, 18, 'ig-gl-w'),
    ['rect', { x: 156, y: 118, width: 56, height: 6, rx: 3, class: 'ig-barline' }],
    ...glyph('plus', 128, 139, 18, 'ig-gl-w'),
    ['rect', { x: 156, y: 146, width: 46, height: 6, rx: 3, class: 'ig-barline' }],
    ...safariBar(),
    ['rect', { x: 116, y: 41, width: 122, height: 36, rx: 12, class: 'ig-ring-bg' }],
    ['rect', { x: 116, y: 41, width: 122, height: 36, rx: 12, class: 'ig-ring ig-pulse' }],
    arrow(110, 59, 'right'),
  ],
  // 3: the share sheet (header, app row, round actions, list) with "Add to Home Screen" ringed.
  list: [
    sheetTop(84, 14, 152, 220),
    ...appIcon(92, 24, 26),
    ['text', { x: 124, y: 36, class: 'ig-label', t: 'Who\'s This?' }],
    grey(124, 42, 54, 5, 2.5),
    ['circle', { cx: 220, cy: 34, r: 9, class: 'ig-grey' }],
    ...glyph('x', 214, 28, 12, 'ig-gl-d'),
    ...[94, 122, 150, 178].map((x) => grey(x, 58, 22, 22, 6)),
    ...[104, 132, 160, 188].map((cx) => ['circle', { cx, cy: 104, r: 11, class: 'ig-grey' }]),
    ...glyph('bookmark', 126, 96, 16, 'ig-gl-d'),
    ['rect', { x: 90, y: 124, width: 140, height: 82, rx: 10, class: 'ig-white' }],
    grey(98, 132, 80, 7, 3.5),
    grey(98, 150, 70, 7, 3.5),
    ...glyph('squarePlus', 96, 177, 18, 'ig-gl-d'),
    ['text', { x: 118, y: 190, class: 'ig-label ig-label-s', t: 'Add to Home Screen' }],
    ['rect', { x: 88, y: 167, width: 144, height: 38, rx: 11, class: 'ig-ring-bg' }],
    ['rect', { x: 88, y: 167, width: 144, height: 38, rx: 11, class: 'ig-ring ig-pulse' }],
    arrow(82, 186, 'right'),
    ['path', { d: 'M270 160 v-60 M259 112 l11 -12 l11 12', class: 'ig-scroll' }],
  ],
  // 4: the "Add to Home Screen" dialog with the blue "Add" button ringed.
  add: [
    sheetTop(24, 10, 252, 220, 18),
    ['circle', { cx: 50, cy: 36, r: 14, class: 'ig-white' }],
    ...glyph('x', 43, 29, 14, 'ig-gl-d'),
    ['text', { x: 74, y: 41, class: 'ig-label ig-label-m', t: 'Add to Home Screen' }],
    ['rect', { x: 214, y: 22, width: 48, height: 28, rx: 14, class: 'ig-blue' }],
    ['text', { x: 238, y: 41, class: 'ig-addlabel', t: 'Add', 'text-anchor': 'middle' }],
    ['rect', { x: 32, y: 64, width: 236, height: 58, rx: 10, class: 'ig-white' }],
    ...appIcon(42, 74, 38),
    ['text', { x: 92, y: 92, class: 'ig-name', t: 'Who\'s This?' }],
    grey(92, 102, 110, 6, 3),
    ['rect', { x: 32, y: 134, width: 236, height: 34, rx: 10, class: 'ig-white' }],
    ['text', { x: 42, y: 156, class: 'ig-label ig-label-s', t: 'Open as Web App' }],
    ['rect', { x: 216, y: 140, width: 40, height: 22, rx: 11, class: 'ig-green' }],
    ['circle', { cx: 245, cy: 151, r: 9, class: 'ig-knob' }],
    grey(36, 180, 200, 6, 3),
    grey(36, 192, 150, 6, 3),
    ['rect', { x: 206, y: 16, width: 64, height: 40, rx: 20, class: 'ig-ring-bg' }],
    ['rect', { x: 206, y: 16, width: 64, height: 40, rx: 20, class: 'ig-ring ig-pulse' }],
    arrow(238, 63, 'up'),
  ],
  // 5: Home Screen with the new icon ringed and a hand pointing at it from below.
  home: [
    phoneFull(70, 6, 160, 208),
    ...[[82, 28], [120, 28], [158, 28], [196, 28], [120, 72], [158, 72], [196, 72], [82, 116], [120, 116], [158, 116], [196, 116]].map(([x, y]) => grey(x, y, 30, 30, 8)),
    ...appIcon(82, 72, 30),
    grey(80, 184, 140, 28, 12),
    ...ring(97, 87, 27),
    arrow(66, 87, 'right'),
    ...GLYPH.handFinger.map((d) => ['path', { d, class: 'ig-gl ig-hand', transform: 'translate(88 98) scale(2.8)' }]),
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
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 't') node.textContent = String(v);
      else node.setAttribute(k, String(v));
    }
    svg.append(node);
  }
  return svg;
}

function chevron(dir) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ig-chev');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', dir === 'left' ? 'M15 4 L7 12 L15 20' : 'M9 4 L17 12 L9 20');
  svg.append(path);
  return svg;
}

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function btn(label, className, onClick, icon) {
  const b = h('button', className);
  b.type = 'button';
  if (icon && icon.dir === 'left') b.append(chevron('left'));
  b.append(h('span', 'ig-btn-label', label));
  if (icon && icon.dir === 'right') b.append(chevron('right'));
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

    // Everything the person needs sits in the TOP part of the screen: the iOS share sheet covers the
    // bottom 55-65% once it is open. Order: dots + Close, Back/Next, caption, picture; extras below.
    const top = h('div', 'ig-top');
    const dots = h('ol', 'ig-dots');
    dots.setAttribute('aria-label', `Step ${page + 1} of ${INSTALL_STEPS.length}`);
    INSTALL_STEPS.forEach((st, i) => {
      const li = h('li', 'ig-dotli');
      const d = h('button', i === page ? 'ig-dot ig-dot-on' : 'ig-dot', String(i + 1));
      d.type = 'button';
      d.setAttribute('aria-label', `Go to step ${i + 1}: ${st.caption}`);
      if (i === page) d.setAttribute('aria-current', 'step');
      d.addEventListener('click', () => { page = i; render(); });
      li.append(d);
      dots.append(li);
    });
    top.append(dots, btn('Close', 'ig-close', close));

    const nav = h('div', 'ig-nav');
    if (page > 0) nav.append(btn('Back', 'ig-btn ig-secondary', () => { page -= 1; render(); }, { dir: 'left' }));
    if (!last) nav.append(btn('Next', 'ig-btn', () => { page += 1; render(); }, { dir: 'right' }));
    else nav.append(btn('Done', 'ig-btn', close));

    const title = h('h1', 'ig-title');
    step.caption.split(/(⋯)/).forEach((part) => { if (part) title.append(part === '⋯' ? h('span', 'ig-dotsch', part) : document.createTextNode(part)); });
    title.id = 'ig-title';
    title.tabIndex = -1;
    const art = drawArt(step.art);
    if (page < INSTALL_STEPS.length - 1) {
      // Menus and sheets open over the bottom of the screen; a tap on the picture moves on.
      art.classList.add('ig-art-tap');
      art.addEventListener('click', () => { page += 1; render(); });
    }
    const kids = [top, nav, title, art];

    const more = h('details', 'ig-more');
    more.append(h('summary', 'ig-more-sum', 'More help'), h('p', 'ig-help', step.help));
    kids.push(more);

    root.replaceChildren(...kids);
    root.scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  current = root;
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  render();
}
