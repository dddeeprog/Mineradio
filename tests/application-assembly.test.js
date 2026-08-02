'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const assembly = require('../public/application-assembly');

test('search assembly delegates to the supplied UI controller factory', () => {
  const expected = { cancel() {}, search() {} };
  const stateApi = { name: 'search-state' };
  let received;
  const result = assembly.createPlatformSearchController({
    stateApi,
    uiApi: {
      createController(options) {
        received = options;
        return expected;
      },
    },
    requestJson() {},
    onUpdate() {},
  });

  assert.equal(result, expected);
  assert.equal(received.stateApi, stateApi);
  assert.equal(typeof received.requestJson, 'function');
  assert.equal(typeof received.onUpdate, 'function');
});

test('login assembly creates state and mounts UI through supplied modules', () => {
  const snapshot = { providers: [] };
  const state = { selectedProvider: 'qq' };
  const mounted = { setState() {} };
  let stateOptions;
  let mountOptions;

  assert.equal(assembly.createPlatformLoginState({
    stateApi: {
      createLoginState(value, options) {
        assert.equal(value, snapshot);
        stateOptions = options;
        return state;
      },
    },
    snapshot,
    selectedProvider: 'qq',
  }), state);
  assert.deepEqual(stateOptions, { selectedProvider: 'qq' });

  assert.equal(assembly.mountPlatformLoginCenter({
    uiApi: {
      mountLoginCenter(options) {
        mountOptions = options;
        return mounted;
      },
    },
    providerRoot: {},
    methodRoot: {},
    state,
    onProvider() {},
    onMethod() {},
  }), mounted);
  assert.equal(mountOptions.state, state);
  assert.equal(typeof mountOptions.onProvider, 'function');
  assert.equal(typeof mountOptions.onMethod, 'function');
});

test('playback assembly delegates transaction creation and rejects missing APIs', () => {
  const expected = { execute() {} };
  const capture = () => ({});
  const restore = () => {};
  let received;

  assert.equal(assembly.createPlaybackTransactionManager({
    transactionApi: {
      createPlaybackTransactionManager(options) {
        received = options;
        return expected;
      },
    },
    capture,
    restore,
  }), expected);
  assert.equal(received.capture, capture);
  assert.equal(received.restore, restore);

  assert.throws(
    () => assembly.createPlatformSearchController({ uiApi: {} }),
    /createController/,
  );
  assert.throws(
    () => assembly.mountPlatformLoginCenter({ uiApi: {} }),
    /mountLoginCenter/,
  );
  assert.throws(
    () => assembly.createPlaybackTransactionManager({ transactionApi: {} }),
    /createPlaybackTransactionManager/,
  );
});
