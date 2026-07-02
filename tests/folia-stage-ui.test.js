const assert = require('node:assert/strict');
const test = require('node:test');

const { init } = require('../public/folia-stage-ui');

function fakeElement(id) {
  const classes = new Set();
  const attrs = {};
  const listeners = {};
  return {
    id,
    style: {},
    contentWindow: id === 'folia-stage-frame' ? { postMessage() {} } : null,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name]; },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(name, handler) { listeners[name] = handler; },
    dispatch(name, event) { if (listeners[name]) listeners[name](event || {}); },
  };
}

function fakeDocument() {
  const nodes = {
    'folia-stage-root': fakeElement('folia-stage-root'),
    'folia-stage-frame': fakeElement('folia-stage-frame'),
    'folia-stage-btn': fakeElement('folia-stage-btn'),
  };
  const doc = {
    body: fakeElement('body'),
    getElementById(id) { return nodes[id] || null; },
    addEventListener() {},
    _nodes: nodes,
  };
  return doc;
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('Folia stage falls back when the built stage is missing', async () => {
  const doc = fakeDocument();
  const toasts = [];
  const ui = init({
    document: doc,
    fetch: () => Promise.resolve({ ok: false }),
    showToast: (text) => toasts.push(text),
  });

  ui.open();
  await nextTick();

  assert.equal(ui.isOpen(), false);
  assert.equal(doc.body.classList.contains('folia-stage-open'), false);
  assert.match(toasts[0], /Folia 舞台未构建/);
});

test('Folia stage registers iframe as a bridge target after load', async () => {
  const doc = fakeDocument();
  let registeredTarget = null;
  let pushedReason = '';
  const bridge = {
    registerTarget(target) {
      registeredTarget = target;
      return () => { registeredTarget = null; };
    },
    push(reason) {
      pushedReason = reason;
    },
  };
  const ui = init({
    document: doc,
    bridge,
    fetch: () => Promise.resolve({ ok: true }),
  });

  ui.open();
  await nextTick();
  const frame = doc._nodes['folia-stage-frame'];
  assert.equal(frame.src, 'folia-stage/index.html');

  frame.onload();

  assert.equal(ui.isOpen(), true);
  assert.equal(doc._nodes['folia-stage-root'].classList.contains('ready'), true);
  assert.equal(registeredTarget, frame.contentWindow);
  assert.equal(pushedReason, 'folia-stage-load');
});
