const defaultFs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const DESCRIPTOR_FILE_NAME = 'eisland-bridge-v1.json';
const DESCRIPTOR_PROTOCOL = 'mineradio-bridge/v1';
const DESCRIPTOR_TTL_MS = 5_000;
const REFRESH_INTERVAL_MS = 1_000;
const DESCRIPTOR_LOCK_FILE_NAME = `.${DESCRIPTOR_FILE_NAME}.lock`;
const GENERATION_DIRECTORY_NAME = `.${DESCRIPTOR_FILE_NAME}.generations`;
const GENERATION_ROOT_FILE_NAME = 'root';
const GENERATION_OWNER_PREFIX = 'owner.';
const GENERATION_OWNER_SUFFIX = '.json';
const GENERATION_RELEASED_SUFFIX = '.released';
const GENERATION_PENDING_SUFFIX = '.pending';
const GENERATION_COMPACTING_SUFFIX = '.compacting';
const GENERATION_RESIDUE_CLEAN = 'clean';
const GENERATION_RESIDUE_BLOCKED = 'blocked';
const GENERATION_RESIDUE_FAILED = 'failed';
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

function generationCleanupError() {
  return bridgeDiscoveryError('Bridge discovery generation cleanup failed.');
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

function quarantinePath(lockPath, lockId) {
  return `${lockPath}.dead.${lockId}.${randomUUID()}.reclaimed`;
}

async function quarantineDeadDescriptorLock(fs, lockPath, isProcessAlive) {
  const observed = await readLockOwner(fs, lockPath);
  if (observed.error || !isReclaimableLockOwner(observed.record)) return null;
  if (!(await isConfirmedDead(isProcessAlive, observed.record.pid))) return null;

  const current = await readLockOwner(fs, lockPath);
  if (current.error || !lockOwnersMatch(current.record, observed.record)) return null;
  if (!(await isConfirmedDead(isProcessAlive, current.record.pid))) return null;

  const deadLockPath = quarantinePath(lockPath, observed.record.lockId);
  try {
    await fs.rename(lockPath, deadLockPath);
    return deadLockPath;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EEXIST') return null;
    throw error;
  }
}

async function cleanupQuarantinedLocks(fs, quarantinePaths) {
  for (const deadLockPath of quarantinePaths) {
    try {
      await fs.unlink(deadLockPath);
    } catch {}
  }
  quarantinePaths.clear();
}

function generationDirectoryPath(appData) {
  return path.join(appData, GENERATION_DIRECTORY_NAME);
}

function generationRootPath(generationDirectory) {
  return path.join(generationDirectory, GENERATION_ROOT_FILE_NAME);
}

function temporaryGenerationRootPath(generationDirectory, lockId) {
  return path.join(
    generationDirectory,
    '.root.' + lockId + '.tmp',
  );
}

function isGenerationOwnerFileName(fileName) {
  if (
    typeof fileName !== 'string' ||
    !fileName.startsWith(GENERATION_OWNER_PREFIX) ||
    !fileName.endsWith(GENERATION_OWNER_SUFFIX)
  ) {
    return false;
  }
  const lockId = fileName.slice(
    GENERATION_OWNER_PREFIX.length,
    -GENERATION_OWNER_SUFFIX.length,
  );
  return isValidLockId(lockId);
}

function generationArtifactOwnerFileName(fileName, suffix) {
  if (!fileName.endsWith(suffix)) return null;
  const ownerFileName = fileName.slice(0, -suffix.length);
  return isGenerationOwnerFileName(ownerFileName) ? ownerFileName : null;
}

function isTemporaryGenerationRootFileName(fileName) {
  return typeof fileName === 'string' &&
    fileName.startsWith('.root.') &&
    fileName.endsWith('.tmp');
}

function generationOwnerFileName(lockId) {
  return `${GENERATION_OWNER_PREFIX}${lockId}${GENERATION_OWNER_SUFFIX}`;
}

function generationOwnerPath(generationDirectory, lockId) {
  return path.join(generationDirectory, generationOwnerFileName(lockId));
}

function generationNextPath(ownerPath) {
  return `${ownerPath}.next`;
}

function generationReleasedPath(ownerPath) {
  return `${ownerPath}${GENERATION_RELEASED_SUFFIX}`;
}

function generationPendingPath(ownerPath) {
  return ownerPath + GENERATION_PENDING_SUFFIX;
}

function generationCompactingPath(ownerPath) {
  return ownerPath + GENERATION_COMPACTING_SUFFIX;
}

function generationResidueResult(cleaned) {
  return cleaned ? GENERATION_RESIDUE_CLEAN : GENERATION_RESIDUE_FAILED;
}

async function readGenerationFromLink(fs, generationDirectory, linkPath) {
  const linked = await readLockOwner(fs, linkPath);
  if (!linked.exists) return { exists: false };
  if (linked.error || !isReclaimableLockOwner(linked.record)) {
    return { exists: true, error: true };
  }

  const ownerPath = generationOwnerPath(generationDirectory, linked.record.lockId);
  const owner = await readLockOwner(fs, ownerPath);
  if (
    !owner.exists ||
    owner.error ||
    !lockOwnersMatch(owner.record, linked.record)
  ) {
    return { exists: true, error: true };
  }
  return { exists: true, owner: linked.record, ownerPath };
}

async function readGenerationTerminal(fs, generationDirectory) {
  const rootPath = generationRootPath(generationDirectory);
  let current = await readGenerationFromLink(fs, generationDirectory, rootPath);
  const nodes = [];
  if (!current.exists || current.error) return { ...current, nodes };

  const seenLockIds = new Set();
  while (current.exists) {
    if (seenLockIds.has(current.owner.lockId)) {
      return { exists: true, error: true, nodes };
    }
    seenLockIds.add(current.owner.lockId);
    nodes.push(current);

    const next = await readGenerationFromLink(
      fs,
      generationDirectory,
      generationNextPath(current.ownerPath),
    );
    if (!next.exists) return { ...current, nodes };
    if (next.error) return { ...next, nodes };
    current = next;
  }
  return { exists: false, nodes };
}

async function writeGenerationCandidate(fs, generationDirectory, owner) {
  const ownerPath = generationOwnerPath(generationDirectory, owner.lockId);
  const pendingPath = generationPendingPath(ownerPath);
  await fs.writeFile(pendingPath, JSON.stringify(owner), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  try {
    await fs.writeFile(ownerPath, JSON.stringify(owner), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    await removeGenerationFile(fs, pendingPath);
    throw error;
  }
  return { ownerPath, pendingPath };
}

async function removeGenerationFile(fs, filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function cleanupGenerationCandidate(fs, ownerPath, pendingPath) {
  const ownerRemoved = await removeGenerationFile(fs, ownerPath);
  const pendingRemoved = !pendingPath ||
    await removeGenerationFile(fs, pendingPath);
  const compactingRemoved = await removeGenerationFile(
    fs,
    generationCompactingPath(ownerPath),
  );
  const releaseRemoved = await removeGenerationFile(
    fs,
    generationReleasedPath(ownerPath),
  );
  return ownerRemoved && pendingRemoved && compactingRemoved && releaseRemoved;
}

async function completeGenerationCandidateLink(fs, generation) {
  if (!(await removeGenerationFile(fs, generation.pendingPath))) {
    generation.cleanupFailed = true;
  }
  return generation;
}

async function readGenerationCompactingMarker(fs, generation) {
  const marker = await readLockOwner(
    fs,
    generationCompactingPath(generation.ownerPath),
  );
  if (!marker.exists) return { exists: false };
  if (marker.error || !lockOwnersMatch(marker.record, generation.owner)) {
    return { exists: true, error: true };
  }
  return { exists: true, owner: marker.record };
}

// This intent/fence is present from before the successor CAS until compaction
// reaches a durable root, so no later candidate may append through this one.
async function createGenerationCompactingMarker(fs, generation) {
  const compactingPath = generationCompactingPath(generation.ownerPath);
  try {
    await fs.writeFile(compactingPath, JSON.stringify(generation.owner), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return true;
  } catch (error) {
    if (error?.code !== 'EEXIST') return false;
  }
  const existing = await readGenerationCompactingMarker(fs, generation);
  return Boolean(
    existing.exists &&
    !existing.error,
  );
}

async function hasGenerationReleaseMarker(fs, ownerPath) {
  try {
    await fs.readFile(generationReleasedPath(ownerPath), 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function cleanupGenerationNode(fs, ownerPath) {
  const nextRemoved = await removeGenerationFile(fs, generationNextPath(ownerPath));
  const releaseRemoved = await removeGenerationFile(
    fs,
    generationReleasedPath(ownerPath),
  );
  const pendingRemoved = await removeGenerationFile(
    fs,
    generationPendingPath(ownerPath),
  );
  const compactingRemoved = await removeGenerationFile(
    fs,
    generationCompactingPath(ownerPath),
  );
  if (!nextRemoved || !releaseRemoved || !pendingRemoved || !compactingRemoved) {
    return false;
  }
  return removeGenerationFile(fs, ownerPath);
}

async function cleanupGenerationHistory(fs, nodes, currentOwnerPath) {
  let cleaned = true;
  for (const node of nodes) {
    if (node.ownerPath === currentOwnerPath) continue;
    if (!(await cleanupGenerationNode(fs, node.ownerPath))) cleaned = false;
  }
  return cleaned;
}

function generationMatchesTerminal(terminal, generation) {
  return Boolean(
    terminal &&
    terminal.exists &&
    !terminal.error &&
    terminal.ownerPath === generation.ownerPath &&
    lockOwnersMatch(terminal.owner, generation.owner),
  );
}

function terminalContainsGeneration(terminal, generation) {
  return Boolean(
    terminal &&
    !terminal.error &&
    terminal.nodes?.some((node) =>
      node.ownerPath === generation.ownerPath &&
      lockOwnersMatch(node.owner, generation.owner),
    ),
  );
}

async function cleanupUnreachableGenerationCandidate(fs, generation) {
  let cleaned = true;
  if (generation.predecessor) {
    const candidateLinkPath = generationNextPath(
      generation.predecessor.ownerPath,
    );
    const linked = await readLockOwner(fs, candidateLinkPath);
    if (linked.error) {
      cleaned = false;
    } else if (lockOwnersMatch(linked.record, generation.owner)) {
      cleaned = await removeGenerationFile(fs, candidateLinkPath);
    }
  }
  return (
    await cleanupGenerationCandidate(
      fs,
      generation.ownerPath,
      generation.pendingPath,
    )
  ) && cleaned;
}

async function cleanupPendingGenerationCandidate(
  fs,
  generationDirectory,
  pendingPath,
  ownerFileName,
  isProcessAlive,
) {
  const pending = await readLockOwner(fs, pendingPath);
  if (!pending.exists) return GENERATION_RESIDUE_CLEAN;
  if (
    pending.error ||
    !isReclaimableLockOwner(pending.record) ||
    ownerFileName !== generationOwnerFileName(pending.record.lockId)
  ) {
    return GENERATION_RESIDUE_FAILED;
  }

  const ownerPath = generationOwnerPath(
    generationDirectory,
    pending.record.lockId,
  );
  let owner = await readLockOwner(fs, ownerPath);
  if (
    owner.error ||
    (owner.exists && !lockOwnersMatch(owner.record, pending.record))
  ) {
    return GENERATION_RESIDUE_FAILED;
  }

  const generation = {
    owner: pending.record,
    ownerPath,
    pendingPath,
  };
  let terminal = await readGenerationTerminal(fs, generationDirectory);
  if (terminal.error) return GENERATION_RESIDUE_FAILED;
  if (terminalContainsGeneration(terminal, generation)) {
    return generationResidueResult(
      await removeGenerationFile(fs, pendingPath),
    );
  }

  let released = await hasGenerationReleaseMarker(fs, ownerPath);
  if (!released && !(await isConfirmedDead(isProcessAlive, pending.record.pid))) {
    return GENERATION_RESIDUE_BLOCKED;
  }

  const currentPending = await readLockOwner(fs, pendingPath);
  if (!currentPending.exists) return GENERATION_RESIDUE_CLEAN;
  if (
    currentPending.error ||
    !lockOwnersMatch(currentPending.record, pending.record)
  ) {
    return GENERATION_RESIDUE_FAILED;
  }
  owner = await readLockOwner(fs, ownerPath);
  if (
    owner.error ||
    (owner.exists && !lockOwnersMatch(owner.record, pending.record))
  ) {
    return GENERATION_RESIDUE_FAILED;
  }

  terminal = await readGenerationTerminal(fs, generationDirectory);
  if (terminal.error) return GENERATION_RESIDUE_FAILED;
  if (terminalContainsGeneration(terminal, generation)) {
    return generationResidueResult(
      await removeGenerationFile(fs, pendingPath),
    );
  }

  released = await hasGenerationReleaseMarker(fs, ownerPath);
  if (!released && !(await isConfirmedDead(isProcessAlive, pending.record.pid))) {
    return GENERATION_RESIDUE_BLOCKED;
  }
  if (!owner.exists) {
    return generationResidueResult(
      await removeGenerationFile(fs, pendingPath),
    );
  }
  return generationResidueResult(
    await cleanupGenerationNode(fs, ownerPath),
  );
}

async function rollbackCompactingGeneration(
  fs,
  generationDirectory,
  terminal,
  generation,
) {
  if (!generationMatchesTerminal(terminal, generation) || terminal.nodes.length < 2) {
    return false;
  }
  const predecessor = terminal.nodes[terminal.nodes.length - 2];
  const rollbackGeneration = {
    ...generation,
    predecessor: {
      owner: predecessor.owner,
      ownerPath: predecessor.ownerPath,
    },
  };
  if (!(
    await removeGenerationFile(
      fs,
      temporaryGenerationRootPath(
        generationDirectory,
        generation.owner.lockId,
      ),
    )
  )) {
    return false;
  }
  return cleanupUnreachableGenerationCandidate(fs, rollbackGeneration);
}

async function recoverGenerationCompactingMarker(
  fs,
  generationDirectory,
  terminal,
  isProcessAlive,
) {
  const generation = {
    owner: terminal.owner,
    ownerPath: terminal.ownerPath,
    pendingPath: generationPendingPath(terminal.ownerPath),
  };
  let marker = await readGenerationCompactingMarker(fs, generation);
  if (marker.error) return GENERATION_RESIDUE_FAILED;
  if (!marker.exists) return GENERATION_RESIDUE_CLEAN;

  let released = await hasGenerationReleaseMarker(fs, generation.ownerPath);
  if (!released && !(await isConfirmedDead(isProcessAlive, generation.owner.pid))) {
    return GENERATION_RESIDUE_BLOCKED;
  }

  const currentTerminal = await readGenerationTerminal(fs, generationDirectory);
  if (!generationMatchesTerminal(currentTerminal, generation)) {
    return GENERATION_RESIDUE_FAILED;
  }
  marker = await readGenerationCompactingMarker(fs, generation);
  if (marker.error) return GENERATION_RESIDUE_FAILED;
  if (!marker.exists) return GENERATION_RESIDUE_CLEAN;

  released = await hasGenerationReleaseMarker(fs, generation.ownerPath);
  if (!released && !(await isConfirmedDead(isProcessAlive, generation.owner.pid))) {
    return GENERATION_RESIDUE_BLOCKED;
  }
  if (currentTerminal.nodes.length === 1) {
    return generationResidueResult(
      await removeGenerationFile(
        fs,
        generationCompactingPath(generation.ownerPath),
      ),
    );
  }
  return (await rollbackCompactingGeneration(
    fs,
    generationDirectory,
    currentTerminal,
    generation,
  )) ? GENERATION_RESIDUE_BLOCKED : GENERATION_RESIDUE_FAILED;
}

async function cleanupUnreachableCompactingGeneration(
  fs,
  generationDirectory,
  compactingPath,
  ownerFileName,
  isProcessAlive,
) {
  const marker = await readLockOwner(fs, compactingPath);
  if (!marker.exists) return GENERATION_RESIDUE_CLEAN;
  if (
    marker.error ||
    !isReclaimableLockOwner(marker.record) ||
    ownerFileName !== generationOwnerFileName(marker.record.lockId)
  ) {
    return GENERATION_RESIDUE_FAILED;
  }

  const ownerPath = generationOwnerPath(
    generationDirectory,
    marker.record.lockId,
  );
  const generation = {
    owner: marker.record,
    ownerPath,
    pendingPath: generationPendingPath(ownerPath),
  };
  let owner = await readLockOwner(fs, ownerPath);
  if (owner.error || (owner.exists && !lockOwnersMatch(owner.record, marker.record))) {
    return GENERATION_RESIDUE_FAILED;
  }

  let terminal = await readGenerationTerminal(fs, generationDirectory);
  if (terminal.error) return GENERATION_RESIDUE_FAILED;
  if (terminalContainsGeneration(terminal, generation)) {
    if (!generationMatchesTerminal(terminal, generation)) {
      return GENERATION_RESIDUE_FAILED;
    }
    return recoverGenerationCompactingMarker(
      fs,
      generationDirectory,
      terminal,
      isProcessAlive,
    );
  }

  let released = await hasGenerationReleaseMarker(fs, ownerPath);
  if (!released && !(await isConfirmedDead(isProcessAlive, marker.record.pid))) {
    return GENERATION_RESIDUE_BLOCKED;
  }

  const currentMarker = await readGenerationCompactingMarker(fs, generation);
  if (currentMarker.error) return GENERATION_RESIDUE_FAILED;
  if (!currentMarker.exists) return GENERATION_RESIDUE_CLEAN;
  owner = await readLockOwner(fs, ownerPath);
  if (owner.error || (owner.exists && !lockOwnersMatch(owner.record, marker.record))) {
    return GENERATION_RESIDUE_FAILED;
  }
  terminal = await readGenerationTerminal(fs, generationDirectory);
  if (terminal.error) return GENERATION_RESIDUE_FAILED;
  if (terminalContainsGeneration(terminal, generation)) {
    if (!generationMatchesTerminal(terminal, generation)) {
      return GENERATION_RESIDUE_FAILED;
    }
    return recoverGenerationCompactingMarker(
      fs,
      generationDirectory,
      terminal,
      isProcessAlive,
    );
  }
  released = await hasGenerationReleaseMarker(fs, ownerPath);
  if (!released && !(await isConfirmedDead(isProcessAlive, marker.record.pid))) {
    return GENERATION_RESIDUE_BLOCKED;
  }
  if (!owner.exists) {
    return generationResidueResult(
      await removeGenerationFile(fs, compactingPath),
    );
  }
  return generationResidueResult(
    await cleanupGenerationNode(fs, ownerPath),
  );
}

async function cleanupUnreachableGenerationResidue(
  fs,
  generationDirectory,
  isProcessAlive,
) {
  const terminal = await readGenerationTerminal(fs, generationDirectory);
  if (terminal.error) return GENERATION_RESIDUE_FAILED;

  let fileNames;
  try {
    fileNames = await fs.readdir(generationDirectory);
  } catch {
    return GENERATION_RESIDUE_FAILED;
  }
  const knownFileNames = new Set(fileNames);
  const pendingOwnerFileNames = new Set();
  for (const fileName of fileNames) {
    const ownerFileName = generationArtifactOwnerFileName(
      fileName,
      GENERATION_PENDING_SUFFIX,
    );
    if (!ownerFileName) continue;
    pendingOwnerFileNames.add(ownerFileName);
    const pendingState = await cleanupPendingGenerationCandidate(
      fs,
      generationDirectory,
      path.join(generationDirectory, fileName),
      ownerFileName,
      isProcessAlive,
    );
    if (pendingState !== GENERATION_RESIDUE_CLEAN) {
      return pendingState;
    }
  }
  for (const fileName of fileNames) {
    const ownerFileName = generationArtifactOwnerFileName(
      fileName,
      GENERATION_COMPACTING_SUFFIX,
    );
    if (!ownerFileName) continue;
    const compactingState = await cleanupUnreachableCompactingGeneration(
      fs,
      generationDirectory,
      path.join(generationDirectory, fileName),
      ownerFileName,
      isProcessAlive,
    );
    if (compactingState !== GENERATION_RESIDUE_CLEAN) {
      return compactingState;
    }
  }
  for (const fileName of fileNames) {
    if (isTemporaryGenerationRootFileName(fileName)) {
      const temporaryRootPath = path.join(generationDirectory, fileName);
      const temporaryOwner = await readLockOwner(fs, temporaryRootPath);
      if (
        temporaryOwner.error ||
        !isReclaimableLockOwner(temporaryOwner.record)
      ) {
        return GENERATION_RESIDUE_FAILED;
      }
      const ownerPath = generationOwnerPath(
        generationDirectory,
        temporaryOwner.record.lockId,
      );
      const released = await hasGenerationReleaseMarker(fs, ownerPath);
      if (!released && !(await isConfirmedDead(isProcessAlive, temporaryOwner.record.pid))) {
        return GENERATION_RESIDUE_BLOCKED;
      }
      if (!(await removeGenerationFile(fs, temporaryRootPath))) {
        return GENERATION_RESIDUE_FAILED;
      }
      continue;
    }
    for (const suffix of ['.next', GENERATION_RELEASED_SUFFIX]) {
      const ownerFileName = generationArtifactOwnerFileName(fileName, suffix);
      if (
        ownerFileName &&
        !knownFileNames.has(ownerFileName) &&
        !(await removeGenerationFile(fs, path.join(generationDirectory, fileName)))
      ) {
        return GENERATION_RESIDUE_FAILED;
      }
    }
  }

  const currentTerminal = await readGenerationTerminal(fs, generationDirectory);
  if (currentTerminal.error) return GENERATION_RESIDUE_FAILED;
  const reachableOwnerPaths = new Set(
    currentTerminal.nodes.map((node) => node.ownerPath),
  );
  for (const fileName of fileNames) {
    if (!isGenerationOwnerFileName(fileName)) continue;

    if (pendingOwnerFileNames.has(fileName)) continue;
    const ownerPath = path.join(generationDirectory, fileName);
    if (reachableOwnerPaths.has(ownerPath)) continue;
    const owner = await readLockOwner(fs, ownerPath);
    if (!owner.exists) continue;
    if (owner.error || !isReclaimableLockOwner(owner.record)) {
      return GENERATION_RESIDUE_FAILED;
    }

    const currentTerminal = await readGenerationTerminal(fs, generationDirectory);
    if (currentTerminal.error) return GENERATION_RESIDUE_FAILED;
    if (terminalContainsGeneration(currentTerminal, {
      owner: owner.record,
      ownerPath,
    })) continue;

    if (!(await cleanupGenerationNode(fs, ownerPath))) return GENERATION_RESIDUE_FAILED;
  }
  return GENERATION_RESIDUE_CLEAN;
}

async function confirmGenerationTerminalAvailable(
  fs,
  generationDirectory,
  terminal,
  isProcessAlive,
) {
  let released = await hasGenerationReleaseMarker(fs, terminal.ownerPath);
  if (released) return { terminal, released: true };
  if (!(await isConfirmedDead(isProcessAlive, terminal.owner.pid))) return null;

  const currentTerminal = await readGenerationTerminal(fs, generationDirectory);
  if (!generationMatchesTerminal(currentTerminal, terminal)) return null;
  terminal = currentTerminal;
  released = await hasGenerationReleaseMarker(fs, terminal.ownerPath);
  if (!released && !(await isConfirmedDead(isProcessAlive, terminal.owner.pid))) {
    return null;
  }
  return { terminal, released };
}

async function finishCommittedCompactingGeneration(
  fs,
  generationDirectory,
  generation,
  historyNodes,
) {
  const historyCleaned = await cleanupGenerationHistory(
    fs,
    historyNodes,
    generation.ownerPath,
  );
  const currentTerminal = await readGenerationTerminal(fs, generationDirectory);
  if (!generationMatchesTerminal(currentTerminal, generation)) {
    generation.cleanupFailed = true;
    return generation;
  }
  if (!historyCleaned || !(
    await removeGenerationFile(
      fs,
      generationCompactingPath(generation.ownerPath),
    )
  )) {
    generation.cleanupFailed = true;
  }
  return generation;
}

async function recoverRenameFailureForCompactingGeneration(
  fs,
  generationDirectory,
  generation,
  historyNodes,
) {
  const temporaryRootPath = temporaryGenerationRootPath(
    generationDirectory,
    generation.owner.lockId,
  );
  if (!(
    await removeGenerationFile(fs, temporaryRootPath)
  )) {
    generation.cleanupFailed = true;
    return generation;
  }

  const currentTerminal = await readGenerationTerminal(fs, generationDirectory);
  if (!generationMatchesTerminal(currentTerminal, generation)) {
    generation.cleanupFailed = true;
    return generation;
  }
  if (currentTerminal.nodes.length === 1) {
    return finishCommittedCompactingGeneration(
      fs,
      generationDirectory,
      generation,
      historyNodes,
    );
  }
  if (await rollbackCompactingGeneration(
    fs,
    generationDirectory,
    currentTerminal,
    generation,
  )) {
    throw generationCleanupError();
  }
  generation.cleanupFailed = true;
  return generation;
}

async function compactPublisherGeneration(fs, generationDirectory, generation) {
  const terminal = await readGenerationTerminal(fs, generationDirectory);
  if (!generationMatchesTerminal(terminal, generation)) {
    if (terminal.error || !terminal.exists) {
      generation.cleanupFailed = true;
      return generation;
    }
    if (
      !terminalContainsGeneration(terminal, generation) &&
      !(await cleanupUnreachableGenerationCandidate(fs, generation))
    ) {
      generation.cleanupFailed = true;
      return generation;
    }
    return null;
  }
  const marker = await readGenerationCompactingMarker(fs, generation);
  if (marker.error || !marker.exists) {
    generation.cleanupFailed = true;
    return generation;
  }

  const temporaryRootPath = temporaryGenerationRootPath(
    generationDirectory,
    generation.owner.lockId,
  );
  try {
    await fs.link(generation.ownerPath, temporaryRootPath);
    await fs.rename(temporaryRootPath, generationRootPath(generationDirectory));
  } catch {
    return recoverRenameFailureForCompactingGeneration(
      fs,
      generationDirectory,
      generation,
      terminal.nodes,
    );
  }

  return finishCommittedCompactingGeneration(
    fs,
    generationDirectory,
    generation,
    terminal.nodes,
  );
}

async function createPublisherGenerationCandidate(
  fs,
  generationDirectory,
  owner,
  predecessor,
) {
  const ownerPath = generationOwnerPath(generationDirectory, owner.lockId);
  const generation = {
    owner,
    ownerPath,
    pendingPath: generationPendingPath(ownerPath),
    predecessor,
    released: false,
  };
  try {
    await writeGenerationCandidate(fs, generationDirectory, owner);
  } catch (error) {
    if (!(await cleanupGenerationCandidate(
      fs,
      generation.ownerPath,
      generation.pendingPath,
    ))) {
      generation.cleanupFailed = true;
      return generation;
    }
    throw error;
  }
  return generation;
}

async function tryAcquirePublisherGeneration(
  fs,
  generationDirectory,
  owner,
  isProcessAlive,
) {
  await fs.mkdir(generationDirectory, { recursive: true, mode: 0o700 });
  const residueState = await cleanupUnreachableGenerationResidue(
    fs,
    generationDirectory,
    isProcessAlive,
  );
  if (residueState === GENERATION_RESIDUE_BLOCKED) {
    return null;
  }
  if (residueState !== GENERATION_RESIDUE_CLEAN) {
    throw generationCleanupError();
  }

  const rootPath = generationRootPath(generationDirectory);
  let terminal = await readGenerationTerminal(fs, generationDirectory);

  if (!terminal.exists) {
    const generation = await createPublisherGenerationCandidate(
      fs,
      generationDirectory,
      owner,
      null,
    );
    if (generation.cleanupFailed) return generation;
    try {
      await fs.link(generation.ownerPath, rootPath);
      return completeGenerationCandidateLink(fs, generation);
    } catch (error) {
      if (!(await cleanupGenerationCandidate(
        fs,
        generation.ownerPath,
        generation.pendingPath,
      ))) {
        generation.cleanupFailed = true;
        return generation;
      }
      if (error?.code === 'EEXIST') {
        return null;
      }
      throw error;
    }
  }
  if (terminal.error) return null;

  const compactionState = await recoverGenerationCompactingMarker(
    fs,
    generationDirectory,
    terminal,
    isProcessAlive,
  );
  if (compactionState === GENERATION_RESIDUE_BLOCKED) return null;
  if (compactionState !== GENERATION_RESIDUE_CLEAN) {
    throw generationCleanupError();
  }
  terminal = await readGenerationTerminal(fs, generationDirectory);
  if (!terminal.exists || terminal.error) return null;

  let availableTerminal = await confirmGenerationTerminalAvailable(
    fs,
    generationDirectory,
    terminal,
    isProcessAlive,
  );
  if (!availableTerminal) return null;
  terminal = availableTerminal.terminal;
  let predecessorReleased = availableTerminal.released;

  const generation = await createPublisherGenerationCandidate(
    fs,
    generationDirectory,
    owner,
    {
      owner: terminal.owner,
      ownerPath: terminal.ownerPath,
      released: predecessorReleased,
    },
  );
  if (generation.cleanupFailed) return generation;
  if (!(await createGenerationCompactingMarker(fs, generation))) {
    if (!(await cleanupGenerationCandidate(
      fs,
      generation.ownerPath,
      generation.pendingPath,
    ))) {
      generation.cleanupFailed = true;
      return generation;
    }
    throw generationCleanupError();
  }
  try {
    await fs.link(
      generation.ownerPath,
      generationNextPath(terminal.ownerPath),
    );
  } catch (error) {
    if (!(await cleanupGenerationCandidate(
      fs,
      generation.ownerPath,
      generation.pendingPath,
    ))) {
      generation.cleanupFailed = true;
      return generation;
    }
    if (error?.code === 'EEXIST' || error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  await completeGenerationCandidateLink(fs, generation);
  if (generation.cleanupFailed) return generation;
  return compactPublisherGeneration(fs, generationDirectory, generation);
}

async function acquirePublisherGeneration(
  fs,
  generationDirectory,
  instanceId,
  isProcessAlive,
  pid,
  timer,
  lockRetryWaiters,
  shouldCancel,
) {
  let retries = 0;
  while (retries < LOCK_ACQUIRE_ATTEMPTS) {
    if (shouldCancel()) return null;
    const generation = await tryAcquirePublisherGeneration(
      fs,
      generationDirectory,
      createLockOwner(instanceId, pid),
      isProcessAlive,
    );
    if (generation) return generation;

    retries += 1;
    if (retries === LOCK_ACQUIRE_ATTEMPTS) throw lockAcquireError();
    const shouldRetry = await waitForLockRetry(timer, lockRetryWaiters);
    if (!shouldRetry || shouldCancel()) return null;
  }
  throw lockAcquireError();
}

async function releasePublisherGeneration(fs, generation) {
  if (!generation || generation.released) return true;
  try {
    await fs.writeFile(generationReleasedPath(generation.ownerPath), '', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code !== 'EEXIST') return false;
  }
  generation.released = true;
  return true;
}

function hasValidDescriptorOwner(descriptor) {
  return Boolean(
    descriptor &&
    typeof descriptor.instanceId === 'string' &&
    descriptor.instanceId.length > 0 &&
    isPositiveProcessId(descriptor.pid),
  );
}

async function canReplaceDescriptor(
  descriptor,
  instanceId,
  pid,
  clock,
  generation,
  isProcessAlive,
) {
  if (!descriptor) return true;
  if (hasDescriptorOwner(descriptor, instanceId, pid)) return true;
  if (
    generation?.predecessor?.released &&
    hasDescriptorOwner(
      descriptor,
      generation.predecessor.owner.instanceId,
      generation.predecessor.owner.pid,
    )
  ) {
    return true;
  }
  if (!hasValidDescriptorOwner(descriptor)) return false;

  let now;
  try {
    now = clock();
  } catch {
    return false;
  }
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(descriptor.expiresAtMs) ||
    descriptor.expiresAtMs > now
  ) {
    return false;
  }
  return isConfirmedDead(isProcessAlive, descriptor.pid);
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
  const quarantinePaths = new Set();

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

      let deadLockPath = null;
      if (reclaims < LOCK_ACQUIRE_ATTEMPTS) {
        try {
          deadLockPath = await quarantineDeadDescriptorLock(fs, lockPath, isProcessAlive);
        } catch {
          deadLockPath = null;
        }
      }
      if (deadLockPath) {
        quarantinePaths.add(deadLockPath);
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
  await cleanupQuarantinedLocks(fs, quarantinePaths);

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
  const generationDirectory = generationDirectoryPath(appData);
  let publisherGeneration;
  let hasPublished = false;
  let isSuperseded = false;
  let isClosed = false;
  let refreshTimer;
  let closePromise;
  let publication = Promise.resolve();
  let inFlightPublication;
  const lockRetryWaiters = new Set();
  const temporaryPaths = new Set();

  async function ensurePublisherGeneration() {
    if (publisherGeneration && !publisherGeneration.released) {
      return publisherGeneration;
    }
    const generation = await acquirePublisherGeneration(
      fs,
      generationDirectory,
      instanceId,
      isProcessAlive,
      pid,
      timer,
      lockRetryWaiters,
      () => isClosed || isSuperseded,
    );
    if (generation) publisherGeneration = generation;
    return generation;
  }

  async function releaseCurrentPublisherGeneration() {
    return releasePublisherGeneration(fs, publisherGeneration);
  }

  function stopRefreshTimer() {
    if (refreshTimer === undefined) return undefined;

    const timerToClear = refreshTimer;
    refreshTimer = undefined;
    try {
      timer.clearInterval(timerToClear);
      return undefined;
    } catch {
      return timerOperationError();
    }
  }

  async function relinquishSupersededGeneration() {
    isSuperseded = true;
    const refreshError = stopRefreshTimer();
    let released = false;
    try {
      released = await releaseCurrentPublisherGeneration();
    } catch {}
    if (refreshError) throw refreshError;
    if (!released) throw lockReleaseError();
  }

  function publish() {
    if (inFlightPublication) return inFlightPublication;

    const nextPublication = publication.then(async () => {
      try {
        if (isClosed || isSuperseded) return false;
        const generation = await ensurePublisherGeneration();
        if (!generation || isClosed || isSuperseded) return false;
        if (generation.cleanupFailed) {
          if (!(await releaseCurrentPublisherGeneration())) throw lockReleaseError();
          throw generationCleanupError();
        }

        let rejectedInitialDescriptor = false;
        let supersededDuringPublication = false;
        const published = await withDescriptorLock(
          fs,
          descriptorDirectory,
          timer,
          lockRetryWaiters,
          () => isClosed || isSuperseded,
          createLockOwner(instanceId, pid),
          isProcessAlive,
          async () => {
            if (isClosed || isSuperseded) return false;
            const existing = await readDescriptor(fs, descriptorPath);
            if (hasPublished) {
              if (!hasDescriptorOwner(existing, instanceId, pid)) {
                supersededDuringPublication = true;
                return false;
              }
            } else if (!(
              await canReplaceDescriptor(
                existing,
                instanceId,
                pid,
                clock,
                generation,
                isProcessAlive,
              )
            )) {
              rejectedInitialDescriptor = true;
              return false;
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
        if (supersededDuringPublication) isSuperseded = true;
        if (supersededDuringPublication && !isClosed) {
          await relinquishSupersededGeneration();
        } else if (rejectedInitialDescriptor && !isClosed) {
          if (!(await releaseCurrentPublisherGeneration())) throw lockReleaseError();
        }
        return published;
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
      const refreshError = stopRefreshTimer();
      if (refreshError && !closeError) closeError = refreshError;

      await publication;
      let removedDescriptor = false;
      if (hasPublished && !isSuperseded) {
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
      try {
        if (!(await releaseCurrentPublisherGeneration()) && !closeError) {
          closeError = lockReleaseError();
        }
      } catch {
        if (!closeError) closeError = lockReleaseError();
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
    if (published && !isClosed && !isSuperseded) {
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
