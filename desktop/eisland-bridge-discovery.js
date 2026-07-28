const defaultFs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const DESCRIPTOR_FILE_NAME = 'eisland-bridge-v1.json';
const DESCRIPTOR_PROTOCOL = 'mineradio-bridge/v1';
const DESCRIPTOR_TTL_MS = 5_000;
const REFRESH_INTERVAL_MS = 1_000;
const DESCRIPTOR_LOCK_FILE_NAME = `.${DESCRIPTOR_FILE_NAME}.lock`;
const LOCK_ACQUIRE_ATTEMPTS = 10;
const LOCK_RELEASE_ATTEMPTS = 3;
const LOCK_RETRY_MS = 10;
const TEMPORARY_CLEANUP_ATTEMPTS = 3;
const BRIDGE_DISCOVERY_ERROR = Symbol('bridge-discovery-error');

function bridgeDiscoveryError(message) {
  const error = new Error(message);
  error[BRIDGE_DISCOVERY_ERROR] = true;
  return error;
}

function publicationError() {
  return bridgeDiscoveryError('Bridge discovery descriptor publication failed.');
}

function cleanupError() {
  return bridgeDiscoveryError('Bridge discovery descriptor cleanup failed.');
}

function lockAcquireError() {
  return bridgeDiscoveryError('Bridge discovery descriptor lock acquisition failed.');
}

function lockReleaseError() {
  return bridgeDiscoveryError('Bridge discovery descriptor lock release failed.');
}

function normalizeDiscoveryError(error) {
  return error?.[BRIDGE_DISCOVERY_ERROR] ? error : publicationError();
}
async function writeDescriptorAtomically(
  fs,
  descriptorDirectory,
  descriptorPath,
  descriptor,
  temporaryPaths,
  timer,
) {
  const temporaryPath = path.join(
    descriptorDirectory,
    `.${DESCRIPTOR_FILE_NAME}.${randomUUID()}.tmp`,
  );
  let temporaryFile;
  let ownsTemporaryFile = false;

  try {
    temporaryFile = await fs.open(temporaryPath, 'wx', 0o600);
    ownsTemporaryFile = true;
    temporaryPaths.add(temporaryPath);
    await temporaryFile.writeFile(JSON.stringify(descriptor), 'utf8');
    await temporaryFile.close();
    temporaryFile = null;
    await fs.rename(temporaryPath, descriptorPath);
    temporaryPaths.delete(temporaryPath);
  } catch {
    if (temporaryFile) {
      try {
        await temporaryFile.close();
      } catch {}
    }

    let cleanedUp = true;
    if (ownsTemporaryFile) {
      try {
        cleanedUp = await cleanupTemporaryFile(fs, temporaryPath, timer);
      } catch {
        cleanedUp = false;
      }
      if (cleanedUp) temporaryPaths.delete(temporaryPath);
    }
    if (!cleanedUp) throw cleanupError();
    throw publicationError();
  }
}
async function readDescriptor(fs, descriptorPath) {
  try {
    const raw = await fs.readFile(descriptorPath, 'utf8');
    const descriptor = JSON.parse(raw);
    return descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)
      ? descriptor
      : null;
  } catch {
    return null;
  }
}

function hasDescriptorOwner(descriptor, instanceId, pid) {
  return descriptor?.instanceId === instanceId && descriptor?.pid === pid;
}
function waitForRetry(timer) {
  return new Promise((resolve) => {
    if (typeof timer.setTimeout !== 'function') {
      resolve();
      return;
    }
    timer.setTimeout(resolve, LOCK_RETRY_MS);
  });
}

function waitForLockRetry(timer, lockRetryWaiters) {
  return new Promise((resolve) => {
    const waiter = { handle: undefined, resolve };
    lockRetryWaiters.add(waiter);
    if (typeof timer.setTimeout !== 'function') {
      lockRetryWaiters.delete(waiter);
      resolve(true);
      return;
    }
    waiter.handle = timer.setTimeout(() => {
      lockRetryWaiters.delete(waiter);
      resolve(true);
    }, LOCK_RETRY_MS);
  });
}

function cancelLockRetries(timer, lockRetryWaiters) {
  for (const waiter of [...lockRetryWaiters]) {
    lockRetryWaiters.delete(waiter);
    if (waiter.handle !== undefined && typeof timer.clearTimeout === 'function') {
      timer.clearTimeout(waiter.handle);
    }
    waiter.resolve(false);
  }
}

async function sanitizeTemporaryFile(fs, temporaryPath) {
  try {
    await fs.writeFile(temporaryPath, '', 'utf8');
    return (await fs.readFile(temporaryPath, 'utf8')) === '';
  } catch {
    return false;
  }
}

async function cleanupTemporaryFile(fs, temporaryPath, timer) {
  for (let attempt = 0; attempt < TEMPORARY_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await fs.unlink(temporaryPath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return true;
      await sanitizeTemporaryFile(fs, temporaryPath);
      if (attempt + 1 < TEMPORARY_CLEANUP_ATTEMPTS) {
        await waitForRetry(timer);
      }
    }
  }
  return false;
}

async function cleanupOwnedTemporaryFiles(fs, temporaryPaths, timer) {
  let cleanupFailed = false;
  for (const temporaryPath of [...temporaryPaths]) {
    let cleanedUp = false;
    try {
      cleanedUp = await cleanupTemporaryFile(fs, temporaryPath, timer);
    } catch {
      cleanedUp = false;
    }
    if (cleanedUp) {
      temporaryPaths.delete(temporaryPath);
    } else {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw cleanupError();
}

async function releaseDescriptorLock(fs, lockPath, timer) {
  for (let attempt = 0; attempt < LOCK_RELEASE_ATTEMPTS; attempt += 1) {
    try {
      await fs.unlink(lockPath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return true;
      if (attempt + 1 < LOCK_RELEASE_ATTEMPTS) {
        await waitForRetry(timer);
      }
    }
  }
  return false;
}

async function withDescriptorLock(
  fs,
  descriptorDirectory,
  timer,
  lockRetryWaiters,
  shouldCancel,
  operation,
) {
  const lockPath = path.join(descriptorDirectory, DESCRIPTOR_LOCK_FILE_NAME);
  await fs.mkdir(descriptorDirectory, { recursive: true });
  let acquired = false;

  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
    if (shouldCancel()) return false;
    try {
      await fs.writeFile(lockPath, '', {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      acquired = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (shouldCancel()) return false;
      if (attempt + 1 === LOCK_ACQUIRE_ATTEMPTS) throw lockAcquireError();
      const shouldRetry = await waitForLockRetry(timer, lockRetryWaiters);
      if (!shouldRetry || shouldCancel()) return false;
    }
  }
  if (!acquired) throw lockAcquireError();

  try {
    if (shouldCancel()) return false;
    return await operation();
  } finally {
    if (!(await releaseDescriptorLock(fs, lockPath, timer))) {
      throw lockReleaseError();
    }
  }
}



function createBridgeDiscoveryPublisher({
  appData,
  bridgePort,
  clock = () => Date.now(),
  fs = defaultFs,
  instanceId,
  pid,
  timer = { setInterval, clearInterval, setTimeout, clearTimeout },
  token,
} = {}) {
  const descriptorDirectory = path.join(appData, 'Mineradio');
  const descriptorPath = path.join(descriptorDirectory, DESCRIPTOR_FILE_NAME);
  let hasPublished = false;
  let isClosed = false;
  let refreshTimer;
  let closePromise;
  let publication = Promise.resolve();
  const lockRetryWaiters = new Set();
  const temporaryPaths = new Set();

  async function publish() {
    const nextPublication = publication.then(async () => {
      try {
        if (isClosed) return false;
        return await withDescriptorLock(
          fs,
          descriptorDirectory,
          timer,
          lockRetryWaiters,
          () => isClosed,
          async () => {
            if (isClosed) return false;
            if (hasPublished) {
              const existing = await readDescriptor(fs, descriptorPath);
              if (!hasDescriptorOwner(existing, instanceId, pid)) return false;
            }

            const descriptor = {
              protocol: DESCRIPTOR_PROTOCOL,
              bridgePort,
              token,
              instanceId,
              pid,
              expiresAtMs: clock() + DESCRIPTOR_TTL_MS,
            };
            if (isClosed) return false;
            await writeDescriptorAtomically(
              fs,
              descriptorDirectory,
              descriptorPath,
              descriptor,
              temporaryPaths,
              timer,
            );
            hasPublished = true;
            return true;
          },
        );
      } catch (error) {
        throw normalizeDiscoveryError(error);
      }
    });
    publication = nextPublication.catch(() => {});
    return nextPublication;
  }

  function close() {
    if (closePromise) return closePromise;

    isClosed = true;
    cancelLockRetries(timer, lockRetryWaiters);
    if (refreshTimer !== undefined) {
      timer.clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    closePromise = publication.then(async () => {
      let removedDescriptor = false;
      let closeError;

      if (hasPublished) {
        try {
          removedDescriptor = await withDescriptorLock(
            fs,
            descriptorDirectory,
            timer,
            lockRetryWaiters,
            () => false,
            async () => {
              const existing = await readDescriptor(fs, descriptorPath);
              if (!hasDescriptorOwner(existing, instanceId, pid)) return false;
              try {
                await fs.unlink(descriptorPath);
                return true;
              } catch {
                return false;
              }
            },
          );
        } catch (error) {
          closeError = normalizeDiscoveryError(error);
        }
      }

      try {
        await cleanupOwnedTemporaryFiles(fs, temporaryPaths, timer);
      } catch (error) {
        if (!closeError) closeError = normalizeDiscoveryError(error);
      }
      if (closeError) throw closeError;
      return removedDescriptor;
    });
    return closePromise;
  }

  const ready = publish().then((published) => {
    if (published && !isClosed) {
      refreshTimer = timer.setInterval(
        () => publish().catch(() => false),
        REFRESH_INTERVAL_MS,
      );
    }
    return published;
  });

  return {
    close,
    publish,
    ready,
  };
}

module.exports = {
  createBridgeDiscoveryPublisher,
};
