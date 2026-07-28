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

function timerOperationError() {
  return bridgeDiscoveryError('Bridge discovery descriptor timer operation failed.');
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

function isPositiveProcessId(pid) {
  return Number.isInteger(pid) && pid > 0;
}

function isValidLockId(lockId) {
  return typeof lockId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(lockId);
}

function createLockOwner(instanceId, pid) {
  return {
    instanceId: typeof instanceId === 'string' ? instanceId : '',
    pid: Number.isInteger(pid) ? pid : 0,
    lockId: randomUUID(),
  };
}

function isReclaimableLockOwner(lockOwner) {
  return Boolean(
    lockOwner &&
    typeof lockOwner === 'object' &&
    typeof lockOwner.instanceId === 'string' &&
    lockOwner.instanceId.length > 0 &&
    isPositiveProcessId(lockOwner.pid) &&
    isValidLockId(lockOwner.lockId),
  );
}

function lockOwnersMatch(left, right) {
  return Boolean(
    left &&
    right &&
    left.instanceId === right.instanceId &&
    left.pid === right.pid &&
    left.lockId === right.lockId,
  );
}

function defaultIsProcessAlive(pid) {
  if (!isPositiveProcessId(pid)) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function readLockOwner(fs, lockPath) {
  try {
    return {
      exists: true,
      record: JSON.parse(await fs.readFile(lockPath, 'utf8')),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, record: null };
    }
    return { exists: true, error, record: null };
  }
}

async function isConfirmedDead(isProcessAlive, pid) {
  try {
    return (await isProcessAlive(pid)) === false;
  } catch {
    return false;
  }
}

function reclaimClaimPath(lockPath, lockId) {
  return lockPath + '.' + lockId + '.reclaim';
}

async function reclaimDeadDescriptorLock(fs, lockPath, isProcessAlive) {
  const observed = await readLockOwner(fs, lockPath);
  if (observed.error || !isReclaimableLockOwner(observed.record)) return false;
  if (!(await isConfirmedDead(isProcessAlive, observed.record.pid))) return false;

  const claimPath = reclaimClaimPath(lockPath, observed.record.lockId);
  try {
    await fs.writeFile(claimPath, '', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }

  try {
    const current = await readLockOwner(fs, lockPath);
    if (current.error || !lockOwnersMatch(current.record, observed.record)) return false;
    if (!(await isConfirmedDead(isProcessAlive, current.record.pid))) return false;
    try {
      await fs.unlink(lockPath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  } finally {
    try {
      await fs.unlink(claimPath);
    } catch {}
  }
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
  let cancellationError;
  for (const waiter of [...lockRetryWaiters]) {
    lockRetryWaiters.delete(waiter);
    try {
      if (waiter.handle !== undefined && typeof timer.clearTimeout === 'function') {
        timer.clearTimeout(waiter.handle);
      }
    } catch {
      if (!cancellationError) cancellationError = timerOperationError();
    }
    waiter.resolve(false);
  }
  return cancellationError;
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

async function releaseDescriptorLock(fs, lockPath, lockOwner, timer) {
  for (let attempt = 0; attempt < LOCK_RELEASE_ATTEMPTS; attempt += 1) {
    const observed = await readLockOwner(fs, lockPath);
    if (!observed.exists) return true;
    if (observed.error || !lockOwnersMatch(observed.record, lockOwner)) return false;
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
  lockOwner,
  isProcessAlive,
  operation,
) {
  const lockPath = path.join(descriptorDirectory, DESCRIPTOR_LOCK_FILE_NAME);
  await fs.mkdir(descriptorDirectory, { recursive: true });
  let acquired = false;
  let retries = 0;
  let reclaims = 0;

  while (retries < LOCK_ACQUIRE_ATTEMPTS) {
    if (shouldCancel()) return false;
    try {
      await fs.writeFile(lockPath, JSON.stringify(lockOwner), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      acquired = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (shouldCancel()) return false;

      let reclaimed = false;
      if (reclaims < LOCK_ACQUIRE_ATTEMPTS) {
        try {
          reclaimed = await reclaimDeadDescriptorLock(fs, lockPath, isProcessAlive);
        } catch {
          reclaimed = false;
        }
      }
      if (reclaimed) {
        reclaims += 1;
        continue;
      }

      retries += 1;
      if (retries === LOCK_ACQUIRE_ATTEMPTS) throw lockAcquireError();
      const shouldRetry = await waitForLockRetry(timer, lockRetryWaiters);
      if (!shouldRetry || shouldCancel()) return false;
    }
  }
  if (!acquired) throw lockAcquireError();

  try {
    if (shouldCancel()) return false;
    return await operation();
  } finally {
    if (!(await releaseDescriptorLock(fs, lockPath, lockOwner, timer))) {
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
  isProcessAlive = defaultIsProcessAlive,
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
  let inFlightPublication;
  const lockRetryWaiters = new Set();
  const temporaryPaths = new Set();

  function publish() {
    if (inFlightPublication) return inFlightPublication;

    const nextPublication = publication.then(async () => {
      try {
        if (isClosed) return false;
        return await withDescriptorLock(
          fs,
          descriptorDirectory,
          timer,
          lockRetryWaiters,
          () => isClosed,
          createLockOwner(instanceId, pid),
          isProcessAlive,
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
    inFlightPublication = nextPublication;
    publication = nextPublication.catch(() => {});
    nextPublication.then(
      () => {
        if (inFlightPublication === nextPublication) inFlightPublication = undefined;
      },
      () => {
        if (inFlightPublication === nextPublication) inFlightPublication = undefined;
      },
    );
    return nextPublication;
  }

  function close() {
    if (closePromise) return closePromise;

    isClosed = true;
    let resolveClose;
    let rejectClose;
    closePromise = new Promise((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });

    const finishClose = async () => {
      let closeError;
      try {
        closeError = cancelLockRetries(timer, lockRetryWaiters);
      } catch {
        closeError = timerOperationError();
      }
      if (refreshTimer !== undefined) {
        const timerToClear = refreshTimer;
        refreshTimer = undefined;
        try {
          timer.clearInterval(timerToClear);
        } catch {
          if (!closeError) closeError = timerOperationError();
        }
      }

      await publication;
      let removedDescriptor = false;
      if (hasPublished) {
        try {
          removedDescriptor = await withDescriptorLock(
            fs,
            descriptorDirectory,
            timer,
            lockRetryWaiters,
            () => false,
            createLockOwner(instanceId, pid),
            isProcessAlive,
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
          if (!closeError) closeError = normalizeDiscoveryError(error);
        }
      }

      try {
        await cleanupOwnedTemporaryFiles(fs, temporaryPaths, timer);
      } catch (error) {
        if (!closeError) closeError = normalizeDiscoveryError(error);
      }
      if (closeError) throw closeError;
      return removedDescriptor;
    };

    finishClose().then(
      (removedDescriptor) => resolveClose(removedDescriptor),
      (error) => rejectClose(normalizeDiscoveryError(error)),
    );
    return closePromise;
  }

  const ready = publish().then((published) => {
    if (published && !isClosed) {
      try {
        refreshTimer = timer.setInterval(
          () => publish().catch(() => false),
          REFRESH_INTERVAL_MS,
        );
      } catch {
        throw timerOperationError();
      }
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
