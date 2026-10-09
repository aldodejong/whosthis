// Face library wrapper. This is the ONLY file that imports the face library.
// Library: @vladmandic/human 3.3.6 (vendored, see vendor/README.md), which bundles TensorFlow.js 4.22.0.
// Pipeline: BlazeFace (detect) -> FaceMesh (468 landmarks, head angles, rotation-corrected crop)
//           -> FaceRes (1024-number face fingerprint).
//
// Exports:
//   init()          load the models from vendor/ (same site only) and pick a working backend
//   detect(source)  largest face only, or null
//   embed(source)   fingerprint of the largest face, or null
//   EMBEDDING_MODEL which library/version/models produced a fingerprint (stored with each person)
//
// `source` can be an HTMLVideoElement, HTMLImageElement, HTMLCanvasElement, OffscreenCanvas,
// ImageBitmap or ImageData. Calls are queued, so overlapping calls are safe but run one at a time.
//
// When in doubt, show nothing: faces whose landmark mesh fails are dropped by the library
// (mesh.keepInvalid = false), and every result cache/skip is turned off so a fingerprint is never
// reused from an earlier frame or a different photo.

import { Human } from '../vendor/human/human.esm.js';

export const LIBRARY_VERSION = '3.3.6';
export const EMBEDDING_MODEL = `@vladmandic/human@${LIBRARY_VERSION}:blazeface+facemesh+faceres`;

// Resolved against this file, so the app works from any sub-path (e.g. GitHub Pages /whosthis/).
const MODEL_BASE = new URL('../vendor/human/models/', import.meta.url).href;
const WASM_BASE = new URL('../vendor/tfjs-backend-wasm/', import.meta.url).href;

// Tried in order. 'humangl' is Human's WebGL backend with context-loss handling and works in
// iOS Safari (WebGL2). 'wasm' and 'cpu' are slower fallbacks. WebGPU is deliberately not tried:
// it is absent on iOS 17 and less tested in TensorFlow.js.
const BACKENDS = ['humangl', 'webgl', 'wasm', 'cpu'];

// Room for a few faces so we can pick the LARGEST one ourselves (the library's own ordering is by
// confidence, not size) and report how many faces were seen.
const MAX_FACES = 5;

// Model names as the library registers them once loaded.
const REQUIRED_MODELS = ['blazeface', 'facemesh', 'faceres'];

const RAD_TO_DEG = 180 / Math.PI;

function baseConfig(backend) {
  return {
    backend,
    modelBasePath: MODEL_BASE,
    wasmPath: WASM_BASE, // must be set: the library's default points at a CDN
    wasmPlatformFetch: false,
    cacheModels: false, // the service worker already caches vendor/; avoid a second copy in IndexedDB
    validateModels: true,
    debug: false,
    async: true,
    warmup: 'none',
    cacheSensitivity: 0, // never return results from a previous frame
    deallocate: true,
    filter: { enabled: false },
    gesture: { enabled: false },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    segmentation: { enabled: false },
    face: {
      enabled: true,
      detector: {
        modelPath: 'blazeface.json',
        rotation: true, // rotation-corrected face crop before landmarks + fingerprint
        maxDetected: MAX_FACES,
        skipFrames: 0,
        skipTime: 0,
        minConfidence: 0.5,
        iouThreshold: 0.1,
        return: false,
      },
      mesh: { enabled: true, modelPath: 'facemesh.json', keepInvalid: false },
      attention: { enabled: false },
      iris: { enabled: false },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false },
      description: { enabled: true, modelPath: 'faceres.json', skipFrames: 0, skipTime: 0, minConfidence: 0.1 },
    },
  };
}

let human = null;
let initPromise = null;
let queue = Promise.resolve();

/** Name of the backend in use after init(), e.g. 'humangl', 'wasm' or 'cpu'. */
export function backendName() {
  return human ? human.tf.getBackend() : null;
}

async function tryBackend(backend) {
  const h = new Human(baseConfig(backend));
  // Point TensorFlow.js at the vendored wasm files before any backend starts initialising:
  // tfjs may try the wasm backend on its own while another backend is being set up.
  if (typeof h.tf.setWasmPaths === 'function') h.tf.setWasmPaths(WASM_BASE, false);
  await h.init();
  if (h.tf.getBackend() !== backend) throw new Error(`backend ${backend} not available`);
  await h.load();
  // The library logs (rather than throws) when a model fails to load, so check explicitly.
  const loaded = h.models.models || {};
  for (const name of REQUIRED_MODELS) {
    if (!loaded[name]) throw new Error(`model ${name} did not load`);
  }
  // Run every model once on a blank input: proves this backend can actually execute them
  // (WebGL can initialise and still fail when compiling shaders) and warms up the shaders.
  for (const name of REQUIRED_MODELS) {
    const model = loaded[name];
    const shape = model.inputs[0].shape.map((d) => (d == null || d < 0 ? 1 : d));
    const input = h.tf.zeros(shape);
    try {
      const out = model.execute(input);
      const tensors = Array.isArray(out) ? out : [out];
      await Promise.all(tensors.map((t) => t.data()));
      h.tf.dispose(tensors);
    } finally {
      input.dispose();
    }
  }
  return h;
}

/**
 * Load the library and models from vendor/ and select a backend.
 * Safe to call more than once; later calls return the same promise.
 * Resolves to { backend, model } or rejects if no backend works.
 */
export function init() {
  if (!initPromise) {
    initPromise = (async () => {
      const errors = [];
      for (const backend of BACKENDS) {
        try {
          human = await tryBackend(backend);
          return { backend: human.tf.getBackend(), model: EMBEDDING_MODEL };
        } catch (err) {
          errors.push(`${backend}: ${err && err.message ? err.message : err}`);
          human = null;
        }
      }
      initPromise = null; // allow a retry later
      throw new Error(`face library could not start (${errors.join('; ')})`);
    })();
  }
  return initPromise;
}

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function run(source, withEmbedding) {
  await init();
  const res = await human.detect(source, { face: { description: { enabled: withEmbedding } } });
  if (!res || res.error || !Array.isArray(res.face) || res.face.length === 0) return null;
  let largest = null;
  for (const f of res.face) {
    if (!largest || f.box[2] * f.box[3] > largest.box[2] * largest.box[3]) largest = f;
  }
  return { face: largest, count: res.face.length };
}

function describe(face, count) {
  const [x, y, width, height] = face.box;
  const angle = face.rotation && face.rotation.angle
    ? {
        yaw: face.rotation.angle.yaw * RAD_TO_DEG,
        pitch: face.rotation.angle.pitch * RAD_TO_DEG,
        roll: face.rotation.angle.roll * RAD_TO_DEG,
      }
    : null;
  return {
    box: { x, y, width, height }, // pixels in the source's own size
    frameFraction: face.boxRaw[2], // face width / frame width, 0..1
    angle, // degrees, 0 = facing the camera; null if unknown
    landmarks: face.mesh, // 468 FaceMesh points [x, y, z], x/y in source pixels
    score: face.score, // library's overall face confidence, 0..1
    faceCount: count, // faces seen in the frame (enrolment rejects > 1)
  };
}

/**
 * Detect faces and return the largest one, or null if there is no usable face.
 * { box: {x, y, width, height}, frameFraction, angle: {yaw, pitch, roll} | null,
 *   landmarks: [[x, y, z], ...], score, faceCount }
 */
export function detect(source) {
  return enqueue(async () => {
    const r = await run(source, false);
    return r ? describe(r.face, r.count) : null;
  });
}

/**
 * Fingerprint the largest face, or null if there is no usable face.
 * { embedding: Float32Array (1024), model: EMBEDDING_MODEL, face: <same shape as detect()> }
 * `face` is included so a frame loop needs one call per frame, not detect() + embed().
 * The embedding is not normalised; compare with cosine similarity.
 */
export function embed(source) {
  return enqueue(async () => {
    const r = await run(source, true);
    if (!r || !Array.isArray(r.face.embedding) || r.face.embedding.length === 0) return null;
    const embedding = Float32Array.from(r.face.embedding);
    if (!embedding.every(Number.isFinite)) return null;
    return { embedding, model: EMBEDDING_MODEL, face: describe(r.face, r.count) };
  });
}
