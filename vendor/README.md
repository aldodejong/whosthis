# vendor/

Pinned third-party files, copied unmodified from the npm registry tarballs. No npm dependency, no build step.
Only `src/face.js` imports anything from here. Nothing in this folder is ever loaded from a CDN.

## @vladmandic/human 3.3.6

- Source: https://registry.npmjs.org/@vladmandic/human/-/human-3.3.6.tgz
  (sha256 of tarball `425e9c51dbbca0c8934362b170cb0d54c2529c11c654b3c03092b16e9d6ad3f7`)
- Homepage: https://github.com/vladmandic/human
- Licence: MIT (`human/LICENSE`)
- Bundles TensorFlow.js 4.22.0 (core, cpu, webgl, wasm, webgpu backends) inside `human.esm.js`.
- Only the face pipeline models are copied (from `package/models/`).

| File | Bytes | From tarball |
|------|------:|--------------|
| `human/human.esm.js` | 2,067,875 | `package/dist/human.esm.js` |
| `human/models/blazeface.json` | 79,038 | `package/models/blazeface.json` |
| `human/models/blazeface.bin` | 538,928 | `package/models/blazeface.bin` |
| `human/models/facemesh.json` | 95,845 | `package/models/facemesh.json` |
| `human/models/facemesh.bin` | 1,477,958 | `package/models/facemesh.bin` |
| `human/models/faceres.json` | 71,432 | `package/models/faceres.json` |
| `human/models/faceres.bin` | 6,978,814 | `package/models/faceres.bin` |
| `human/LICENSE` | 1,067 | `package/LICENSE` |

`human.esm.js` ends with a `sourceMappingURL` comment; the `.map` file is not vendored, so browser
dev tools may log a harmless 404 for it.

## @tensorflow/tfjs-backend-wasm 4.22.0

WebAssembly binaries for the wasm fallback backend (version matches the TensorFlow.js bundled in Human).
The library's default `wasmPath` points at a CDN; `src/face.js` overrides it to this folder.
The threaded build is not included: it needs cross-origin isolation, which GitHub Pages does not provide.

- Source: https://registry.npmjs.org/@tensorflow/tfjs-backend-wasm/-/tfjs-backend-wasm-4.22.0.tgz
  (sha256 of tarball `5cd6f5e18657c12fb94f4ec3dcef485c8c1a9ca39f3ef1d261c1cb13c1a231c3`)
- Licence: Apache-2.0 (declared in the package's `package.json`; the tarball ships no LICENSE file)

| File | Bytes | From tarball |
|------|------:|--------------|
| `tfjs-backend-wasm/tfjs-backend-wasm.wasm` | 311,123 | `package/dist/tfjs-backend-wasm.wasm` |
| `tfjs-backend-wasm/tfjs-backend-wasm-simd.wasm` | 424,594 | `package/dist/tfjs-backend-wasm-simd.wasm` |

## Total

12,045,607 bytes (about 11.5 MiB) of shipped files, all precached by `sw.js`.
The wasm files (0.7 MB) are only fetched by the library when WebGL is unavailable.

## SHA-256 of shipped files

```
e7c85047fb9492bd983b43d5217b54e9fb44393966f4c5db7c7ced1fdaf1fd9e  human/human.esm.js
cd7bbfc078270572beb39f9e5ae67aadbd50b5e67cff37e6d4f6b3ea39312e5f  human/models/blazeface.json
dc9a97fdc50bc43216554bdd69aa3e7b9361a519ee7bdd996a2f69a98a6f9b72  human/models/blazeface.bin
b60ca26f404724f43bd2b1575761d8265180e1f053cc0731caa68462927309e7  human/models/facemesh.json
3826da640b0a3021161605369ee6af293f75d518040355b960ec71a3390c1c0b  human/models/facemesh.bin
5b83d49c0385d2e68a05122441b94226313677cae9fcc40b9587ad50079eb4df  human/models/faceres.json
2c7d2d62b76c97528b736527aa09d310ea71743c9e3e79fb6c62d4b2d73af79b  human/models/faceres.bin
70a5d516060464e5269f01c74bac1772d6b8ab6cb612acf16b5cdaf61f78d892  tfjs-backend-wasm/tfjs-backend-wasm.wasm
77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b  tfjs-backend-wasm/tfjs-backend-wasm-simd.wasm
```

## Upgrading

Changing the library or any model changes the fingerprints. Update `LIBRARY_VERSION` /
`EMBEDDING_MODEL` in `src/face.js`, the file list in `sw.js` (and bump `CACHE_VERSION`), and this file.
Stored people whose `embeddingModel` differs must be re-embedded from their enrolment photos.
