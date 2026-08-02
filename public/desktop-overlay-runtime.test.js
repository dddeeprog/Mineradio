const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('./desktop-overlay-runtime');

function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, delay) {
      const id = nextId++;
      pending.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    runNext() {
      const entry = pending.entries().next().value;
      assert.ok(entry, 'expected a pending timer');
      const [id, timer] = entry;
      pending.delete(id);
      timer.fn();
      return timer.delay;
    },
    count() {
      return pending.size;
    },
  };
}

test('desktop overlay runtime normalizes bounded render pressure and timing', () => {
  assert.equal(runtime.normalizeRenderPressureLevel(0, 60), 0);
  assert.equal(runtime.normalizeRenderPressureLevel(0, 40), 1);
  assert.equal(runtime.normalizeRenderPressureLevel(0, 20), 2);
  assert.equal(runtime.normalizeRenderPressureLevel(9, 60), 2);

  assert.equal(runtime.desktopOverlaySyncDelay({ hidden: false, pressure: 0 }), 320);
  assert.equal(runtime.desktopOverlaySyncDelay({ hidden: false, pressure: 1 }), 420);
  assert.equal(runtime.desktopOverlaySyncDelay({ hidden: false, pressure: 2 }), 620);
  assert.equal(runtime.desktopOverlaySyncDelay({ hidden: true, pressure: 0 }), 900);
  assert.equal(runtime.desktopLyricsPushInterval({ hidden: true, pressure: 0, fps: 60 }), 120);
  assert.equal(runtime.desktopLyricsPushInterval({ hidden: false, pressure: 2, fps: 60 }), 38);
});

test('desktop overlay runtime uses inclusive lock-control hit testing', () => {
  const rect = { left: 10, top: 20, right: 40, bottom: 50 };
  assert.equal(runtime.pointInRect({ clientX: 10, clientY: 20 }, rect), true);
  assert.equal(runtime.pointInRect({ clientX: 40, clientY: 50 }, rect), true);
  assert.equal(runtime.pointInRect({ clientX: 41, clientY: 50 }, rect), false);
  assert.equal(runtime.shouldCaptureLockedControl({ locked: true, hintVisible: true, pointer: { clientX: 25, clientY: 35 }, rect }), true);
  assert.equal(runtime.shouldCaptureLockedControl({ locked: false, hintVisible: true, pointer: { clientX: 25, clientY: 35 }, rect }), false);
  assert.equal(runtime.shouldCaptureLockedControl({ locked: true, hintVisible: false, pointer: { clientX: 25, clientY: 35 }, rect }), false);
  assert.equal(runtime.shouldCaptureLockedControl({ locked: true, hintVisible: true, pointer: { clientX: 9, clientY: 35 }, rect }), false);
});

test('desktop overlay runtime scheduler ticks once and cleans up when scheduled work becomes inactive', () => {
  const timers = createFakeTimers();
  let active = true;
  let ticks = 0;
  let inactive = 0;
  const scheduler = runtime.createOverlayScheduler({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    isActive: () => active,
    tick: () => { ticks += 1; },
    onInactive: () => { inactive += 1; },
    getDelay: () => 320,
  });

  scheduler.schedule(12);
  scheduler.schedule(12);
  assert.equal(scheduler.pending(), true);
  assert.equal(timers.count(), 1);
  assert.equal(timers.runNext(), 12);
  assert.equal(ticks, 1);
  assert.equal(scheduler.pending(), true);
  assert.equal(timers.count(), 1);

  active = false;
  assert.equal(timers.runNext(), 320);
  assert.equal(inactive, 1);
  assert.equal(scheduler.pending(), false);
  assert.equal(timers.count(), 0);
});

test('desktop overlay runtime scheduler cancels pending work deterministically', () => {
  const timers = createFakeTimers();
  const scheduler = runtime.createOverlayScheduler({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    isActive: () => true,
    tick: () => {},
    onInactive: () => {},
    getDelay: () => 320,
  });

  scheduler.schedule(5);
  assert.equal(scheduler.pending(), true);
  scheduler.cancel();
  assert.equal(scheduler.pending(), false);
  assert.equal(timers.count(), 0);
});
