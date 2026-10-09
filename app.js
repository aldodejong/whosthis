// Entry point: hash-based routing between the three views, plus service worker registration.
// Routes: #/patient (default), #/caregiver, #/test.
// Each view module exports mount(container). mount() may return a cleanup function,
// which is called when the user navigates away from that view.

import * as patient from './src/ui/patient.js';
import * as caregiver from './src/ui/caregiver.js';
import * as test from './src/ui/test.js';

const ROUTES = { patient, caregiver, test };
const DEFAULT_ROUTE = 'patient';

const container = document.getElementById('app');
let cleanup = null;

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return Object.hasOwn(ROUTES, name) ? name : DEFAULT_ROUTE;
}

function render() {
  const name = currentRoute();
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch (err) { console.warn('cleanup failed', err); }
  }
  cleanup = null;
  container.replaceChildren();
  container.dataset.view = name;
  const result = ROUTES[name].mount(container);
  cleanup = typeof result === 'function' ? result : null;
}

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register(new URL('./sw.js', import.meta.url))
    .catch((err) => console.warn('service worker not registered', err));
}
