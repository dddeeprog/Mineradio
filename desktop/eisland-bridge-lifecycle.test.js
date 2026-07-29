const test = require('node:test');
const assert = require('node:assert/strict');

function loadLifecycle() {
  try {
    return require('./eisland-bridge-lifecycle');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return {};
    throw error;
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createHarness({
  listenOutcomes = [{ port: 43123 }],
  primary = true,
  serverCloseDeferred = null,
} = {}) {
  const calls = {
    bridgeDispose: 0,
    bridgeReceipts: [],
    bridgeStates: [],
    createBridge: [],
    createPublisher: [],
    createServer: [],
    delay: [],
    order: [],
    publisherClose: 0,
    quit: 0,
    send: [],
    serverClose: 0,
    timers: [],
  };
  const pendingCommands = [];
  const bridge = {
    dispose() {
      calls.bridgeDispose += 1;
      calls.order.push('bridge-dispose');
      while (pendingCommands.length > 0) {
        const pending = pendingCommands.shift();
        pending.resolve({
          error: { code: 'renderer-disposed' },
          ok: false,
          requestId: pending.requestId,
        });
      }
      return true;
    },
    enqueueCommand({ requestId }) {
      return new Promise((resolve) => pendingCommands.push({ requestId, resolve }));
    },
    receiveCommandReceipt(receipt) {
      calls.bridgeReceipts.push(receipt);
      return true;
    },
    receiveHeartbeat(snapshot) {
      calls.bridgeStates.push(snapshot);
      return true;
    },
  };
  let currentWindow = {
    isDestroyed: () => false,
    webContents: {
      send(channel, payload) {
        calls.send.push({ channel, payload });
      },
    },
  };
  let outcomeIndex = 0;

  return {
    bridge,
    calls,
    createOptions() {
      return {
        appData: 'C:/AppData',
        createBridgeDiscoveryPublisher(options) {
          calls.createPublisher.push(options);
          return {
            close() {
              calls.publisherClose += 1;
              calls.order.push('publisher-close');
              return Promise.resolve(true);
            },
            ready: Promise.resolve(true),
          };
        },
        createBridgeServer(options) {
          calls.createServer.push(options);
          const outcome = listenOutcomes[Math.min(outcomeIndex, listenOutcomes.length - 1)];
          outcomeIndex += 1;
          return {
            close() {
              calls.serverClose += 1;
              calls.order.push('server-close');
              return serverCloseDeferred ? serverCloseDeferred.promise : Promise.resolve(true);
            },
            start() {
              return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
            },
          };
        },
        createInstanceId: () => 'instance-a',
        createPlayerBridge(options) {
          calls.createBridge.push(options);
          return bridge;
        },
        createToken: () => 'a'.repeat(43),
        getMainWindow: () => currentWindow,
        isPrimaryInstance: () => primary,
        pid: 42,
        quit() {
          calls.quit += 1;
        },
        sleep(delay) {
          calls.delay.push(delay);
          return Promise.resolve();
        },
        setTimeoutFn(callback, delay) {
          const handle = { callback, cleared: false, delay };
          calls.timers.push(handle);
          return handle;
        },
        clearTimeoutFn(handle) {
          handle.cleared = true;
        },
      };
    },
    setWindow(nextWindow) {
      currentWindow = nextWindow;
    },
  };
}

test('starts_once_only_after_primary_when_ready', async () => {
  const { createEislandBridgeLifecycle } = loadLifecycle();
  assert.equal(typeof createEislandBridgeLifecycle, 'function');

  const secondary = createHarness({ primary: false });
  const secondaryLifecycle = createEislandBridgeLifecycle(secondary.createOptions());
  const secondaryResult = await secondaryLifecycle.start({ createWindow: async () => {} });
  assert.equal(secondaryResult.available, false);
  assert.equal(secondaryResult.reason, 'not-primary');
  assert.equal(secondary.calls.createBridge.length, 0);

  const harness = createHarness();
  const lifecycle = createEislandBridgeLifecycle(harness.createOptions());
  let windowCreates = 0;
  const createWindow = async () => { windowCreates += 1; };
  const [first, second] = await Promise.all([
    lifecycle.start({ createWindow }),
    lifecycle.start({ createWindow }),
  ]);

  assert.equal(first.available, true);
  assert.equal(second.available, true);
  assert.equal(harness.calls.createBridge.length, 1);
  assert.equal(harness.calls.createServer.length, 1);
  assert.equal(harness.calls.createPublisher.length, 1);
  assert.equal(windowCreates, 1);
  assert.equal(harness.calls.createServer[0].token, 'a'.repeat(43));
  assert.equal(harness.calls.createPublisher[0].bridgePort, 43123);
});

test('retries_listen_three_times_then_opens_without_descriptor', async () => {
  const { createEislandBridgeLifecycle } = loadLifecycle();
  assert.equal(typeof createEislandBridgeLifecycle, 'function');

  const harness = createHarness({
    listenOutcomes: [new Error('busy-1'), new Error('busy-2'), new Error('busy-3')],
  });
  const lifecycle = createEislandBridgeLifecycle(harness.createOptions());
  let windowCreates = 0;
  const result = await lifecycle.start({ createWindow: async () => { windowCreates += 1; } });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'listen-failed');
  assert.equal(harness.calls.createBridge.length, 1);
  assert.equal(harness.calls.createServer.length, 3);
  assert.deepEqual(harness.calls.delay, [100, 100]);
  assert.equal(harness.calls.createPublisher.length, 0);
  assert.equal(harness.calls.serverClose, 3);
  assert.equal(harness.calls.bridgeDispose, 1);
  assert.equal(windowCreates, 1);
});

test('routes_renderer_state_and_commands_to_current_window', async () => {
  const { createEislandBridgeLifecycle } = loadLifecycle();
  assert.equal(typeof createEislandBridgeLifecycle, 'function');

  const harness = createHarness();
  const lifecycle = createEislandBridgeLifecycle(harness.createOptions());
  await lifecycle.start();

  const state = { state: { playback: { status: 'playing' } } };
  const receipt = { attempt: 'attempt-a', ok: true, requestId: 'request-a' };
  assert.equal(lifecycle.receiveRendererState(state), true);
  assert.equal(lifecycle.receiveRendererHeartbeat(state), true);
  assert.equal(lifecycle.receiveRendererCommandReceipt(receipt), true);
  assert.deepEqual(harness.calls.bridgeStates, [state, state]);
  assert.deepEqual(harness.calls.bridgeReceipts, [receipt]);

  const command = { attempt: 'attempt-a', command: 'play', requestId: 'request-a' };
  assert.equal(harness.calls.createBridge[0].dispatchCommand(command), true);
  assert.deepEqual(harness.calls.send, [{
    channel: 'mineradio-eisland-bridge-command',
    payload: command,
  }]);

  harness.setWindow(null);
  assert.throws(
    () => harness.calls.createBridge[0].dispatchCommand(command),
    { code: 'renderer-window-unavailable' },
  );
});

test('cleans_bridge_when_window_creation_fails', async () => {
  const { createEislandBridgeLifecycle } = loadLifecycle();
  assert.equal(typeof createEislandBridgeLifecycle, 'function');

  const harness = createHarness();
  const lifecycle = createEislandBridgeLifecycle(harness.createOptions());
  let pending;
  await assert.rejects(
    lifecycle.start({
      createWindow: async () => {
        pending = harness.bridge.enqueueCommand({ requestId: 'pending-command' });
        throw new Error('window-load-failed');
      },
    }),
    /window-load-failed/,
  );
  assert.deepEqual(await pending, {
    error: { code: 'renderer-disposed' },
    ok: false,
    requestId: 'pending-command',
  });
  assert.deepEqual(harness.calls.order, ['server-close', 'bridge-dispose', 'publisher-close']);
  assert.equal(harness.calls.serverClose, 1);
  assert.equal(harness.calls.bridgeDispose, 1);
  assert.equal(harness.calls.publisherClose, 1);
});

test('awaits_idempotent_shutdown_before_quit_reentry', async () => {
  const { createEislandBridgeLifecycle } = loadLifecycle();
  assert.equal(typeof createEislandBridgeLifecycle, 'function');

  const closeDeferred = createDeferred();
  const harness = createHarness({ serverCloseDeferred: closeDeferred });
  const lifecycle = createEislandBridgeLifecycle(harness.createOptions());
  await lifecycle.start();


  const firstEvent = { prevented: 0, preventDefault() { this.prevented += 1; } };
  const secondEvent = { prevented: 0, preventDefault() { this.prevented += 1; } };
  const firstShutdown = lifecycle.handleBeforeQuit(firstEvent);
  const secondShutdown = lifecycle.handleBeforeQuit(secondEvent);
  assert.equal(firstShutdown, secondShutdown);
  assert.equal(firstEvent.prevented, 1);
  assert.equal(secondEvent.prevented, 1);
  assert.equal(harness.calls.quit, 0);
  assert.equal(harness.calls.timers.length, 1);
  assert.equal(harness.calls.timers[0].delay, 1500);

  closeDeferred.resolve(true);
  await firstShutdown;
  assert.equal(harness.calls.quit, 1);
  assert.equal(harness.calls.serverClose, 1);
  assert.equal(harness.calls.bridgeDispose, 1);
  assert.equal(harness.calls.publisherClose, 1);

  const reentryEvent = { prevented: 0, preventDefault() { this.prevented += 1; } };
  assert.equal(lifecycle.handleBeforeQuit(reentryEvent), false);
  assert.equal(reentryEvent.prevented, 0);
});

test('waits_for_inflight_startup_before_quitting', async () => {
  const { createEislandBridgeLifecycle } = loadLifecycle();
  assert.equal(typeof createEislandBridgeLifecycle, 'function');

  const windowReady = createDeferred();
  const harness = createHarness();
  const lifecycle = createEislandBridgeLifecycle(harness.createOptions());
  let creates = 0;
  let destroyed = 0;
  const starting = lifecycle.start({
    createWindow() {
      creates += 1;
      return windowReady.promise;
    },
  });
  for (let turn = 0; turn < 8 && creates === 0; turn += 1) await Promise.resolve();
  assert.equal(creates, 1);

  const shutdown = lifecycle.handleBeforeQuit({ preventDefault() {} });
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  assert.equal(harness.calls.quit, 0);

  windowReady.resolve({
    destroy() { destroyed += 1; },
    isDestroyed: () => false,
  });
  const [started] = await Promise.all([starting, shutdown]);
  assert.equal(started.available, false);
  assert.equal(started.reason, 'stopped');
  assert.equal(destroyed, 1);
  assert.equal(harness.calls.quit, 1);
});

test('does_not_reopen_window_when_shutdown_overtakes_startup', async () => {
  const { createEislandBridgeLifecycle } = loadLifecycle();
  assert.equal(typeof createEislandBridgeLifecycle, 'function');

  const listening = createDeferred();
  const harness = createHarness({ listenOutcomes: [listening.promise] });
  const lifecycle = createEislandBridgeLifecycle(harness.createOptions());
  let windowCreates = 0;
  const starting = lifecycle.start({ createWindow: async () => { windowCreates += 1; } });
  await Promise.resolve();
  const stopping = lifecycle.stop();
  listening.resolve({ port: 43123 });

  const [started] = await Promise.all([starting, stopping]);
  assert.equal(started.available, false);
  assert.equal(started.reason, 'stopped');
  assert.equal(windowCreates, 0);
  assert.equal(harness.calls.createPublisher.length, 0);
  assert.equal(harness.calls.bridgeDispose, 1);
});

test('closes_inflight_window_when_shutdown_arrives_after_open', async () => {
  const { createEislandBridgeLifecycle } = loadLifecycle();
  assert.equal(typeof createEislandBridgeLifecycle, 'function');

  const windowReady = createDeferred();
  const harness = createHarness();
  const lifecycle = createEislandBridgeLifecycle(harness.createOptions());
  let creates = 0;
  let destroyed = 0;
  const starting = lifecycle.start({
    createWindow() {
      creates += 1;
      return windowReady.promise;
    },
  });
  for (let turn = 0; turn < 8 && creates === 0; turn += 1) await Promise.resolve();
  assert.equal(creates, 1);
  const stopping = lifecycle.stop();
  windowReady.resolve({
    destroy() { destroyed += 1; },
    isDestroyed: () => false,
  });

  const [started] = await Promise.all([starting, stopping]);
  assert.equal(started.available, false);
  assert.equal(started.reason, 'stopped');
  assert.equal(destroyed, 1);
});
