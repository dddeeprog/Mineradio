const test = require('node:test');
const assert = require('node:assert/strict');

const { createAdaptiveThreeRenderer } = require('../public/folia-native/renderers/adaptive-three');

function fakeRenderer(name, calls, options = {}) {
  return {
    kind: options.kind || name,
    mount(context) {
      calls.push(`${name}:mount`);
      if (options.failMount) throw new Error(`${name} mount failed`);
      this.context = context;
    },
    setDocument(document) {
      calls.push(`${name}:document:${document && document.id}`);
      if (options.failDocument) throw new Error(`${name} document failed`);
    },
    update(frame) {
      calls.push(`${name}:update:${frame && frame.now}`);
      if (options.requestFallbackOnUpdate) options.requestFallback(new Error(`${name} requested fallback`));
      if (options.failUpdate) throw new Error(`${name} update failed`);
    },
    resize(viewport) {
      calls.push(`${name}:resize:${viewport && viewport.width}`);
      if (options.failResize) throw new Error(`${name} resize failed`);
    },
    release() { calls.push(`${name}:release`); },
    resume() { calls.push(`${name}:resume`); },
    captureTransition() {
      calls.push(`${name}:capture`);
      return { kind: `${name}-transition` };
    },
    snapshot() { return { renderer: name }; },
    destroy() { calls.push(`${name}:destroy`); },
  };
}

test('adaptive renderer keeps public classic mode while switching to DOM fallback', () => {
  const calls = [];
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: () => fakeRenderer('three', calls, { failUpdate: true }),
    createFallback: () => fakeRenderer('dom', calls),
  });
  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song', lines: [] });
  renderer.update({ now: 1, lineIndex: 0 });

  assert.equal(renderer.snapshot().backend, '2d-fallback');
  assert.equal(renderer.snapshot().mode, 'classic');
  assert.equal(renderer.kind, 'dom');
  assert.deepEqual(calls, [
    'three:mount', 'three:document:song', 'three:update:1', 'three:destroy',
    'dom:mount', 'dom:document:song', 'dom:update:1',
  ]);
});

test('adaptive renderer falls back when primary mount fails and notifies once per document', () => {
  const calls = [];
  const notices = [];
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: () => fakeRenderer('three', calls, { failMount: true }),
    createFallback: () => fakeRenderer('dom', calls),
    onFallback: detail => notices.push(detail),
  });

  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song', lines: [] });
  renderer.update({ now: 1 });
  renderer.update({ now: 2 });

  assert.equal(renderer.snapshot().backendFallbackCount, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0].reason, /mount/);
  assert.deepEqual(calls.slice(0, 3), ['three:mount', 'three:destroy', 'dom:mount']);
});

test('host context loss callback immediately switches to the same-mode fallback', () => {
  const calls = [];
  let requestFallback;
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: context => {
      requestFallback = context.requestFallback;
      return fakeRenderer('three', calls);
    },
    createFallback: () => fakeRenderer('dom', calls),
  });
  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song', lines: [] });
  renderer.resize({ width: 960, height: 540 });
  renderer.update({ now: 0.5 });

  requestFallback(Object.assign(new Error('context lost'), { code: 'THREE_LYRIC_CONTEXT_LOST' }));

  assert.equal(renderer.snapshot().backend, '2d-fallback');
  assert.deepEqual(calls.slice(-5), [
    'three:destroy', 'dom:mount', 'dom:document:song', 'dom:resize:960', 'dom:update:0.5',
  ]);
});

test('context fallback setup failure escapes on the next runtime call when the host swallows the callback error', () => {
  const calls = [];
  let requestFallback;
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: context => {
      requestFallback = context.requestFallback;
      return fakeRenderer('three', calls);
    },
    createFallback: () => { throw new Error('dom fallback factory failed'); },
  });
  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song', lines: [] });

  try {
    requestFallback(Object.assign(new Error('context lost'), { code: 'THREE_LYRIC_CONTEXT_LOST' }));
  } catch (_) {
    // The Three host catches subscriber errors; the adaptive layer must remember it.
  }

  assert.throws(() => renderer.update({ now: 1 }), /dom fallback factory failed/);
  assert.equal(renderer.snapshot().backend, '2d-fallback');
  assert.deepEqual(calls.slice(-1), ['three:destroy']);
});

test('typed performance fallback switches once without flapping in one document', () => {
  const calls = [];
  let requestFallback;
  let primaryCount = 0;
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: context => {
      primaryCount += 1;
      requestFallback = context.requestFallback;
      return fakeRenderer(`three${primaryCount}`, calls);
    },
    createFallback: () => fakeRenderer('dom', calls),
  });
  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song', fingerprint: 'a', lines: [] });
  renderer.update({ now: 1 });
  requestFallback(Object.assign(new Error('budget exceeded'), { code: 'THREE_LYRIC_PERFORMANCE_FALLBACK' }));
  requestFallback(Object.assign(new Error('again'), { code: 'THREE_LYRIC_PERFORMANCE_FALLBACK' }));
  renderer.setDocument({ id: 'song', fingerprint: 'a', lines: [] });

  assert.equal(primaryCount, 1);
  assert.equal(renderer.snapshot().backendFallbackCount, 1);
  assert.equal(calls.filter(call => call === 'dom:mount').length, 1);
});

test('adaptive renderer retries Three only when a new document arrives', () => {
  const calls = [];
  let primaryCount = 0;
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: () => {
      primaryCount += 1;
      return fakeRenderer(`three${primaryCount}`, calls, { failUpdate: primaryCount === 1 });
    },
    createFallback: () => fakeRenderer('dom', calls),
  });
  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song-a', fingerprint: 'a', lines: [] });
  renderer.update({ now: 1 });
  renderer.setDocument({ id: 'song-a', fingerprint: 'a', lines: [] });
  assert.equal(renderer.snapshot().backend, '2d-fallback');

  renderer.setDocument({ id: 'song-b', fingerprint: 'b', lines: [] });
  renderer.update({ now: 2 });

  assert.equal(primaryCount, 2);
  assert.equal(renderer.snapshot().backend, 'three');
  assert.equal(renderer.kind, 'three2');
  assert.ok(calls.indexOf('dom:destroy') < calls.indexOf('three2:mount'));
});

test('release, resume and transition capture delegate only to the active backend', () => {
  const calls = [];
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: () => fakeRenderer('three', calls),
    createFallback: () => fakeRenderer('dom', calls),
  });
  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song', lines: [] });
  assert.deepEqual(renderer.captureTransition(), { kind: 'three-transition' });
  renderer.release();
  renderer.resume();
  renderer.destroy();
  renderer.destroy();

  assert.deepEqual(calls, [
    'three:mount', 'three:document:song', 'three:capture',
    'three:release', 'three:resume', 'three:destroy',
  ]);
});

test('fallback backend failure escapes to the outer runtime', () => {
  const calls = [];
  const renderer = createAdaptiveThreeRenderer({
    mode: 'classic',
    createPrimary: () => fakeRenderer('three', calls, { failUpdate: true }),
    createFallback: () => fakeRenderer('dom', calls, { failMount: true }),
  });
  renderer.mount({ root: {} });
  renderer.setDocument({ id: 'song', lines: [] });

  assert.throws(() => renderer.update({ now: 1 }), /dom mount failed/);
  assert.equal(renderer.snapshot().backend, '2d-fallback');
});
