# Folia Pure Three.js Classic Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared pure Three.js lyric foundation and migrate Folia 流光 (`classic`) to it while keeping the other six Folia modes on their current 2D renderers.

**Architecture:** Add a single `ThreeLyricHost` beside the existing `stageLyrics.group`, backed by an offscreen glyph atlas, shared material/geometry pools, instanced glyph batches, block planes, managed Three.js transitions, and a quantified performance budget. The public `classic` mode uses the Three.js director first and switches internally to the existing DOM Classic renderer on GPU errors or sustained over-budget frames without changing the saved mode.

**Tech Stack:** Native JavaScript UMD modules, Three.js r128, offscreen Canvas2D, `InstancedMesh`, Node Test, Playwright, Electron/Chromium.

---

## Scope And Guardrails

Design source: `docs/superpowers/specs/2026-07-11-folia-pure-three-lyrics-design.md`.

This plan delivers only the shared core and the 流光 pilot. `cadenza`, `partita`, `tilt`, `monet`, `cappella`, and `fume` remain on their existing DOM/Canvas backends and must not regress.

The current branch contains substantial uncommitted work that this plan depends on. Work in `codex/develop-local-library-migration`, preserve every existing change, and do not create a clean worktree from `HEAD` because it would omit the uncommitted Folia runtime. Commit checkpoints below are conditional: do not stage or commit until the user explicitly authorizes it and the staged diff has been reviewed for pre-existing changes.

Do not add a package dependency, second WebGLRenderer, second visible canvas, AudioContext, or private RAF. Keep Three.js r128 compatibility.

## File Map

### Shared Three.js Core

- Create `public/folia-native/three/performance-budget.js`: deterministic five-second budget windows and degradation state.
- Create `public/folia-native/three/glyph-atlas.js`: offscreen glyph rasterization, atlas packing, leases, LRU, and byte limits.
- Create `public/folia-native/three/material-pool.js`: shared plane geometry and shader material variants.
- Create `public/folia-native/three/glyph-batch.js`: page-grouped `InstancedMesh` glyph rendering and per-instance attributes.
- Create `public/folia-native/three/block-plane.js`: static CanvasTexture plane for translations and future poster/article blocks.
- Create `public/folia-native/three/host.js`: shared scene root, ownership, camera anchor, context events, transition capture, and diagnostics.
- Create `tests/helpers/fake-three.js`: focused Three.js fakes used by Node tests; it is not a test file itself.

### Classic Pilot

- Create `public/folia-native/classic-three-state.js`: pure mapping from the existing Folia Classic model to bounded 3D glyph descriptors.
- Create `public/folia-native/renderers/adaptive-three.js`: primary Three.js plus same-mode 2D fallback lifecycle.
- Create `public/folia-native/renderers/classic-three.js`: Classic Three.js Mode Director.
- Keep `public/folia-native/renderers/classic.js` unchanged as the hidden DOM fallback.
- Keep `public/folia-native/dom-state.js` as the source of Classic deterministic layout and timing.

### Runtime And Integration

- Modify `public/folia-native/runtime.js`: accept renderer-managed transition handles.
- Modify `public/folia-native/state.js`: expose an explicit main-RAF interval in `NativeLyricFrame`.
- Modify `public/index.html`: preload shared core, create one host, wire the Classic adaptive renderer, semantic live region, anchor callback, and diagnostics.
- Modify `public/styles/folia-native.css`: visually hide only the semantic live region.
- Modify `package.json`: syntax-check all new production modules.

### Tests And Documentation

- Modify `tests/folia-native-runtime.test.js`.
- Modify `tests/folia-native-document-layout.test.js`.
- Create `tests/folia-native-three-performance.test.js`.
- Create `tests/folia-native-three-atlas.test.js`.
- Create `tests/folia-native-three-primitives.test.js`.
- Create `tests/folia-native-three-host.test.js`.
- Create `tests/folia-native-classic-three.test.js`.
- Create `tests/folia-native-adaptive-three.test.js`.
- Modify `tests/folia-native-page-integration.test.js`.
- Modify `tests/visual/folia-native.spec.js`.
- Modify `docs/修改日志.md` after verification.

## Task 0: Reconfirm The Dirty Baseline

**Files:** None.

- [ ] **Step 1: Record the current branch and dirty files**

Run:

```powershell
git status --short --branch
```

Expected: branch `codex/develop-local-library-migration`; existing Folia files remain modified/untracked. Save the output in the task notes and do not clean it.

- [ ] **Step 2: Run the pre-change baseline**

Run:

```powershell
npm run check
npm test
npm run test:visual
git diff --check
```

Expected: syntax check passes, 340 Node tests pass, 6 Playwright tests pass, and `git diff --check` prints nothing. If the count has changed because of concurrent user edits, record the new passing baseline before continuing.

- [ ] **Step 3: Confirm the app server**

Use the existing server if `http://127.0.0.1:3180/` responds. Otherwise start the normal project server on a free port and record its URL. Do not stop a user-owned server.

## Task 1: Add Renderer-Managed Three.js Transitions

**Files:**

- Modify: `public/folia-native/runtime.js`
- Modify: `tests/folia-native-runtime.test.js`

- [ ] **Step 1: Write the failing managed-transition test**

Add a test beside the current 340ms DOM transition test:

```js
test('runtime releases a managed Three transition after 340ms without appending DOM', async () => {
  const timers = [];
  const root = new FakeNode('root');
  const registry = createRendererRegistry();
  let releases = 0;

  registry.register('classic', () => () => ({
    kind: 'three',
    mount() {}, setDocument() {}, update() {}, resize() {}, release() {}, destroy() {},
    captureTransition() {
      return { kind: 'managed-three-transition', release() { releases += 1; } };
    },
  }));
  registry.register('mineradio-3d', () => () => createRenderer('3d', [], { kind: 'three' }));

  const runtime = createNativeLyricRuntime({
    registry,
    root,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  });
  await runtime.setMode('classic');
  await runtime.setMode('mineradio-3d');

  assert.equal(root.children.length, 0);
  assert.equal(runtime.snapshot().transitionLayers, 1);
  assert.equal(timers[0].delay, 340);
  timers[0].callback();
  assert.equal(releases, 1);
  assert.equal(runtime.snapshot().transitionLayers, 0);
});
```

Also add one assertion that `runtime.release('background')` calls the managed handle's `release()` exactly once.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/folia-native-runtime.test.js
```

Expected: FAIL because `attachTransition()` attempts to treat the managed handle as a DOM node or does not release it.

- [ ] **Step 3: Implement the managed handle branch**

Add a small type guard and make transition cleanup idempotent:

```js
function isManagedTransition(value) {
  return !!(value && value.kind === 'managed-three-transition' && typeof value.release === 'function');
}

function removeTransition(record) {
  var index = transitionLayers.indexOf(record);
  if (index >= 0) transitionLayers.splice(index, 1);
  if (record && record.release && !record.released) {
    record.released = true;
    try { record.release(); } catch (error) {
      if (options.onError) options.onError(error, { phase: 'release-transition' });
    }
  }
  if (record && record.node && record.node.parentNode) record.node.parentNode.removeChild(record.node);
}
```

In `attachTransition()`, create `{ node: null, release: node.release, released: false }` for a managed handle; keep the existing DOM path unchanged. Both paths use the same 340ms timer and `transitionLayers` accounting.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-runtime.test.js
```

Expected: all runtime tests pass, including existing DOM/canvas transition tests.

- [ ] **Step 5: Review the optional commit checkpoint**

Proposed message: `feat: support managed 3d lyric transitions`

Do not stage in the current dirty workspace without explicit user authorization.

## Task 2: Implement The Quantified Performance Budget

**Files:**

- Create: `public/folia-native/three/performance-budget.js`
- Create: `tests/folia-native-three-performance.test.js`

- [ ] **Step 1: Write failing window and suspension tests**

Cover balanced, battery, resize suspension, one-level-per-ten-seconds, and final fallback:

```js
const { createThreeLyricPerformanceBudget } = require('../public/folia-native/three/performance-budget');

test('performance budget degrades after two consecutive five-second bad windows', () => {
  const budget = createThreeLyricPerformanceBudget({ windowMs: 5000 });
  budget.pushWindowForTest({ p95: 25, quality: 'balanced', endedAt: 5000 });
  budget.pushWindowForTest({ p95: 25, quality: 'balanced', endedAt: 10000 });
  assert.equal(budget.snapshot().level, 1);
  assert.equal(budget.snapshot().fallback, false);
});

test('performance budget reaches fallback only after level three remains over budget', () => {
  const budget = createThreeLyricPerformanceBudget({ windowMs: 5000 });
  for (let window = 0; window < 8; window += 1) {
    budget.pushWindowForTest({ p95: 45, quality: 'balanced', endedAt: (window + 1) * 5000 });
  }
  assert.equal(budget.snapshot().level, 3);
  assert.equal(budget.snapshot().fallback, true);
});
```

Add tests that `suspend(now, 2000)` ignores samples, `resetTrack()` clears fallback, and battery mode uses `40ms` rather than `22ms`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/folia-native-three-performance.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure state machine**

Expose this API:

```js
return {
  push: push,
  suspend: suspend,
  resetTrack: resetTrack,
  snapshot: snapshot,
  pushWindowForTest: pushWindowForTest,
};
```

Use five-second windows, sorted sample p95, thresholds `{ quality: 22, balanced: 22, battery: 40 }`, two consecutive bad windows per level, and four decisions: levels 1, 2, 3, then `fallback: true`. Never auto-recover inside the same track.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
node --test tests/folia-native-three-performance.test.js
```

Expected: all performance-budget tests pass without timers or real waiting.

- [ ] **Step 5: Review the optional commit checkpoint**

Proposed message: `feat: add 3d lyric performance budget`

## Task 3: Build The Bounded Glyph Atlas

**Files:**

- Create: `public/folia-native/three/glyph-atlas.js`
- Create: `tests/folia-native-three-atlas.test.js`

- [ ] **Step 1: Write failing atlas allocation tests**

Inject canvas and texture factories so Node tests do not import Three.js:

```js
test('glyph atlas reuses a grapheme and tracks leases and bytes', () => {
  const disposed = [];
  const atlas = createGlyphAtlas({
    pageSize: 128,
    maxPages: 2,
    createCanvas: fakeCanvasFactory(),
    createTexture: canvas => ({ canvas, dispose() { disposed.push(canvas); } }),
  });
  const first = atlas.acquire('光', { font: 'Noto Sans SC', weight: 700, size: 64 });
  const second = atlas.acquire('光', { font: 'Noto Sans SC', weight: 700, size: 64 });

  assert.equal(first.entry.key, second.entry.key);
  assert.equal(atlas.snapshot().entries, 1);
  assert.equal(atlas.snapshot().leases, 2);
  first.release();
  second.release();
  atlas.trim({ maxPages: 0 });
  assert.equal(disposed.length, 1);
});
```

Add tests for CJK, Latin, a multi-codepoint emoji grapheme, style-key separation, idempotent release, LRU page eviction, `maxBytes`, and `clear({ force: true })`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/folia-native-three-atlas.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement atlas pages and leases**

Use shelf packing per page and return immutable UV/metric entries:

```js
{
  key,
  pageId,
  texture,
  uv: { u0, v0, u1, v1 },
  width,
  height,
  advance,
  bearingX,
  bearingY,
}
```

Normalize the cache key from grapheme, font family, weight, size bucket, stroke, fill mode, language, and DPR bucket. Store page bytes as `width * height * 4`. A page can be evicted only when all leases on that page are released. Mark changed Three.js textures with `needsUpdate = true` but do not upload or redraw on every frame.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
node --test tests/folia-native-three-atlas.test.js
```

Expected: all atlas tests pass and all forced resources are disposed once.

- [ ] **Step 5: Review the optional commit checkpoint**

Proposed message: `feat: add bounded lyric glyph atlas`

## Task 4: Add Shared Three.js Rendering Primitives

**Files:**

- Create: `tests/helpers/fake-three.js`
- Create: `public/folia-native/three/material-pool.js`
- Create: `public/folia-native/three/glyph-batch.js`
- Create: `public/folia-native/three/block-plane.js`
- Create: `tests/folia-native-three-primitives.test.js`

- [ ] **Step 1: Create the minimal fake Three.js helper**

Implement only the classes used by these modules: `Group`, `PlaneGeometry`, `InstancedBufferGeometry`, `InstancedMesh`, `InstancedBufferAttribute`, `ShaderMaterial`, `MeshBasicMaterial`, `Mesh`, `CanvasTexture`, `Matrix4`, `Color`, and disposal counters. The fake `InstancedBufferGeometry` must support `setAttribute()`, `getAttribute()`, `setIndex()`, copying the immutable base quad attributes, and idempotent `dispose()` accounting so tests can prove every batch owns and releases its geometry. Do not duplicate the entire Three.js API.

- [ ] **Step 2: Write failing pooling and reuse tests**

```js
test('glyph batch groups instances by atlas page and reuses capacity', () => {
  const THREE = createFakeThree();
  const pool = createThreeLyricMaterialPool({ THREE });
  const batch = createGlyphBatch({ THREE, materialPool: pool });
  batch.setInstances([
    descriptor('a', 1), descriptor('b', 1), descriptor('光', 2),
  ]);
  const first = batch.snapshot();
  batch.setInstances([descriptor('a', 1), descriptor('光', 2)]);
  const second = batch.snapshot();

  assert.equal(first.drawBatches, 2);
  assert.equal(second.drawBatches, 2);
  assert.equal(second.allocations, first.allocations);
});
```

Add tests that materials are shared per atlas page/variant, custom attributes carry UV/color/glow/progress, block textures redraw only when their content key changes, and `release()` never disposes shared resources while `pool.destroy()` does.

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
node --test tests/folia-native-three-primitives.test.js
```

Expected: FAIL with missing production modules.

- [ ] **Step 4: Implement the material pool**

Create one shared unit plane for block planes and shader variants keyed by atlas page plus blend mode. Each glyph draw batch owns its own `InstancedBufferGeometry` because its UV/tint/glow/progress attributes are batch-specific; it may copy the tiny immutable base quad attributes but must not mutate a geometry shared with another batch. The glyph shader must accept per-instance UV rectangle, tint, opacity, glow, and progress; use `depthWrite: false`, preserve `depthTest`, and keep the lyric render order below interactive shelves.

Core API:

```js
var lease = pool.acquireGlyphMaterial(pageId, texture, 'normal');
lease.material;
lease.release();
pool.snapshot();
pool.destroy();
```

- [ ] **Step 5: Implement glyph batches and block planes**

`glyph-batch.js` groups descriptors by page, creates one batch-owned instanced geometry per page, grows capacities to the next power of two, and updates matrices/attributes in place. `block-plane.js` owns its CanvasTexture and Mesh but borrows the shared block-plane geometry; `setContent(key, draw)` is a no-op for an unchanged key.

- [ ] **Step 6: Run the test and verify GREEN**

Run:

```powershell
node --test tests/folia-native-three-primitives.test.js
```

Expected: all primitive tests pass with exact disposal counts.

- [ ] **Step 7: Review the optional commit checkpoint**

Proposed message: `feat: add shared 3d lyric primitives`

## Task 5: Create ThreeLyricHost And Ownership Boundaries

**Files:**

- Create: `public/folia-native/three/host.js`
- Create: `tests/folia-native-three-host.test.js`
- Modify: `public/folia-native/runtime.js`
- Modify: `tests/folia-native-runtime.test.js`

- [ ] **Step 1: Write failing host ownership tests**

Cover sibling roots, one active scope, idempotent release/destroy, shared-resource survival, transition capture, renderer state restoration, and context events:

```js
test('ThreeLyricHost owns a sibling root and never mutates stageLyrics', () => {
  const THREE = createFakeThree();
  const scene = new THREE.Group();
  const stageLyricsGroup = new THREE.Group();
  scene.add(stageLyricsGroup);
  const host = createThreeLyricHost({ THREE, scene, renderer: fakeRenderer(), camera: fakeCamera() });
  const scope = host.createModeScope('classic');

  assert.equal(scene.children.includes(stageLyricsGroup), true);
  assert.equal(scene.children.includes(host.getRoot()), true);
  assert.notEqual(host.getRoot(), stageLyricsGroup);
  scope.release();
  scope.release();
  host.destroy();
  assert.equal(scene.children.includes(stageLyricsGroup), true);
});
```

Add a transition test that `captureTransition()` returns `{ kind: 'managed-three-transition', release }`, caps target pixels at `1920 * 1080`, restores the previous render target/clear state, and disposes the target after release.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test tests/folia-native-three-host.test.js tests/folia-native-runtime.test.js
```

Expected: host module missing and managed-host integration assertions fail.

- [ ] **Step 3: Implement the host API**

Expose:

```js
{
  createModeScope(mode),
  updateAnchor(frame),
  createGlyphBatch(scope, options),
  createBlockPlane(scope, options),
  captureTransition(scope),
  subscribeContext(listener),
  suspend(reason),
  resume(),
  trim(level),
  snapshot(),
  getRoot(),
  destroy(),
}
```

The host owns `foliaRoot`, `transitionRoot`, atlas, material pool, transition RenderTarget, and context listeners. A mode scope owns one child Group and resource leases. Scope release removes only its child and leases. Host destroy removes host roots and destroys shared resources exactly once.

- [ ] **Step 4: Implement camera-facing transition capture**

Render only the Folia lyric layer into a transparent `WebGLRenderTarget`, save/restore renderer target, clear color/alpha, viewport, scissor, autoClear, and camera layers, then show the target texture on a camera-facing plane for 340ms. The returned managed handle owns this target and plane.

Do not capture background or shelf roots, and do not attach the plane to `stageLyrics.group`.

- [ ] **Step 5: Implement context loss behavior**

Listen on `renderer.domElement` for `webglcontextlost` and `webglcontextrestored`. Prevent the browser default on loss, mark resources invalid, synchronously notify `subscribeContext()` listeners with `{ type: 'lost' }`, and rebuild shared resources before notifying `{ type: 'restored' }`. Do not auto-switch the visible backend from the host; the Classic director forwards the loss to the adaptive renderer's `requestFallback('webgl-context-lost')` callback.

- [ ] **Step 6: Run the tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-three-host.test.js tests/folia-native-runtime.test.js
```

Expected: all ownership, transition, context, and previous runtime tests pass.

- [ ] **Step 7: Review the optional commit checkpoint**

Proposed message: `feat: add shared three lyric host`

## Task 6: Map Existing Classic Semantics Into 3D

**Files:**

- Create: `public/folia-native/classic-three-state.js`
- Create: `tests/folia-native-classic-three.test.js`
- Read/Reuse: `public/folia-native/dom-state.js`

- [ ] **Step 1: Write failing deterministic mapping tests**

```js
test('Classic 3D reuses Folia timing and produces bounded deterministic depth', () => {
  const line = lyricLine('流光 穿过 city lights');
  const options = {
    viewport: { width: 1366, height: 768 },
    worldPerPixel: 0.006,
    config: { intensity: 'chaotic', spread: 1, wordGlow: 0.8, breathing: 1 },
    measureText: text => Array.from(text).length * 42,
  };
  const first = buildClassicThreeModel(line, options);
  const second = buildClassicThreeModel(line, options);

  assert.deepEqual(first, second);
  assert.equal(first.glyphs.every(glyph => Math.abs(glyph.z) <= 0.28), true);
  assert.equal(first.glyphs.some(glyph => glyph.z !== 0), true);
  assert.equal(first.glyphs.map(glyph => glyph.char).join('').replace(/\s/g, ''), line.fullText.replace(/\s/g, ''));
});
```

Add tests for calm mode zero spread, normal/fast/instant timing, grapheme glow tails, waiting/active/passed transforms, reduced motion, chorus ripple, translation bounds, emoji grapheme integrity, long-line safe-area fit, and no orbit/radial displacement field.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/folia-native-classic-three.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure model adapter**

Call `buildClassicLineModel()` and `resolveClassicLineFrame()` rather than duplicating Folia timing. Convert measured pixel positions to local world units using `worldPerPixel`; derive deterministic shallow Z from the existing item key and intensity:

```js
var depthLimit = intensity === 'calm' ? 0 : intensity === 'chaotic' ? 0.28 : 0.12;
var z = depthLimit ? (seededSigned(item.key + ':' + graphemeIndex) * depthLimit) : 0;
```

Return a model containing glyph descriptors, translation block, ripple descriptor, projected bounds, and cache key. The frame resolver returns only matrices/state/glow/progress for the current time.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
node --test tests/folia-native-classic-three.test.js tests/folia-native-dom-modes.test.js
```

Expected: all new 3D mapping tests and all existing Classic DOM model tests pass.

- [ ] **Step 5: Preserve the AGPL source header**

The new state module must state that it adapts the pinned Folia behavior from commit `baa5e846b7404f1893e8b7812bca79e959f21d3f` under AGPL-3.0-or-later.

- [ ] **Step 6: Review the optional commit checkpoint**

Proposed message: `feat: map classic lyrics into 3d space`

## Task 7: Implement Classic Three Director And Same-Mode Fallback

**Files:**

- Create: `public/folia-native/renderers/adaptive-three.js`
- Create: `public/folia-native/renderers/classic-three.js`
- Create: `tests/folia-native-adaptive-three.test.js`
- Modify: `tests/folia-native-classic-three.test.js`
- Read/Reuse: `public/folia-native/renderers/classic.js`

- [ ] **Step 1: Write failing adaptive lifecycle tests**

```js
test('adaptive renderer keeps public classic mode while switching to DOM fallback', () => {
  const calls = [];
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: ({ requestFallback }) => fakeRenderer('three', calls, { failUpdate: true, requestFallback }),
    createFallback: () => fakeRenderer('dom', calls),
  });
  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song', lines: [] });
  renderer.update({ now: 1, lineIndex: 0 });

  assert.equal(renderer.snapshot().backend, '2d-fallback');
  assert.equal(renderer.snapshot().mode, 'classic');
  assert.deepEqual(calls, [
    'three:mount', 'three:document', 'three:update', 'three:destroy',
    'dom:mount', 'dom:document', 'dom:update',
  ]);
});
```

Add tests for mount failure, a host context-loss callback invoking immediate fallback, performance fallback, one notification, release/resume, no fallback flapping in one document, retry on next document, dynamic `kind`, and failure of both backends escaping to the outer runtime.

- [ ] **Step 2: Run adaptive tests and verify RED**

Run:

```powershell
node --test tests/folia-native-adaptive-three.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the adaptive wrapper**

The wrapper stores the latest document, viewport, and frame. It creates the primary with `{ requestFallback }`; this callback immediately executes the same switch path when the host reports `webglcontextlost`. The wrapper also catches primary mount/update/resize exceptions and typed performance fallback errors, destroys the primary, mounts the already-loaded 2D fallback, replays document/viewport/current frame, and reports:

```js
snapshot() {
  return Object.assign({}, active.snapshot(), {
    mode: mode,
    backend: usingFallback ? '2d-fallback' : 'three',
    backendFallbackCount: fallbackCount,
  });
}
```

Expose `kind` as a getter returning the active backend kind (`three` or the fallback's kind), so `nativeLyricRuntime.snapshot().rendererKind` remains accurate. Do not call or patch native lyric configuration. Retry Three only after a new document or explicit new renderer instance.

- [ ] **Step 4: Write the failing Classic director lifecycle test**

Use a fake host and assert `mount -> setDocument -> update -> resize -> captureTransition -> release -> resume -> update -> destroy` creates one scope, preheats current/next lines, updates the batch in place, updates translation/ripple, releases every lease exactly once, and creates a fresh scope after resume.

- [ ] **Step 5: Run the Classic director test and verify RED**

Run:

```powershell
node --test tests/folia-native-classic-three.test.js
```

Expected: FAIL because the renderer module does not exist.

- [ ] **Step 6: Implement the Classic director**

Use the existing renderer contract. On each frame:

1. Update host anchor from the current camera/frame.
2. Build or reuse the current line model keyed by line/config/theme/viewport.
3. Preheat `frame.nextLine` without mounting it.
4. Resolve current glyph descriptors and update one page-grouped glyph batch.
5. Update the optional translation block and chorus ripple.
6. Feed the explicit main-loop `frame.rafDeltaMs` into the performance budget; do not derive it from playback time or audio position.
7. Throw a typed fallback error only when the budget reaches fallback.

`mount()` and `resume()` both call one internal `acquireScope()` helper. `release()` removes the scope, unsubscribes context notifications, and clears private GPU handles while retaining document/viewport data needed by the outer runtime's resume replay. `resume()` acquires a new scope and resubscribes before the runtime reapplies document and viewport. `captureTransition()` delegates to the current host scope. `destroy()` is idempotent and removes any remaining context listener.

- [ ] **Step 7: Run renderer tests and verify GREEN**

Run:

```powershell
node --test tests/folia-native-adaptive-three.test.js tests/folia-native-classic-three.test.js
```

Expected: all adaptive and Classic director tests pass.

- [ ] **Step 8: Review the optional commit checkpoint**

Proposed message: `feat: render classic lyrics with three js`

## Task 8: Wire The Pilot Into Mineradio

**Files:**

- Modify: `public/folia-native/state.js`
- Modify: `public/index.html`
- Modify: `public/styles/folia-native.css`
- Modify: `package.json`
- Modify: `tests/folia-native-document-layout.test.js`
- Modify: `tests/folia-native-page-integration.test.js`

- [ ] **Step 1: Write failing page-integration assertions**

Replace only the `classic` expectations in the current combined DOM-renderer test. Assert:

```js
assert.match(html, /folia-native\/three\/performance-budget\.js/);
assert.match(html, /folia-native\/three\/glyph-atlas\.js/);
assert.match(html, /folia-native\/three\/host\.js/);
assert.match(html, /function createNativeThreeLyricHost\(/);
assert.match(html, /folia-native\/renderers\/classic-three\.js/);
assert.match(html, /folia-native\/renderers\/adaptive-three\.js/);
assert.match(html, /id="native-lyric-live"/);
assert.doesNotMatch(html, /renderer\.domElement\.style\.pointerEvents = visible/);
```

Read `public/folia-native/renderers/adaptive-three.js` in the test and assert that file contains `backendFallbackCount`; do not look for the implementation string in `index.html`. Keep Partita/Tilt DOM assertions intact. Add an assertion that Classic's loader still includes `renderers/classic.js` as fallback and does not register a second public mode ID.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/folia-native-page-integration.test.js
```

Expected: FAIL because the scripts, host factory, and live region are absent.

- [ ] **Step 3: Add scripts and syntax checks**

Load the shared Three modules after `folia-native/runtime.js` and before renderer adapters. Append every new production file to `npm run check` in dependency order. Keep Classic-specific state/director scripts lazy-loaded.

Also extend `buildNativeLyricFrame()` with:

```js
rafDeltaMs: Math.max(0, finite(input.rafDeltaMs, finite(input.dt, 0) * 1000)),
```

Pass `rafDeltaMs: dt * 1000` from `updateNativeLyricRuntime(dt)`. Add a Node test proving this field is finite, non-negative, and independent of the song's `now` value.

- [ ] **Step 4: Add the host factory and camera anchor**

In `index.html`, create one `nativeThreeLyricHost` after `scene`, `camera`, and `renderer` exist. The anchor callback uses the current camera direction/quaternion and the same `4.85` world-distance baseline as camera-locked Mineradio lyrics, scales from the native lyric common scale, and reports shelf-open/safe-region state. It must not call `updateStageLyrics3D()` or mutate `stageLyrics.group`.

Pass the host and fallback notification callback through the Classic factory closure. The adaptive wrapper handles same-mode fallback internally; only failure of both backends reaches the existing runtime fallback to Mineradio.

- [ ] **Step 5: Update Classic registration**

The public ID remains `classic`. Its lazy script list includes, in dependency order:

```js
'folia-native/dom-state.js',
'folia-native/classic-three-state.js',
'folia-native/renderers/shared-dom.js',
'folia-native/renderers/classic.js',
'folia-native/renderers/adaptive-three.js',
'folia-native/renderers/classic-three.js'
```

The exported Classic Three factory creates both the primary director and existing Classic fallback.

- [ ] **Step 6: Add the semantic live region**

Add one `role="status" aria-live="polite" aria-atomic="true"` element beside `#native-lyric-root`. Update it only when the active line or translation changes. Use a dedicated visually-hidden CSS rule; do not hide it with `display:none` or `aria-hidden`.

- [ ] **Step 7: Extend diagnostics and visual-budget lifecycle**

Merge host stats into the active renderer snapshot: backend, atlas pages/bytes, glyph instances, draw batches, transition layers, degradation level, and backend fallback count. On background release, the active director releases its scope and the host trims shared caches. Runtime resume first calls `host.resume()`, then the renderer's `resume()` recreates its scope, then the existing runtime reapplies document and viewport. Add an integration test for this exact order.

- [ ] **Step 8: Add final host teardown**

Create one idempotent `destroyNativeLyricRuntime()` function. It must call `nativeLyricRuntime.destroy()` first, then `nativeThreeLyricHost.destroy()`, clear both globals, and be registered once on `pagehide`/application teardown. Add page-integration assertions for the function and call order. Do not destroy the host during ordinary mode switches.

- [ ] **Step 9: Run integration checks and verify GREEN**

Run:

```powershell
node --test tests/folia-native-page-integration.test.js tests/folia-native-document-layout.test.js tests/folia-native-runtime.test.js tests/folia-native-3d-adapter.test.js
npm run check
```

Expected: targeted tests and all syntax checks pass.

- [ ] **Step 10: Review the optional commit checkpoint**

Proposed message: `feat: integrate classic three lyric pilot`

## Task 9: Replace Classic DOM Visual Assertions With Three.js Acceptance

**Files:**

- Modify: `tests/visual/folia-native.spec.js`
- Modify: `playwright.folia.config.js` only if the existing project list cannot run the new mobile viewport or GC flag.

- [ ] **Step 1: Add failing Classic Three diagnostics**

Update `rendererDiagnostics()` so the shared renderer canvas is sampled for both `mineradio-3d` and `classic`. For Classic, collect:

```js
classicThree: expectedMode === 'classic' ? {
  backend: snapshot.backend,
  rendererKind: snapshot.rendererKind,
  glyphInstances: snapshot.glyphInstances,
  drawBatches: snapshot.drawBatches,
  atlasPages: snapshot.atlasPages,
  atlasBytes: snapshot.atlasBytes,
  rippleCount: snapshot.rippleCount,
  layoutBounds: snapshot.layoutBounds,
  layerSignal: window.__captureNativeThreeLyricLayerStats(),
} : null
```

Replace the current `.native-classic-line` DOM test with a test named `Classic pure Three preserves Folia timing and live tuning`.

- [ ] **Step 2: Add the failing layer pixel and motion assertions**

At `1366x768`, assert:

- backend is `three` and `rendererKind` is `three`;
- `#native-lyric-root` has no visible Classic children;
- layer alpha coverage is greater than `0.005`;
- glyph matrices/progress differ after `250ms` of playing;
- paused matrices remain stable after `500ms`, excluding configured breathing;
- disabling `wordGlow` and `chorusRipple` reduces glow to zero and ripple count to zero;
- projected main/translation bounds remain inside the safe area and do not intersect.

- [ ] **Step 3: Add the mobile viewport**

Add `{ name: '390x844', width: 390, height: 844 }` to the viewport fixtures. For the pilot, require Classic and Mineradio Three screenshots/pixel checks at this viewport; keep existing 2D modes on their current responsive assertions.

Add an explicit backend map for untouched modes and assert it at every desktop viewport:

```js
const untouchedBackends = {
  cadenza: 'canvas-dom',
  partita: 'dom',
  tilt: 'dom',
  monet: 'dom-canvas',
  cappella: 'dom',
  fume: 'canvas2d',
};
```

Their existing text/canvas/material assertions must continue to pass; this pilot must not silently route any of them through the new host.

- [ ] **Step 4: Add a real shelf click regression**

In the fixture, build at least one shelf card, render Classic Three, project the center card's world position with `currentShelfRenderCamera()`, and call `page.mouse.click(x, y)`. Assert the card action changes `currentIdx` or opens shelf content. Also assert the lyric root is absent from `shelfManager.getRenderRoots()` and the shared canvas retains pointer events.

- [ ] **Step 5: Update the 4K classification**

Treat both `mineradio-3d` and `classic` as Three boundaries:

```js
const pilotThreeModes = new Set(['mineradio-3d', 'classic']);
const touchesThree = entry => pilotThreeModes.has(entry.mode) || pilotThreeModes.has(entry.previousMode);
```

Assert `atlasBytes` stays within the configured host limit, managed transitions return to zero, active renderer count is one, and the existing software-WebGL threshold remains separate from physical-GPU 4K acceptance.

- [ ] **Step 6: Run the focused visual test and verify RED**

Run:

```powershell
npm run test:visual -- --grep "Classic pure Three|390x844|shelf click|4K warmed"
```

Expected before final fixture adjustments: at least the new Classic/backend or pixel assertions fail. Do not weaken pixel thresholds to make a blank layer pass.

- [ ] **Step 7: Make only fixture/diagnostic corrections needed for GREEN**

Fix deterministic fixture timing, render-target readback, or safe-area reporting. If the production renderer is visually blank, return to Task 7; do not hide the failure in the test.

- [ ] **Step 8: Run all visual tests and inspect screenshots**

Run:

```powershell
npm run test:visual
```

Expected: all Playwright tests pass. Inspect Classic screenshots at `390x844`, `960x540`, `1366x768`, and `1920x1080` for readable text, real depth, nonblank pixels, no overlap, and visible/clickable shelves.

- [ ] **Step 9: Run the physical-GPU performance capture**

On the reference RTX 5060 machine, run the packaged or equivalent Electron/Chromium fixture for fifteen seconds after a two-second warmup. Record OS, CPU, GPU, driver, Electron/Chromium, WebGL renderer, average FPS, RAF p95, long tasks, atlas bytes, draw batches, and heap growth. Required pilot lines:

- 1080p balanced: average `>=57FPS`, p95 `<=22ms`.
- 4K quality: average `>=57FPS`, p95 `<=22ms`.
- battery: average `>=29FPS`, p95 `<=40ms`.

Software WebGL is functional evidence only and cannot satisfy the hardware line.

Write the reproducible evidence to `screenshots/folia-native/classic-three-reference-performance.json`. Required fields are `timestamp`, `os`, `cpu`, `gpu`, `driver`, `electron`, `chromium`, `webglRenderer`, `viewport`, `quality`, `warmupMs`, `sampleMs`, `averageFps`, `p95RafMs`, `longTaskMs`, `maxLongTaskMs`, `atlasPages`, `atlasBytes`, `drawBatches`, `heapBefore`, `heapAfter`, and `heapGrowth`.

- [ ] **Step 10: Review the optional commit checkpoint**

Proposed message: `test: verify classic three lyric pilot`

## Task 10: Full Verification And Handoff

**Files:**

- Modify: `docs/修改日志.md`
- Verify: all files listed above

- [ ] **Step 1: Run the complete Node suite**

Run:

```powershell
npm test
```

Expected: the baseline 340 tests plus all newly added tests pass. Record the exact final count.

- [ ] **Step 2: Run all static and visual checks**

Run:

```powershell
npm run check
npm run test:visual
git diff --check
```

Expected: all pass; `git diff --check` prints nothing.

- [ ] **Step 3: Verify artifacts and Windows build**

Run:

```powershell
npm run verify:artifacts
npm run build:win:dir
```

Expected: artifact verification and unpacked Windows build pass. Existing warnings about disabled asar/signing may remain if unchanged.

- [ ] **Step 4: Inspect ownership after twenty switches**

Confirm the final performance snapshot reports:

```text
mode=classic
backend=three
activeRenderers=1
transitionLayers=0
backendFallbackCount=0
atlasBytes<=configured limit
```

After forced context loss, separately confirm `mode=classic`, `backend=2d-fallback`, unchanged saved mode, and uninterrupted playback.

Call `destroyNativeLyricRuntime()` in a teardown fixture and confirm the host root leaves the scene, context listeners are removed, and shared textures/materials/geometries are disposed once while `stageLyrics.group` remains owned by Mineradio.

- [ ] **Step 5: Update the Chinese changelog**

Add one dated entry describing the shared Three.js lyric host, Classic pilot, hidden same-mode fallback, diagnostics, visual tests, and exact verification results. Do not claim the other six Folia modes are 3D.

- [ ] **Step 6: Review the final diff**

Run:

```powershell
git status --short
git diff --stat
git diff -- public/folia-native public/index.html public/styles/folia-native.css tests package.json docs/修改日志.md
```

Expected: only planned edits plus pre-existing user changes remain; no unrelated refactor, asset deletion, or metadata churn.

- [ ] **Step 7: Optional final commit after explicit authorization**

Because the branch started dirty, first review `git diff --cached` and ensure no pre-existing user work is accidentally included. Proposed final message if the user explicitly requests a commit:

```powershell
git commit -m "feat: add classic pure three lyric pilot"
```

## Pilot Exit Criteria

Do not start the Partita/Tilt batch until all of these are true:

- Classic normally reports `backend=three`; forced failure reports `backend=2d-fallback` while saved mode remains `classic`.
- Classic retains deterministic Folia layout, normal/fast/instant timing, word glow, breathing, and chorus ripple.
- No Classic visual DOM nodes remain during normal 3D operation; only the shared semantic live region remains.
- The shared renderer, background, cover particles, record shelf, and playlist shelf remain visible and clickable.
- Managed transition resources are released after 340ms and twenty switches leave one active renderer.
- Atlas, heap, draw batches, long tasks, 1080p, 4K, and battery targets meet the approved spec.
- Full Node, Playwright, artifact, and Windows build verification passes.

After this gate, write the next implementation plan for Partita and Tilt using the stable host APIs rather than expanding this pilot while it is still under validation.
