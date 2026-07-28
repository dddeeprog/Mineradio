const defaultFs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const DESCRIPTOR_FILE_NAME = 'eisland-bridge-v1.json';
const DESCRIPTOR_PROTOCOL = 'mineradio-bridge/v1';
const DESCRIPTOR_TTL_MS = 5_000;
const REFRESH_INTERVAL_MS = 1_000;
async function writeDescriptorAtomically(fs, descriptorDirectory, descriptorPath, descriptor) {
  const temporaryPath = path.join(
    descriptorDirectory,
    `.${DESCRIPTOR_FILE_NAME}.${randomUUID()}.tmp`,
  );
  let temporaryFile;
  let temporaryFileCreated = false;

  try {
    temporaryFile = await fs.open(temporaryPath, 'wx', 0o600);
    temporaryFileCreated = true;
    await temporaryFile.writeFile(JSON.stringify(descriptor), 'utf8');
    await temporaryFile.close();
    temporaryFile = null;
    await fs.rename(temporaryPath, descriptorPath);
  } catch {
    if (temporaryFile) {
      try {
        await temporaryFile.close();
      } catch {}
    }
    if (temporaryFileCreated) {
      try {
        await fs.unlink(temporaryPath);
      } catch {}
    }
    throw new Error('Bridge discovery descriptor publication failed.');
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

  async function publish() {
    const nextPublication = publication.then(async () => {
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
      await fs.mkdir(descriptorDirectory, { recursive: true });
      if (isClosed) return false;
      await writeDescriptorAtomically(fs, descriptorDirectory, descriptorPath, descriptor);
      hasPublished = true;
      return true;
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
      const existing = await readDescriptor(fs, descriptorPath);
      if (!hasDescriptorOwner(existing, instanceId, pid)) return false;
      try {
        await fs.unlink(descriptorPath);
        return true;
      } catch {
        return false;
      }
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
