const { randomBytes, randomUUID } = require('node:crypto');

const LISTEN_ATTEMPTS = 3;
const LISTEN_RETRY_DELAY_MS = 100;
const SHUTDOWN_TIMEOUT_MS = 1_500;

function lifecycleError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function defaultSleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function isLiveWindow(window) {
  return Boolean(
    window
    && typeof window.isDestroyed === 'function'
    && !window.isDestroyed()
    && window.webContents
    && typeof window.webContents.send === 'function',
  );
}

function createEislandBridgeLifecycle({
  appData,
  createBridgeDiscoveryPublisher,
  createBridgeServer,
  createInstanceId = randomUUID,
  createPlayerBridge,
  createToken = () => randomBytes(32).toString('base64url'),
  getMainWindow = () => null,
  isPrimaryInstance = () => true,
  pid = process.pid,
  quit = () => {},
  sleep = defaultSleep,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let bridge = null;
  let bridgeServer = null;
  let discoveryPublisher = null;
  let startPromise = null;
  let stopPromise = null;
  let quitPromise = null;
  let stopping = false;
  let quitReentry = false;
  let status = { available: false, reason: 'not-started' };

  function setUnavailable(reason) {
    status = { available: false, reason };
    return status;
  }

  function dispatchCommand(command) {
    const window = getMainWindow();
    if (!isLiveWindow(window)) throw lifecycleError('renderer-window-unavailable');
    window.webContents.send('mineradio-eisland-bridge-command', command);
    return true;
  }

  async function closeResource(resource, method) {
    if (!resource || typeof resource[method] !== 'function') return false;
    try {
      await resource[method]();
      return true;
    } catch {
      return false;
    }
  }

  async function closeBridgeResources() {
    const closingServer = bridgeServer;
    bridgeServer = null;
    await closeResource(closingServer, 'close');

    const closingBridge = bridge;
    bridge = null;
    if (closingBridge && typeof closingBridge.dispose === 'function') {
      try {
        closingBridge.dispose();
      } catch {}
    }

    const closingPublisher = discoveryPublisher;
    discoveryPublisher = null;
    await closeResource(closingPublisher, 'close');
  }

  function isPrimary() {
    try {
      return typeof isPrimaryInstance === 'function'
        ? Boolean(isPrimaryInstance())
        : Boolean(isPrimaryInstance);
    } catch {
      return false;
    }
  }

  async function startBridgeServer(instanceId, token) {
    for (let attempt = 1; attempt <= LISTEN_ATTEMPTS; attempt += 1) {
      if (stopping) return 0;
      let candidate;
      try {
        candidate = createBridgeServer({ bridge, instanceId, token });
        bridgeServer = candidate;
        const started = await candidate.start();
        const port = Number(started?.port);
        if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
          throw lifecycleError('bridge-listen-invalid');
        }
        if (stopping) {
          if (bridgeServer === candidate) bridgeServer = null;
          await closeResource(candidate, 'close');
          return 0;
        }
        return port;
      } catch {
        if (bridgeServer === candidate) bridgeServer = null;
        await closeResource(candidate, 'close');
        if (attempt < LISTEN_ATTEMPTS && !stopping) {
          try {
            await sleep(LISTEN_RETRY_DELAY_MS);
          } catch {}
        }
      }
    }
    return 0;
  }

  function disposeWindowAfterShutdown(window) {
    if (!window) return;
    try {
      if (typeof window.isDestroyed === 'function' && window.isDestroyed()) return;
      if (typeof window.destroy === 'function') {
        window.destroy();
        return;
      }
      if (typeof window.close === 'function') window.close();
    } catch {}
  }
  async function openWindow(createWindow) {
    if (typeof createWindow !== 'function') return;
    if (stopping) return;
    const createdWindow = await createWindow();
    if (!stopping) return;
    disposeWindowAfterShutdown(createdWindow);
  }

  async function startInternal({ createWindow } = {}) {
    if (!isPrimary()) return setUnavailable('not-primary');
    if (stopping) return setUnavailable('stopped');

    let instanceId;
    let token;
    try {
      instanceId = String(createInstanceId() || '');
      token = String(createToken() || '');
      if (!instanceId || !token) throw lifecycleError('bridge-identity-unavailable');
      bridge = createPlayerBridge({ dispatchCommand });
      if (!bridge || typeof bridge !== 'object') throw lifecycleError('bridge-core-unavailable');
    } catch {
      if (stopping) return setUnavailable('stopped');
      await openWindow(createWindow);
      return setUnavailable('bridge-core-failed');
    }

    const bridgePort = await startBridgeServer(instanceId, token);
    if (!bridgePort || stopping) {
      await closeBridgeResources();
      if (stopping) return setUnavailable('stopped');
      await openWindow(createWindow);
      return setUnavailable('listen-failed');
    }

    if (stopping) {
      await closeBridgeResources();
      return setUnavailable('stopped');
    }

    try {
      discoveryPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort,
        instanceId,
        pid,
        token,
      });
      const published = await discoveryPublisher?.ready;
      if (published !== true) throw lifecycleError('descriptor-unavailable');
    } catch {
      await closeBridgeResources();
      if (stopping) return setUnavailable('stopped');
      await openWindow(createWindow);
      return setUnavailable('descriptor-failed');
    }

    if (stopping) {
      await closeBridgeResources();
      return setUnavailable('stopped');
    }

    try {
      await openWindow(createWindow);
    } catch (error) {
      await closeBridgeResources();
      setUnavailable('window-failed');
      throw error;
    }

    if (stopping) {
      await closeBridgeResources();
      return setUnavailable('stopped');
    }
    status = { available: true, instanceId };
    return status;
  }

  function start(options = {}) {
    if (startPromise) return startPromise;
    startPromise = startInternal(options);
    return startPromise;
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      await closeBridgeResources();
      return setUnavailable('stopped');
    })();
    return stopPromise;
  }

  function receiveRendererState(snapshot) {
    if (!bridge || typeof bridge.receiveHeartbeat !== 'function') return false;
    return Boolean(bridge.receiveHeartbeat(snapshot || {}));
  }

  function receiveRendererHeartbeat(snapshot) {
    return receiveRendererState(snapshot);
  }

  function receiveRendererCommandReceipt(receipt) {
    if (!bridge || typeof bridge.receiveCommandReceipt !== 'function') return false;
    return Boolean(bridge.receiveCommandReceipt(receipt || {}));
  }

  function settleWithShutdownDeadline(shutdown) {
    return new Promise((resolve) => {
      let settled = false;
      let timeoutHandle;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== undefined) {
          try {
            clearTimeoutFn(timeoutHandle);
          } catch {}
        }
        resolve();
      };
      try {
        timeoutHandle = setTimeoutFn(settle, SHUTDOWN_TIMEOUT_MS);
      } catch {
        timeoutHandle = undefined;
      }
      Promise.resolve(shutdown).then(settle, settle);
    });
  }

  function handleBeforeQuit(event) {
    if (quitReentry) return false;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (quitPromise) return quitPromise;
    const shutdown = stop();
    const startup = startPromise;
    const completion = startup ? Promise.allSettled([shutdown, startup]) : shutdown;
    quitPromise = settleWithShutdownDeadline(completion).then(() => {
      quitReentry = true;
      try {
        quit();
      } catch {}
      return true;
    });
    return quitPromise;
  }

  return {
    getStatus: () => ({ ...status }),
    handleBeforeQuit,
    receiveRendererCommandReceipt,
    receiveRendererHeartbeat,
    receiveRendererState,
    start,
    stop,
  };
}

module.exports = {
  LISTEN_ATTEMPTS,
  LISTEN_RETRY_DELAY_MS,
  SHUTDOWN_TIMEOUT_MS,
  createEislandBridgeLifecycle,
};
