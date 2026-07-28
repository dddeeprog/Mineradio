const defaultFs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const DESCRIPTOR_FILE_NAME = 'eisland-bridge-v1.json';
const DESCRIPTOR_PROTOCOL = 'mineradio-bridge/v1';
const DESCRIPTOR_TTL_MS = 5_000;
const REFRESH_INTERVAL_MS = 1_000;
const DESCRIPTOR_LOCK_FILE_NAME = `.${DESCRIPTOR_FILE_NAME}.lock`;
const LOCK_RELEASE_ATTEMPTS = 3;
const LOCK_RETRY_MS = 10;
const TEMPORARY_CLEANUP_ATTEMPTS = 3;

function publicationError() {
  return new Error('Bridge discovery descriptor publication failed.');
}
async function writeDescriptorAtomically(
  fs,
  descriptorDirectory,
  descriptorPath,
  descriptor,
  temporaryPaths,
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
    if (ownsTemporaryFile && (await cleanupTemporaryFile(fs, temporaryPath))) {
      temporaryPaths.delete(temporaryPath);
    }
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
function waitForLockRetry() {
  return new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
}
async function sanitizeTemporaryFile(fs, temporaryPath) {
  try {
    await fs.writeFile(temporaryPath, '', 'utf8');
    return (await fs.readFile(temporaryPath, 'utf8')) === '';
  } catch {
    return false;
  }
}

async function cleanupTemporaryFile(fs, temporaryPath) {
  for (let attempt = 0; attempt < TEMPORARY_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await fs.unlink(temporaryPath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return true;
      await sanitizeTemporaryFile(fs, temporaryPath);
      if (attempt + 1 < TEMPORARY_CLEANUP_ATTEMPTS) {
        await waitForLockRetry();
      }
    }
  }
  return false;
}

async function cleanupOwnedTemporaryFiles(fs, temporaryPaths) {
  for (const temporaryPath of temporaryPaths) {
    if (await cleanupTemporaryFile(fs, temporaryPath)) {
      temporaryPaths.delete(temporaryPath);
    }
  }
}

async function releaseDescriptorLock(fs, lockPath) {
  for (let attempt = 0; attempt < LOCK_RELEASE_ATTEMPTS; attempt += 1) {
    try {
      await fs.unlink(lockPath);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return true;
      await waitForLockRetry();
    }
  }
  return false;
}

async function withDescriptorLock(fs, descriptorDirectory, operation) {
  const lockPath = path.join(descriptorDirectory, DESCRIPTOR_LOCK_FILE_NAME);
  await fs.mkdir(descriptorDirectory, { recursive: true });
  while (true) {
    try {
      await fs.writeFile(lockPath, '', {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await waitForLockRetry();
    }
  }

  try {
    return await operation();
  } finally {
    await releaseDescriptorLock(fs, lockPath);
  }
}



function createBridgeDiscoveryPublisher({
  appData,
  bridgePort,
  clock = () => Date.now(),
  fs = defaultFs,
  instanceId,
  pid,
  timer = { setInterval, clearInterval },
  token,
} = {}) {
  const descriptorDirectory = path.join(appData, 'Mineradio');
  const descriptorPath = path.join(descriptorDirectory, DESCRIPTOR_FILE_NAME);
  let hasPublished = false;
  let isClosed = false;
  let refreshTimer;
  let closePromise;
  let publication = Promise.resolve();
  const temporaryPaths = new Set();

  async function publish() {
    const nextPublication = publication.then(async () => {
      try {
        if (isClosed) return false;
        return await withDescriptorLock(fs, descriptorDirectory, async () => {
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
          );
          hasPublished = true;
          return true;
        });
      } catch {
        throw publicationError();
      }
    });
    publication = nextPublication.catch(() => {});
    return nextPublication;
  }

  function close() {
    if (closePromise) return closePromise;

    isClosed = true;
    if (refreshTimer !== undefined) {
      timer.clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    closePromise = publication.then(async () => {
      let removedDescriptor = false;
      try {
        removedDescriptor = await withDescriptorLock(fs, descriptorDirectory, async () => {
          const existing = await readDescriptor(fs, descriptorPath);
          if (!hasDescriptorOwner(existing, instanceId, pid)) return false;
          try {
            await fs.unlink(descriptorPath);
            return true;
          } catch {
            return false;
          }
        });
      } catch {}
      try {
        await cleanupOwnedTemporaryFiles(fs, temporaryPaths);
      } catch {}
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
