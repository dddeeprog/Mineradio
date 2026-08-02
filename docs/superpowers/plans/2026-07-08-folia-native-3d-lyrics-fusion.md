# Folia Native 3D Lyrics Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Folia's timed lyric effects into Mineradio's native 3D dynamic lyrics without embedding the full Folia React visualizer in the main player.

**Architecture:** Keep Folia iframe stage support as-is. Add small browser/CommonJS helper modules that convert Mineradio lyric lines into a Folia-like timing model, then expose deterministic visual calculations for sweep highlight, glow envelope, current-line focus, and Claddagh-style orbit placement. Wire those helpers into the existing `stageLyrics` mesh pipeline in `public/index.html`.

**Tech Stack:** Plain browser JavaScript, Node test runner, Three.js already loaded by `public/index.html`, existing Mineradio Folia FX state helpers, existing `npm run check` and `npm test`.

---

## Scope

This plan is only for the native Mineradio dynamic lyrics layer. It does not migrate Folia's full React renderer, routing, player state, local library UI, or iframe stage implementation.

The integration target is:

- Preserve current `Folia 歌词舞台` iframe behavior.
- Add Folia-inspired native 3D lyric effects to Mineradio's existing `stageLyrics` renderer.
- Reuse existing controls where possible: `wordHighlight`, `currentLineFocus`, `glow`, `blur`, `particleAmount`, `beatMotion`, `cameraMotion`, `performanceMode`, `reduceMotion`.
- Add only one new user-facing mode field: `nativeLyricEffect`.

## Files

- Create: `public/folia-native-lyric-state.js`
  - Pure adapter for line/word/grapheme timing, render hints, and active/passed/waiting state.
- Create: `public/folia-native-lyric-visuals.js`
  - Pure visual model for Monet-style sweep, Cadenza-style glow envelope, and Claddagh-style orbit layout.
- Modify: `public/folia-fx-state.js`
  - Add `nativeLyricEffect` and normalize it.
- Modify: `public/index.html`
  - Load new helpers.
  - Add native lyric effect controls.
  - Wire helpers into `stageLyrics`, `getLyricLineProgress`, `showStageLine`, `buildLyricMesh`, `updateStageLyrics3D`, and `tickLyricsParticles`.
- Modify: `package.json`
  - Add `node --check` for the two new helper modules.
- Test: `tests/folia-native-lyric-state.test.js`
- Test: `tests/folia-native-lyric-visuals.test.js`
- Modify: `tests/folia-fx-state.test.js`
- Modify: `tests/smoke.test.js`

---

### Task 1: Folia-Like Lyric Timing Adapter

**Files:**
- Create: `public/folia-native-lyric-state.js`
- Test: `tests/folia-native-lyric-state.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing timing adapter tests**

Create `tests/folia-native-lyric-state.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNativeLyricLine,
  buildLineRenderHints,
  buildGraphemeTimeline,
  resolveLineStatus,
  resolveWordStatus,
} = require('../public/folia-native-lyric-state');

test('normalizes Mineradio karaoke words into Folia-like line timing', () => {
  const line = buildNativeLyricLine({
    t: 10,
    duration: 4,
    text: 'Hello world',
    translation: '你好世界',
    words: [
      { text: 'Hello', time: 10, duration: 1.5 },
      { text: 'world', time: 11.5, duration: 2.5 },
    ],
  }, 0);

  assert.equal(line.index, 0);
  assert.equal(line.startTime, 10);
  assert.equal(line.endTime, 14);
  assert.equal(line.fullText, 'Hello world');
  assert.equal(line.translation, '你好世界');
  assert.equal(line.words.length, 2);
  assert.deepEqual(line.words[0], { text: 'Hello', startTime: 10, endTime: 11.5 });
});

test('builds render hints for normal, short and micro lyric lines', () => {
  assert.equal(buildLineRenderHints({ startTime: 1, endTime: 3 }).wordRevealMode, 'normal');
  assert.equal(buildLineRenderHints({ startTime: 1, endTime: 1.12 }).wordRevealMode, 'fast');
  assert.equal(buildLineRenderHints({ startTime: 1, endTime: 1.05 }).wordRevealMode, 'instant');
});

test('maps word timings back to grapheme timeline including spaces', () => {
  const line = buildNativeLyricLine({
    t: 0,
    duration: 2,
    text: 'A B',
    words: [
      { text: 'A', time: 0, duration: 0.5 },
      { text: 'B', time: 1, duration: 0.5 },
    ],
  }, 0);

  const timeline = buildGraphemeTimeline(line);
  assert.equal(timeline.map(item => item.char).join(''), 'A B');
  assert.equal(timeline[0].startTime, 0);
  assert.equal(timeline[1].startTime, 1);
  assert.equal(timeline[2].startTime, 1);
});

test('resolves line and word state from playback time', () => {
  const line = buildNativeLyricLine({
    t: 5,
    duration: 3,
    text: 'Light',
    words: [{ text: 'Light', time: 5, duration: 3 }],
  }, 0);

  assert.equal(resolveLineStatus(line, 4.9), 'waiting');
  assert.equal(resolveLineStatus(line, 6), 'active');
  assert.equal(resolveLineStatus(line, 9), 'passed');
  assert.equal(resolveWordStatus(line.words[0], 4.9), 'waiting');
  assert.equal(resolveWordStatus(line.words[0], 6), 'active');
  assert.equal(resolveWordStatus(line.words[0], 9), 'passed');
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/folia-native-lyric-state.test.js
```

Expected: FAIL with `Cannot find module '../public/folia-native-lyric-state'`.

- [ ] **Step 3: Implement the minimal timing adapter**

Create `public/folia-native-lyric-state.js` as a UMD-style module matching existing `public/folia-*.js` files:

```js
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaNativeLyricState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MICRO_LINE_DURATION_THRESHOLD = 0.10;
  var SHORT_LINE_DURATION_THRESHOLD = 0.18;
  var MICRO_LINE_RENDER_FLOOR = 0.067;

  function finite(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function splitGraphemes(text) {
    text = String(text || '');
    if (!text) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), function(item) {
        return item.segment;
      });
    }
    return Array.from(text);
  }

  function buildWord(word, lineStart, lineEnd) {
    word = word || {};
    var text = String(word.text || word.word || '').replace(/\s+/g, ' ').trim();
    var start = finite(word.time != null ? word.time : (word.t != null ? word.t : word.start), lineStart);
    var duration = finite(word.duration != null ? word.duration : word.d, Math.max(0, lineEnd - start));
    var end = finite(word.endTime, start + Math.max(0, duration));
    return text ? { text: text, startTime: start, endTime: Math.max(start, end) } : null;
  }

  function buildLineRenderHints(line) {
    var rawDuration = Math.max(finite(line.endTime, line.startTime) - finite(line.startTime, 0), 0);
    var timingClass = rawDuration < MICRO_LINE_DURATION_THRESHOLD ? 'micro' : rawDuration < SHORT_LINE_DURATION_THRESHOLD ? 'short' : 'normal';
    var lineTransitionMode = timingClass === 'micro' ? 'none' : timingClass === 'short' ? 'fast' : 'normal';
    var wordRevealMode = timingClass === 'micro' ? 'instant' : timingClass === 'short' ? 'fast' : 'normal';
    var renderEndTime = lineTransitionMode === 'none'
      ? Math.max(line.endTime, line.startTime + MICRO_LINE_RENDER_FLOOR)
      : Math.max(line.endTime, line.endTime + (lineTransitionMode === 'fast' ? 0.04 : 0.18));
    return { rawDuration: rawDuration, timingClass: timingClass, renderEndTime: renderEndTime, lineTransitionMode: lineTransitionMode, wordRevealMode: wordRevealMode };
  }

  function buildNativeLyricLine(line, index) {
    line = line || {};
    var start = finite(line.t != null ? line.t : (line.time != null ? line.time : line.start), 0);
    var duration = finite(line.duration != null ? line.duration : line.d, 0);
    var text = String(line.text || line.content || line.fullText || '').replace(/\s+/g, ' ').trim();
    var end = Math.max(start, finite(line.endTime, duration > 0 ? start + duration : start + Math.max(1.2, text.length * 0.12)));
    var words = Array.isArray(line.words) ? line.words.map(function(word) { return buildWord(word, start, end); }).filter(Boolean) : [];
    if (!words.length && text) words = [{ text: text, startTime: start, endTime: end }];
    var out = {
      index: index || 0,
      startTime: start,
      endTime: end,
      fullText: text,
      translation: String(line.translation || line.translated || line.tl || '').trim(),
      words: words,
      fallback: line.fallback === true,
    };
    out.renderHints = buildLineRenderHints(out);
    return out;
  }

  function buildGraphemeTimeline(line) {
    var graphemes = splitGraphemes(line && line.fullText);
    if (!line || !graphemes.length) return [];
    var timeline = new Array(graphemes.length);
    var cursor = 0;
    var lastTime = line.startTime;
    (line.words || []).forEach(function(word, wordIndex) {
      var wordChars = splitGraphemes(word.text);
      var match = line.fullText.indexOf(word.text, cursor);
      if (match < 0) match = cursor;
      var startIndex = splitGraphemes(line.fullText.slice(0, match)).length;
      for (var gap = cursor; gap < startIndex; gap += 1) {
        timeline[gap] = { char: graphemes[gap], startTime: word.startTime, endTime: word.startTime, wordIndex: wordIndex };
      }
      var unit = Math.max(0, word.endTime - word.startTime) / Math.max(1, wordChars.length);
      for (var i = 0; i < wordChars.length && startIndex + i < timeline.length; i += 1) {
        timeline[startIndex + i] = { char: graphemes[startIndex + i], startTime: word.startTime + unit * i, endTime: word.startTime + unit * (i + 1), wordIndex: wordIndex };
        lastTime = timeline[startIndex + i].endTime;
      }
      cursor = Math.max(cursor, startIndex + wordChars.length);
    });
    for (var j = 0; j < graphemes.length; j += 1) {
      if (!timeline[j]) timeline[j] = { char: graphemes[j], startTime: lastTime, endTime: lastTime };
    }
    return timeline;
  }

  function resolveLineStatus(line, now) {
    if (!line) return 'waiting';
    if (now < line.startTime) return 'waiting';
    if (now <= (line.renderHints && line.renderHints.renderEndTime || line.endTime)) return 'active';
    return 'passed';
  }

  function resolveWordStatus(word, now) {
    if (!word) return 'waiting';
    if (now < word.startTime) return 'waiting';
    if (now <= word.endTime) return 'active';
    return 'passed';
  }

  return {
    splitGraphemes: splitGraphemes,
    buildNativeLyricLine: buildNativeLyricLine,
    buildLineRenderHints: buildLineRenderHints,
    buildGraphemeTimeline: buildGraphemeTimeline,
    resolveLineStatus: resolveLineStatus,
    resolveWordStatus: resolveWordStatus,
  };
});
```

- [ ] **Step 4: Add syntax check entry**

Modify `package.json` `scripts.check` by adding:

```bash
node --check public/folia-native-lyric-state.js
```

- [ ] **Step 5: Run timing adapter tests**

Run:

```bash
node --test tests/folia-native-lyric-state.test.js
npm run check
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json public/folia-native-lyric-state.js tests/folia-native-lyric-state.test.js
git commit -m "feat: add native Folia lyric timing model"
```

---

### Task 2: Native Visual Model for Sweep, Glow and Orbit

**Files:**
- Create: `public/folia-native-lyric-visuals.js`
- Test: `tests/folia-native-lyric-visuals.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing visual model tests**

Create `tests/folia-native-lyric-visuals.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMonetSweep,
  resolveGlowEnvelope,
  resolveCladdaghOrbit,
  resolveNativeLyricVisualFrame,
} = require('../public/folia-native-lyric-visuals');

test('resolves Monet-style sweep progress with soft edge', () => {
  const sweep = resolveMonetSweep({
    startTime: 10,
    endTime: 14,
    now: 12,
    width: 400,
    softnessPx: 16,
  });

  assert.equal(sweep.progress, 0.5);
  assert.equal(sweep.fillWidth, 200);
  assert.equal(sweep.solidEnd, 184);
  assert.equal(sweep.featherEnd, 200);
});

test('keeps glow envelope finite through rise and tail', () => {
  const rising = resolveGlowEnvelope({ startTime: 1, endTime: 3, renderEndTime: 4, now: 2, intensity: 1 });
  const tail = resolveGlowEnvelope({ startTime: 1, endTime: 3, renderEndTime: 4, now: 3.5, intensity: 1 });

  assert.ok(rising > 0);
  assert.ok(tail > 0);
  assert.ok(rising <= 1);
  assert.ok(tail <= 1);
});

test('places Claddagh orbit glyphs with finite pseudo-3D values', () => {
  const orbit = resolveCladdaghOrbit({
    index: 2,
    count: 5,
    progress: 0.5,
    radiusX: 2.8,
    radiusY: 0.9,
    depth: 0.6,
    focus: 0.8,
    audioPower: 0.4,
    effectStrength: 1,
  });

  assert.ok(Number.isFinite(orbit.x));
  assert.ok(Number.isFinite(orbit.y));
  assert.ok(Number.isFinite(orbit.z));
  assert.ok(orbit.opacity >= 0 && orbit.opacity <= 1);
  assert.ok(orbit.scale > 0);
});

test('combines frame values and applies performance reduction', () => {
  const quality = resolveNativeLyricVisualFrame({
    effect: 'hybrid',
    now: 2,
    line: { startTime: 0, endTime: 4, renderHints: { renderEndTime: 4.5 } },
    progress: 0.5,
    audio: { beatPulse: 0.8, energy: 0.5 },
    fx: { glow: 1, wordHighlight: 1, beatMotion: 1, cameraMotion: 1, performanceMode: 'quality' },
  });
  const battery = resolveNativeLyricVisualFrame({
    effect: 'hybrid',
    now: 2,
    line: { startTime: 0, endTime: 4, renderHints: { renderEndTime: 4.5 } },
    progress: 0.5,
    audio: { beatPulse: 0.8, energy: 0.5 },
    fx: { glow: 1, wordHighlight: 1, beatMotion: 1, cameraMotion: 1, performanceMode: 'battery', reduceMotion: true },
  });

  assert.ok(quality.glow >= battery.glow);
  assert.equal(battery.orbitStrength, 0);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/folia-native-lyric-visuals.test.js
```

Expected: FAIL with `Cannot find module '../public/folia-native-lyric-visuals'`.

- [ ] **Step 3: Implement the visual helpers**

Create `public/folia-native-lyric-visuals.js`:

```js
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaNativeLyricVisuals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function finite(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, finite(value, min)));
  }

  function smoothstep(value) {
    value = clamp(value, 0, 1);
    return value * value * (3 - 2 * value);
  }

  function resolveMonetSweep(opts) {
    opts = opts || {};
    var start = finite(opts.startTime, 0);
    var end = Math.max(start + 0.001, finite(opts.endTime, start + 1));
    var progress = clamp((finite(opts.now, start) - start) / (end - start), 0, 1);
    var width = Math.max(0, finite(opts.width, 1));
    var fillWidth = width * progress;
    var softness = clamp(opts.softnessPx, 0, Math.max(width, 0), 12);
    return {
      progress: progress,
      fillWidth: fillWidth,
      solidEnd: Math.max(fillWidth - softness, 0),
      featherStart: Math.max(fillWidth - softness * 0.55, 0),
      featherEnd: fillWidth,
    };
  }

  function resolveGlowEnvelope(opts) {
    opts = opts || {};
    var start = finite(opts.startTime, 0);
    var end = Math.max(start + 0.001, finite(opts.endTime, start + 1));
    var renderEnd = Math.max(end, finite(opts.renderEndTime, end + 0.8));
    var now = finite(opts.now, start);
    var intensity = clamp(opts.intensity, 0, 1);
    if (now < start || intensity <= 0) return 0;
    var riseEnd = start + (end - start) * 1.18;
    if (now <= riseEnd) {
      return smoothstep((now - start) / Math.max(0.001, riseEnd - start)) * intensity;
    }
    var tail = 1 - smoothstep((now - riseEnd) / Math.max(0.18, renderEnd - riseEnd));
    return clamp(tail * intensity, 0, 1);
  }

  function resolveCladdaghOrbit(opts) {
    opts = opts || {};
    var count = Math.max(1, Math.floor(finite(opts.count, 1)));
    var index = clamp(opts.index, 0, count - 1);
    var progress = clamp(opts.progress, 0, 1);
    var strength = clamp(opts.effectStrength, 0, 1);
    var audio = clamp(opts.audioPower, 0, 2);
    var rx = Math.max(0.1, finite(opts.radiusX, 2.8)) * (1 + audio * 0.12 * strength);
    var ry = Math.max(0.1, finite(opts.radiusY, 0.9)) * (1 + audio * 0.08 * strength);
    var theta = ((index / count) - progress) * Math.PI * 2;
    var cos = Math.cos(theta);
    var sin = Math.sin(theta);
    var depth = clamp((cos + 1) / 2, 0, 1);
    var focus = clamp(opts.focus, 0, 1);
    return {
      x: rx * sin * strength,
      y: ry * Math.sin(theta * 0.72) * strength,
      z: (depth - 0.5) * finite(opts.depth, 0.6) * strength,
      opacity: clamp((0.42 + depth * 0.42 + focus * 0.16) * (0.35 + strength * 0.65), 0, 1),
      scale: Math.max(0.2, 0.82 + depth * 0.38 + focus * 0.18 * strength),
      blur: Math.max(0, (1 - depth) * 5.5 * strength),
      rotateZ: Math.atan2(Math.cos(theta), Math.sin(theta)) * 10 * strength,
    };
  }

  function resolvePerformanceScale(fx) {
    fx = fx || {};
    if (fx.reduceMotion) return 0;
    if (fx.performanceMode === 'battery') return 0.45;
    if (fx.performanceMode === 'quality') return 1;
    return 0.75;
  }

  function resolveNativeLyricVisualFrame(opts) {
    opts = opts || {};
    var fx = opts.fx || {};
    var audio = opts.audio || {};
    var line = opts.line || {};
    var perf = resolvePerformanceScale(fx);
    var effect = String(opts.effect || 'off');
    var glowBase = resolveGlowEnvelope({
      startTime: line.startTime,
      endTime: line.endTime,
      renderEndTime: line.renderHints && line.renderHints.renderEndTime,
      now: opts.now,
      intensity: clamp(fx.glow, 0, 1),
    });
    var beat = clamp(audio.beatPulse || audio.beatOnset || 0, 0, 2);
    var orbitStrength = effect === 'claddagh-orbit' || effect === 'hybrid' ? perf * clamp(fx.cameraMotion == null ? 0.35 : fx.cameraMotion, 0, 1) : 0;
    return {
      effect: effect,
      progress: clamp(opts.progress, 0, 1),
      sweepStrength: effect === 'monet-sweep' || effect === 'hybrid' || effect === 'classic' ? perf * clamp(fx.wordHighlight == null ? 0.85 : fx.wordHighlight, 0, 1) : 0,
      orbitStrength: orbitStrength,
      glow: glowBase * (0.72 + beat * clamp(fx.beatMotion == null ? 0.45 : fx.beatMotion, 0, 1) * 0.28) * (0.45 + perf * 0.55),
      particleStrength: perf * clamp(fx.particleAmount == null ? 0.65 : fx.particleAmount, 0, 1),
    };
  }

  return {
    resolveMonetSweep: resolveMonetSweep,
    resolveGlowEnvelope: resolveGlowEnvelope,
    resolveCladdaghOrbit: resolveCladdaghOrbit,
    resolveNativeLyricVisualFrame: resolveNativeLyricVisualFrame,
  };
});
```

- [ ] **Step 4: Add syntax check entry**

Modify `package.json` `scripts.check` by adding:

```bash
node --check public/folia-native-lyric-visuals.js
```

- [ ] **Step 5: Run visual model tests**

Run:

```bash
node --test tests/folia-native-lyric-visuals.test.js
npm run check
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json public/folia-native-lyric-visuals.js tests/folia-native-lyric-visuals.test.js
git commit -m "feat: add Folia native lyric visual model"
```

---

### Task 3: Add Native Lyric Effect Setting

**Files:**
- Modify: `public/folia-fx-state.js`
- Modify: `public/index.html`
- Modify: `tests/folia-fx-state.test.js`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing state tests**

Append to `tests/folia-fx-state.test.js`:

```js
test('normalizes native lyric effect mode for Mineradio 3D lyrics', () => {
  const fx = normalizeFoliaFx({ nativeLyricEffect: 'claddagh-orbit' });
  assert.equal(fx.nativeLyricEffect, 'claddagh-orbit');

  const fallback = normalizeFoliaFx({ nativeLyricEffect: 'unknown' });
  assert.equal(fallback.nativeLyricEffect, 'hybrid');
});
```

Append to `tests/smoke.test.js`:

```js
test('native Folia lyric fusion controls are wired into the 3D lyric panel', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  assert.match(html, /folia-native-lyric-state\.js/);
  assert.match(html, /folia-native-lyric-visuals\.js/);
  assert.match(html, /id="folia-fx-native-lyric-effect"/);
  assert.match(html, /nativeLyricEffect/);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test tests/folia-fx-state.test.js tests/smoke.test.js
```

Expected: FAIL because `nativeLyricEffect` and scripts are not wired.

- [ ] **Step 3: Extend Folia FX state**

In `public/folia-fx-state.js`:

```js
nativeLyricEffect: 'hybrid',
```

Normalize with:

```js
nativeLyricEffect: oneOf(input.nativeLyricEffect, ['off', 'classic', 'monet-sweep', 'claddagh-orbit', 'hybrid'], DEFAULT_FOLIA_FX.nativeLyricEffect),
```

- [ ] **Step 4: Load helper scripts**

In `public/index.html`, near existing Folia scripts:

```html
<script src="folia-native-lyric-state.js"></script>
<script src="folia-native-lyric-visuals.js"></script>
```

- [ ] **Step 5: Add UI segmented control**

In the existing Folia FX card after `#folia-fx-visual-mode`, add:

```html
<div class="fx-seg" id="folia-fx-native-lyric-effect">
  <button type="button" data-folia-fx="nativeLyricEffect" data-value="hybrid" onclick="updateFoliaFxFromControl('nativeLyricEffect','hybrid')">3D融合</button>
  <button type="button" data-folia-fx="nativeLyricEffect" data-value="monet-sweep" onclick="updateFoliaFxFromControl('nativeLyricEffect','monet-sweep')">扫光</button>
  <button type="button" data-folia-fx="nativeLyricEffect" data-value="claddagh-orbit" onclick="updateFoliaFxFromControl('nativeLyricEffect','claddagh-orbit')">回环</button>
  <button type="button" data-folia-fx="nativeLyricEffect" data-value="classic" onclick="updateFoliaFxFromControl('nativeLyricEffect','classic')">流光</button>
  <button type="button" data-folia-fx="nativeLyricEffect" data-value="off" onclick="updateFoliaFxFromControl('nativeLyricEffect','off')">关闭</button>
</div>
```

- [ ] **Step 6: Run state and smoke tests**

Run:

```bash
node --test tests/folia-fx-state.test.js tests/smoke.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/folia-fx-state.js public/index.html tests/folia-fx-state.test.js tests/smoke.test.js
git commit -m "feat: add native Folia lyric effect control"
```

---

### Task 4: Feed Native Timing Model into Existing 3D Lyrics

**Files:**
- Modify: `public/index.html`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing smoke test for native timing usage**

Append to `tests/smoke.test.js`:

```js
test('3D lyric renderer consumes native Folia lyric timing model', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  assert.match(html, /buildNativeStageLyricLine/);
  assert.match(html, /MineradioFoliaNativeLyricState/);
  assert.match(html, /nativeLyricLine/);
  assert.match(html, /buildGraphemeTimeline/);
});
```

- [ ] **Step 2: Run failing smoke test**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: FAIL because `buildNativeStageLyricLine` does not exist.

- [ ] **Step 3: Add native line adapter wrapper in `public/index.html`**

Near existing lyric helpers:

```js
function foliaNativeLyricStateApi() {
  return window.MineradioFoliaNativeLyricState || null;
}

function buildNativeStageLyricLine(line, index) {
  var api = foliaNativeLyricStateApi();
  if (!api || typeof api.buildNativeLyricLine !== 'function') return null;
  return api.buildNativeLyricLine(line || {}, index || 0);
}
```

- [ ] **Step 4: Attach native timing data when showing a line**

In `showStageLine(text, redrawOnly)`, after `var mesh = buildLyricMesh(text);`, attach:

```js
var sourceLine = stageLyrics.currentIdx >= 0 && lyricsLines ? lyricsLines[stageLyrics.currentIdx] : null;
mesh.userData.nativeLyricLine = sourceLine ? buildNativeStageLyricLine(sourceLine, stageLyrics.currentIdx) : null;
```

- [ ] **Step 5: Update native timing during playback**

In `tickLyricsParticles()`, after `var curLine = lyricsLines[newIdx];`, ensure current mesh has the native line:

```js
if (stageLyrics.current && stageLyrics.current.userData && !stageLyrics.current.userData.nativeLyricLine) {
  stageLyrics.current.userData.nativeLyricLine = buildNativeStageLyricLine(curLine, newIdx);
}
```

- [ ] **Step 6: Run smoke test**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/index.html tests/smoke.test.js
git commit -m "feat: feed native Folia timing into 3D lyrics"
```

---

### Task 5: Apply Monet Sweep and Cadenza Glow to Current 3D Mesh

**Files:**
- Modify: `public/index.html`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing smoke test for visual frame usage**

Append to `tests/smoke.test.js`:

```js
test('3D lyric renderer applies native Folia visual frame values', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  assert.match(html, /foliaNativeLyricVisualsApi/);
  assert.match(html, /resolveNativeStageLyricFrame/);
  assert.match(html, /nativeVisualFrame/);
  assert.match(html, /sweepStrength/);
  assert.match(html, /particleStrength/);
});
```

- [ ] **Step 2: Run failing smoke test**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: FAIL because the visual frame wrapper does not exist.

- [ ] **Step 3: Add visual frame wrapper**

In `public/index.html`:

```js
function foliaNativeLyricVisualsApi() {
  return window.MineradioFoliaNativeLyricVisuals || null;
}

function currentNativeLyricAudioFrame() {
  return {
    energy: Math.max(0, Math.min(2, Number(audioEnergy || 0))),
    beatPulse: Math.max(0, Math.min(2, Number(stageLyrics && stageLyrics.beatGlow || 0))),
    beatOnset: !!(stageLyrics && stageLyrics.beatGlow > 0.75),
  };
}

function resolveNativeStageLyricFrame(mesh, progress, now) {
  var api = foliaNativeLyricVisualsApi();
  var data = mesh && mesh.userData || {};
  var line = data.nativeLyricLine || null;
  if (!api || !line || !foliaFx || foliaFx.nativeLyricEffect === 'off') return null;
  return api.resolveNativeLyricVisualFrame({
    effect: foliaFx.nativeLyricEffect || 'hybrid',
    now: now,
    line: line,
    progress: progress,
    audio: currentNativeLyricAudioFrame(),
    fx: foliaFx,
  });
}
```

- [ ] **Step 4: Store current frame during progress update**

In `updateLyricMeshProgress(mesh, progress)`, after progress is clamped:

```js
mesh.userData.nativeVisualFrame = resolveNativeStageLyricFrame(mesh, progress, audioEl ? audioEl.currentTime : 0);
```

Use the existing playback time source if this function already has a local time variable.

- [ ] **Step 5: Blend frame values into existing material uniforms**

In `updateStageLyrics3D(dt)` inside `tickMesh`, read:

```js
var nativeFrame = data.nativeVisualFrame || null;
var nativeGlow = nativeFrame ? nativeFrame.glow : 0;
var nativeSweep = nativeFrame ? nativeFrame.sweepStrength : 0;
var nativeParticles = nativeFrame ? nativeFrame.particleStrength : 0;
```

Then blend:

```js
solarTarget += nativeGlow * 0.28;
glowTarget += nativeGlow * 0.22;
sparkTarget += nativeParticles * 0.16;
```

For shader progress, keep existing `uProgress`, but when `nativeSweep > 0`, slightly widen feather/solar:

```js
if (data.textMat && data.textMat.uniforms) {
  data.textMat.uniforms.uFeather.value = Math.max(data.textMat.uniforms.uFeather.value, 0.06 + nativeSweep * 0.04);
  data.textMat.uniforms.uSolar.value = Math.max(data.textMat.uniforms.uSolar.value, nativeGlow * 0.22);
}
```

- [ ] **Step 6: Run smoke test**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/index.html tests/smoke.test.js
git commit -m "feat: apply Folia sweep and glow to native 3D lyrics"
```

---

### Task 6: Add Claddagh-Style Orbit Motion to 3D Lyrics

**Files:**
- Modify: `public/index.html`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing smoke test for orbit integration**

Append to `tests/smoke.test.js`:

```js
test('3D lyric renderer includes Claddagh-style orbit motion path', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  assert.match(html, /resolveNativeStageLyricOrbit/);
  assert.match(html, /resolveCladdaghOrbit/);
  assert.match(html, /orbitStrength/);
});
```

- [ ] **Step 2: Run failing smoke test**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: FAIL because orbit wrapper is absent.

- [ ] **Step 3: Add orbit wrapper**

In `public/index.html`:

```js
function resolveNativeStageLyricOrbit(mesh, progress) {
  var api = foliaNativeLyricVisualsApi();
  var data = mesh && mesh.userData || {};
  var frame = data.nativeVisualFrame || null;
  var line = data.nativeLyricLine || null;
  if (!api || !frame || !line || frame.orbitStrength <= 0) return null;
  return api.resolveCladdaghOrbit({
    index: line.index || 0,
    count: Math.max(1, lyricsLines && lyricsLines.length || 1),
    progress: progress,
    radiusX: 0.16,
    radiusY: 0.07,
    depth: 0.10,
    focus: foliaFx.currentLineFocus || 0.75,
    audioPower: currentNativeLyricAudioFrame().beatPulse,
    effectStrength: frame.orbitStrength,
  });
}
```

- [ ] **Step 4: Apply orbit as subtle mesh-local motion**

In `tickMesh(mesh, isCurrent)`, after base position/scale calculations:

```js
var orbit = isCurrent ? resolveNativeStageLyricOrbit(mesh, progress) : null;
if (orbit) {
  mesh.position.x += orbit.x;
  mesh.position.y += orbit.y;
  mesh.position.z += orbit.z;
  mesh.scale.multiplyScalar(orbit.scale);
  mesh.rotation.z += orbit.rotateZ * Math.PI / 180;
}
```

Keep values intentionally small because Mineradio already places the lyric group in camera space.

- [ ] **Step 5: Respect performance and reduce motion**

Ensure `resolveNativeLyricVisualFrame` returns `orbitStrength: 0` for `reduceMotion` and heavily lowers it for `battery`.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/folia-native-lyric-visuals.test.js tests/smoke.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/index.html tests/smoke.test.js
git commit -m "feat: add Folia orbit motion to native 3D lyrics"
```

---

### Task 7: Secondary Lyrics and Current-Line Focus Polish

**Files:**
- Modify: `public/index.html`
- Modify: `tests/smoke.test.js`

- [ ] **Step 1: Write failing smoke test for translation/focus plumbing**

Append to `tests/smoke.test.js`:

```js
test('native Folia lyrics expose translation and current-line focus to 3D stage', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  assert.match(html, /nativeLyricTranslation/);
  assert.match(html, /translationMode/);
  assert.match(html, /currentLineFocus/);
});
```

- [ ] **Step 2: Run failing smoke test**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: FAIL until translation/focus markers exist.

- [ ] **Step 3: Store translation on mesh**

In `showStageLine` after native line is attached:

```js
mesh.userData.nativeLyricTranslation = mesh.userData.nativeLyricLine && mesh.userData.nativeLyricLine.translation || '';
```

- [ ] **Step 4: Add focus dimming for outgoing lines**

In `tickMesh(mesh, isCurrent)`, calculate:

```js
var nativeFocus = foliaFx && isFinite(foliaFx.currentLineFocus) ? foliaFx.currentLineFocus : 0.75;
var outgoingDim = isCurrent ? 1 : Math.max(0.28, 1 - nativeFocus * 0.55);
```

Then multiply existing outgoing opacity targets by `outgoingDim`.

- [ ] **Step 5: Add minimal translation overlay decision**

Do not create a new large DOM overlay yet. For this batch, only preserve translation in `userData` and make it available for a later render pass. If a visible secondary line is required later, implement it as a separate task after the core 3D effects are stable.

- [ ] **Step 6: Run smoke test**

Run:

```bash
node --test tests/smoke.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/index.html tests/smoke.test.js
git commit -m "feat: preserve Folia lyric translation focus state"
```

---

### Task 8: Verification and Regression Pass

**Files:**
- No planned source edits unless tests expose a defect.

- [ ] **Step 1: Run focused Folia/native tests**

Run:

```bash
node --test tests/folia-native-lyric-state.test.js tests/folia-native-lyric-visuals.test.js tests/folia-fx-state.test.js tests/folia-bridge-state.test.js tests/smoke.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full syntax and unit verification**

Run:

```bash
npm run check
npm test
```

Expected: PASS.

- [ ] **Step 3: Build Folia stage to ensure iframe integration still works**

Run:

```bash
npm run folia:build
```

Expected: PASS. Vite may warn about large chunks; that is acceptable if build exits with code 0.

- [ ] **Step 4: Manual desktop verification**

Run:

```bash
npm start
```

Verify:

- Online song still plays.
- Dynamic 3D lyrics still appear without selecting Folia stage.
- `nativeLyricEffect = off` matches old visual behavior.
- `nativeLyricEffect = monet-sweep` increases sweep/glow without layout jump.
- `nativeLyricEffect = claddagh-orbit` adds subtle spatial motion, not wild camera drift.
- `nativeLyricEffect = hybrid` combines sweep/glow/orbit.
- `performanceMode = battery` visibly reduces particles/orbit.
- `reduceMotion = true` disables orbit and lowers motion.
- Folia iframe stage still opens and receives playback state.

- [ ] **Step 5: Final commit if verification fixes were needed**

```bash
git add public/index.html public/folia-native-lyric-state.js public/folia-native-lyric-visuals.js public/folia-fx-state.js package.json tests
git commit -m "test: verify Folia native lyric fusion"
```

Skip this commit if no files changed during verification.

---

## Risk Notes

- `public/index.html` is large and stateful. Keep helper logic in new pure modules so the monolith only wires values into the renderer.
- Do not replace `Folia 歌词舞台`; this plan only improves native 3D lyrics.
- Keep orbit movement small. Mineradio already applies camera-facing placement and skull/detail-mode positioning.
- Avoid visible secondary translation rendering until core timing/sweep/orbit is stable.
- Performance mode must be honored from the first visual integration batch.

## Suggested Commit Sequence

1. `feat: add native Folia lyric timing model`
2. `feat: add Folia native lyric visual model`
3. `feat: add native Folia lyric effect control`
4. `feat: feed native Folia timing into 3D lyrics`
5. `feat: apply Folia sweep and glow to native 3D lyrics`
6. `feat: add Folia orbit motion to native 3D lyrics`
7. `feat: preserve Folia lyric translation focus state`

