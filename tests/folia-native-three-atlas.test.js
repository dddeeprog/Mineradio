const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGlyphAtlas,
} = require('../public/folia-native/three/glyph-atlas');

function fakeCanvasFactory(metricsOverride) {
  return (width, height) => {
    const calls = [];
    const context = {
      calls,
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      textAlign: 'left',
      textBaseline: 'alphabetic',
      measureText(text) {
        const chars = Array.from(String(text || ''));
        const visualUnits = String(text || '').includes('\u200d') ? 1 : chars.length;
        const fontMatch = String(this.font).match(/([0-9.]+)px/);
        const size = fontMatch ? Number(fontMatch[1]) : 32;
        const widthFactor = chars.some(char => /[^\u0000-\u00ff]/.test(char)) ? 0.92 : 0.58;
        const metrics = {
          width: Math.max(1, visualUnits * size * widthFactor),
          actualBoundingBoxAscent: size * 0.78,
          actualBoundingBoxDescent: size * 0.22,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: Math.max(1, visualUnits * size * widthFactor),
        };
        const override = typeof metricsOverride === 'function'
          ? metricsOverride({ text, font: this.font, size, metrics })
          : metricsOverride;
        return override && typeof override === 'object' ? { ...metrics, ...override } : metrics;
      },
      clearRect() {},
      save() {},
      restore() {},
      fillText(text, x, y) { calls.push(['fill', text, x, y]); },
      strokeText(text, x, y) { calls.push(['stroke', text, x, y]); },
    };
    return {
      width,
      height,
      getContext(kind) { return kind === '2d' ? context : null; },
    };
  };
}

function textureFactory(disposed) {
  return canvas => ({
    canvas,
    needsUpdate: false,
    disposeCount: 0,
    dispose() {
      this.disposeCount += 1;
      disposed.push(canvas);
    },
  });
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, message || `${actual} !== ${expected}`);
}

test('glyph atlas reuses a grapheme and tracks leases and bytes', () => {
  const disposed = [];
  const atlas = createGlyphAtlas({
    pageSize: 128,
    maxPages: 2,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory(disposed),
  });

  const first = atlas.acquire('光', { fontFamily: 'Noto Sans SC', weight: 700, size: 40 });
  const second = atlas.acquire('光', { fontFamily: 'Noto Sans SC', weight: 700, size: 40 });

  assert.equal(first.entry.key, second.entry.key);
  assert.equal(first.entry.pageId, second.entry.pageId);
  assert.equal(atlas.snapshot().entries, 1);
  assert.equal(atlas.snapshot().leases, 2);
  assert.equal(atlas.snapshot().bytes, 128 * 128 * 4);
  assert.ok(first.entry.uv.v0 > 0.5);
  assert.ok(first.entry.uv.v0 < first.entry.uv.v1);
  first.release();
  second.release();
  atlas.trim({ maxPages: 0 });
  assert.equal(disposed.length, 1);
  assert.equal(atlas.snapshot().pages, 0);
});

test('glyph atlas keeps CJK Latin and multi-codepoint emoji entries intact', () => {
  const atlas = createGlyphAtlas({
    pageSize: 256,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory([]),
  });
  const leases = [
    atlas.acquire('流', { size: 42, language: 'zh' }),
    atlas.acquire('A', { size: 42, language: 'en' }),
    atlas.acquire('👨‍👩‍👧‍👦', { size: 42, language: 'emoji' }),
  ];

  assert.deepEqual(leases.map(lease => lease.entry.grapheme), ['流', 'A', '👨‍👩‍👧‍👦']);
  assert.equal(atlas.snapshot().entries, 3);
  assert.equal(leases.every(lease => lease.entry.width > 0 && lease.entry.height > 0), true);
  leases.forEach(lease => lease.release());
});

test('glyph atlas keeps a complete CSS font family stack syntactically valid', () => {
  const atlas = createGlyphAtlas({
    pageSize: 256,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory([]),
  });
  const lease = atlas.acquire('光', {
    fontFamily: '"Noto Serif SC", "Source Han Serif SC", serif',
    weight: 850,
    size: 64,
    glowPadding: 10,
    dpr: 1.5,
  });
  const context = lease.entry.texture.canvas.getContext('2d');

  assert.equal(context.font, '850 96.00px "Noto Serif SC", "Source Han Serif SC", serif');
  assert.doesNotMatch(context.font, /px "Noto Serif SC, Source Han Serif SC, serif"$/);
  lease.release();
});

test('glyph atlas keeps left ink and strokes inside the raster content rectangle', () => {
  const pageSize = 256;
  const dpr = 2;
  const strokeWidth = 2;
  const metrics = {
    width: 30,
    actualBoundingBoxAscent: 20,
    actualBoundingBoxDescent: 6,
    actualBoundingBoxLeft: 7,
    actualBoundingBoxRight: 28,
  };
  const atlas = createGlyphAtlas({
    pageSize,
    createCanvas: fakeCanvasFactory(metrics),
    createTexture: textureFactory([]),
  });
  const lease = atlas.acquire('J', { size: 20, strokeWidth, glowPadding: 3, dpr });
  const entry = lease.entry;
  const context = entry.texture.canvas.getContext('2d');
  const rasterStroke = strokeWidth * dpr;
  const expectedContentWidth = Math.ceil(Math.max(
    metrics.width,
    metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
  ) + rasterStroke * 2);
  const contentX = entry.uv.u0 * pageSize;
  const rasterContentWidth = (entry.uv.u1 - entry.uv.u0) * pageSize;
  const strokeCall = context.calls.find(call => call[0] === 'stroke');
  const fillCall = context.calls.find(call => call[0] === 'fill');
  const expectedBaselineX = contentX + metrics.actualBoundingBoxLeft + rasterStroke;

  assertClose(rasterContentWidth, expectedContentWidth);
  assertClose(entry.width, expectedContentWidth / dpr);
  assertClose(strokeCall[2], expectedBaselineX);
  assertClose(fillCall[2], expectedBaselineX);
  assertClose(expectedBaselineX - metrics.actualBoundingBoxLeft - rasterStroke, contentX);
  assert.ok(
    expectedBaselineX + metrics.actualBoundingBoxRight + rasterStroke <= contentX + rasterContentWidth,
  );
  assert.equal(entry.bearingX, -metrics.actualBoundingBoxLeft / dpr);
  assert.equal(context.lineWidth, rasterStroke);
  lease.release();
});

test('glyph atlas exposes symmetric padded sample rectangles in CSS units', () => {
  const pageSize = 256;
  const dpr = 1.5;
  const atlas = createGlyphAtlas({
    pageSize,
    padding: 4,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory([]),
  });
  const lease = atlas.acquire('光', { size: 64, glowPadding: 10, dpr });
  const entry = lease.entry;

  assert.ok(entry.sampleUv);
  assert.ok(entry.sampleClampUv);
  assert.equal(entry.glowPadding, 10);
  assert.ok(entry.sampleUv.u0 <= entry.uv.u0 && entry.sampleUv.v0 <= entry.uv.v0);
  assert.ok(entry.sampleUv.u1 >= entry.uv.u1 && entry.sampleUv.v1 >= entry.uv.v1);
  const halfTexel = 0.5 / pageSize;
  assert.notEqual(entry.sampleClampUv, entry.sampleUv);
  assertClose(entry.sampleClampUv.u0, entry.sampleUv.u0 + halfTexel);
  assertClose(entry.sampleClampUv.v0, entry.sampleUv.v0 + halfTexel);
  assertClose(entry.sampleClampUv.u1, entry.sampleUv.u1 - halfTexel);
  assertClose(entry.sampleClampUv.v1, entry.sampleUv.v1 - halfTexel);
  assert.ok(entry.sampleClampUv.u0 <= entry.sampleClampUv.u1);
  assert.ok(entry.sampleClampUv.v0 <= entry.sampleClampUv.v1);
  assert.ok(entry.sampleClampUv.u0 <= entry.uv.u0 && entry.sampleClampUv.v0 <= entry.uv.v0);
  assert.ok(entry.sampleClampUv.u1 >= entry.uv.u1 && entry.sampleClampUv.v1 >= entry.uv.v1);
  assertClose((entry.sampleUv.u0 + entry.sampleUv.u1) / 2, (entry.uv.u0 + entry.uv.u1) / 2);
  assertClose((entry.sampleUv.v0 + entry.sampleUv.v1) / 2, (entry.uv.v0 + entry.uv.v1) / 2);
  assertClose(entry.sampleWidth - entry.width, 20);
  assertClose(entry.sampleHeight - entry.height, 20);
  assertClose(entry.width, (entry.uv.u1 - entry.uv.u0) * pageSize / dpr);
  assertClose(entry.height, (entry.uv.v1 - entry.uv.v0) * pageSize / dpr);
  assertClose(entry.sampleWidth, (entry.sampleUv.u1 - entry.sampleUv.u0) * pageSize / dpr);
  assertClose(entry.sampleHeight, (entry.sampleUv.v1 - entry.sampleUv.v0) * pageSize / dpr);
  lease.release();
});

test('glyph atlas reports requested CSS glow padding independently from raster quantization', () => {
  const pageSize = 256;
  const dpr = 1.5;
  const atlas = createGlyphAtlas({
    pageSize,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory([]),
  });
  const lease = atlas.acquire('A', { size: 32, glowPadding: 3, dpr });
  const entry = lease.entry;

  assert.equal(entry.glowPadding, 3);
  assertClose((entry.uv.u0 - entry.sampleUv.u0) * pageSize, 5);
  assertClose((entry.sampleUv.u1 - entry.uv.u1) * pageSize, 5);
  assertClose((entry.uv.v0 - entry.sampleUv.v0) * pageSize, 5);
  assertClose((entry.sampleUv.v1 - entry.uv.v1) * pageSize, 5);
  assertClose(entry.sampleWidth - entry.width, 10 / dpr);
  assertClose(entry.sampleHeight - entry.height, 10 / dpr);
  lease.release();
});

test('glyph atlas separates entries by normalized visual style', () => {
  const atlas = createGlyphAtlas({
    pageSize: 256,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory([]),
  });
  const regular = atlas.acquire('光', { fontFamily: 'Noto Sans SC', weight: 400, size: 40, dpr: 1 });
  const bold = atlas.acquire('光', { fontFamily: 'Noto Sans SC', weight: 700, size: 40, dpr: 1 });
  const highDpr = atlas.acquire('光', { fontFamily: 'Noto Sans SC', weight: 400, size: 40, dpr: 2 });
  const padded = atlas.acquire('光', { fontFamily: 'Noto Sans SC', weight: 400, size: 40, dpr: 2, glowPadding: 10 });

  assert.notEqual(regular.entry.key, bold.entry.key);
  assert.notEqual(regular.entry.key, highDpr.entry.key);
  assert.notEqual(highDpr.entry.key, padded.entry.key);
  assert.equal(padded.entry.glowPadding, 10);
  assertClose((padded.entry.uv.u0 - padded.entry.sampleUv.u0) * 256, 20);
  assertClose((padded.entry.sampleUv.u1 - padded.entry.uv.u1) * 256, 20);
  assertClose(padded.entry.sampleWidth - padded.entry.width, 20);
  assertClose(padded.entry.sampleHeight - padded.entry.height, 20);
  assert.equal(atlas.snapshot().entries, 4);
  regular.release();
  bold.release();
  highDpr.release();
  padded.release();
});

test('glyph atlas evicts the least-recent unlocked page within page and byte limits', () => {
  const disposed = [];
  const atlas = createGlyphAtlas({
    pageSize: 64,
    padding: 4,
    maxPages: 1,
    maxBytes: 64 * 64 * 4,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory(disposed),
  });
  const first = atlas.acquire('光', { size: 48, weight: 700 });
  const firstPage = first.entry.pageId;
  first.release();

  const second = atlas.acquire('影', { size: 48, weight: 700 });
  assert.notEqual(second.entry.pageId, firstPage);
  assert.equal(disposed.length, 1);
  assert.equal(atlas.snapshot().pages, 1);
  assert.equal(atlas.snapshot().bytes <= 64 * 64 * 4, true);
  second.release();
});

test('glyph atlas never evicts a leased page and reports capacity exhaustion', () => {
  const atlas = createGlyphAtlas({
    pageSize: 64,
    padding: 4,
    maxPages: 1,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory([]),
  });
  const locked = atlas.acquire('光', { size: 48, weight: 700 });

  assert.throws(
    () => atlas.acquire('影', { size: 48, weight: 700 }),
    error => error && error.code === 'GLYPH_ATLAS_CAPACITY',
  );
  assert.equal(atlas.snapshot().pages, 1);
  locked.release();
});

test('glyph atlas release and forced clear are idempotent', () => {
  const disposed = [];
  const atlas = createGlyphAtlas({
    pageSize: 128,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory(disposed),
  });
  const lease = atlas.acquire('光', { size: 40 });

  lease.release();
  lease.release();
  assert.equal(atlas.snapshot().leases, 0);
  atlas.clear({ force: true });
  atlas.clear({ force: true });
  assert.equal(disposed.length, 1);
  assert.equal(atlas.snapshot().pages, 0);
  assert.equal(atlas.snapshot().entries, 0);
});

test('glyph atlas reports every retired page so dependent GPU resources can be released', () => {
  const retiredPages = [];
  const atlas = createGlyphAtlas({
    pageSize: 128,
    createCanvas: fakeCanvasFactory(),
    createTexture: textureFactory([]),
    onDisposePage(pageId) { retiredPages.push(pageId); },
  });
  const lease = atlas.acquire('光', { size: 40 });
  const pageId = lease.entry.pageId;

  lease.release();
  atlas.trim({ maxPages: 0 });
  atlas.clear({ force: true });
  assert.deepEqual(retiredPages, [pageId]);
});
