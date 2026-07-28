const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function loadBridgeDiscovery() {
  try {
    return require('./eisland-bridge-discovery');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return {};
    throw error;
  }
}

async function withTempAppData(run) {
  const appData = await fs.mkdtemp(path.join(os.tmpdir(), 'mineradio-bridge-discovery-'));
  try {
    return await run(appData);
  } finally {
    await fs.rm(appData, { force: true, recursive: true });
  }
}

function createIdleTimer() {
  return {
    clearInterval() {},
    clearTimeout(handle) {
      if (!handle) return;
      handle.cleared = true;
      globalThis.clearTimeout(handle.timeout);
    },
    setInterval() {
      return {};
    },
    setTimeout(callback, delay) {
      const handle = { cleared: false };
      handle.timeout = globalThis.setTimeout(() => {
        if (!handle.cleared) callback();
      }, delay);
      return handle;
    },
  };
}

function createControllableTimer() {
  return {
    intervals: [],
    timeouts: [],
    clearInterval(handle) {
      handle.clearCount += 1;
      handle.cleared = true;
    },
    clearTimeout(handle) {
      handle.clearCount += 1;
      handle.cleared = true;
    },
    setInterval(callback, delay) {
      const handle = {
        callback,
        clearCount: 0,
        cleared: false,
        delay,
      };
      this.intervals.push(handle);
      return handle;
    },
    setTimeout(callback, delay) {
      const handle = {
        callback,
        clearCount: 0,
        cleared: false,
        delay,
        fired: false,
      };
      this.timeouts.push(handle);
      return handle;
    },
    fireInterval(handle = this.intervals[0]) {
      return handle.callback();
    },
    fireTimeout(handle = this.timeouts.find((candidate) => !candidate.cleared && !candidate.fired)) {
      handle.fired = true;
      return handle.callback();
    },
  };
}

async function waitForTimeout(timer, count) {
  for (let turn = 0; turn < 20; turn += 1) {
    if (timer.timeouts.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`Expected ${count} scheduled timeout(s).`);
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('writes_exact_descriptor_schema', async () => {
  await withTempAppData(async (appData) => {
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    assert.equal(typeof createBridgeDiscoveryPublisher, 'function');

    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_567,
      clock: () => 1_000_000,
      instanceId: 'instance-schema',
      pid: 4_321,
      timer: createIdleTimer(),
      token: 'schema-test-token',
    });
    await publisher.ready;

    const descriptorPath = path.join(appData, 'Mineradio', 'eisland-bridge-v1.json');
    const descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
    assert.deepEqual(descriptor, {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_567,
      token: 'schema-test-token',
      instanceId: 'instance-schema',
      pid: 4_321,
      expiresAtMs: 1_005_000,
    });
    assert.deepEqual(Object.keys(descriptor).sort(), [
      'bridgePort',
      'expiresAtMs',
      'instanceId',
      'pid',
      'protocol',
      'token',
    ]);
  });
});

test('publishes_atomically_without_partial_json', async () => {
  await withTempAppData(async (appData) => {
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    assert.equal(typeof createBridgeDiscoveryPublisher, 'function');

    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    const priorDescriptor = JSON.stringify({ previous: 'complete-json' });
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(descriptorPath, priorDescriptor, 'utf8');

    const tempClosed = createDeferred();
    const permitRename = createDeferred();
    const gatedFs = {
      ...fs,
      async open(filePath, flags, mode) {
        const handle = await fs.open(filePath, flags, mode);
        return {
          close: async () => {
            await handle.close();
            tempClosed.resolve(filePath);
            await permitRename.promise;
          },
          writeFile: (...args) => handle.writeFile(...args),
        };
      },
    };
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_568,
      clock: () => 2_000_000,
      fs: gatedFs,
      instanceId: 'instance-atomic',
      pid: 4_322,
      timer: createIdleTimer(),
      token: 'atomic-test-token',
    });

    const firstEvent = await Promise.race([
      tempClosed.promise.then(() => 'temporary-file-closed'),
      publisher.ready.then(() => 'publication-complete'),
    ]);
    assert.equal(firstEvent, 'temporary-file-closed');

    const tempPath = await tempClosed.promise;
    assert.equal(path.dirname(tempPath), descriptorDirectory);
    assert.notEqual(tempPath, descriptorPath);
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), {
      previous: 'complete-json',
    });
    assert.deepEqual(JSON.parse(await fs.readFile(tempPath, 'utf8')), {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_568,
      token: 'atomic-test-token',
      instanceId: 'instance-atomic',
      pid: 4_322,
      expiresAtMs: 2_005_000,
    });

    permitRename.resolve();
    await publisher.ready;
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_568,
      token: 'atomic-test-token',
      instanceId: 'instance-atomic',
      pid: 4_322,
      expiresAtMs: 2_005_000,
    });
    await assert.rejects(fs.access(tempPath), { code: 'ENOENT' });
  });

  await withTempAppData(async (appData) => {
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const failureToken = 'atomic-failure-token';
    const failingFs = {
      ...fs,
      async rename() {
        throw new Error(failureToken);
      },
    };
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_569,
      clock: () => 3_000_000,
      fs: failingFs,
      instanceId: 'instance-atomic-failure',
      pid: 4_323,
      timer: createIdleTimer(),
      token: failureToken,
    });

    await assert.rejects(publisher.ready, (error) => {
      assert.doesNotMatch(String(error?.message), new RegExp(failureToken));
      return true;
    });

    const descriptorDirectory = path.join(appData, 'Mineradio');
    assert.deepEqual(await fs.readdir(descriptorDirectory), []);
  });
});

test('does_not_start_refresh_when_initial_publication_fails_and_close_is_safe', async () => {
  await withTempAppData(async (appData) => {
    const timer = {
      clearCount: 0,
      intervalCount: 0,
      clearInterval() {
        this.clearCount += 1;
      },
      setInterval() {
        this.intervalCount += 1;
        return {};
      },
    };
    const failureToken = 'initial-publication-failure-token';
    const failingFs = {
      ...fs,
      async rename() {
        throw new Error(failureToken);
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_572,
      clock: () => 3_500_000,
      fs: failingFs,
      instanceId: 'instance-initial-failure',
      pid: 4_326,
      timer,
      token: failureToken,
    });

    await assert.rejects(publisher.ready, (error) => {
      assert.doesNotMatch(String(error?.message), new RegExp(failureToken));
      return true;
    });
    assert.equal(timer.intervalCount, 0);

    await Promise.all([publisher.close(), publisher.close()]);
    assert.equal(timer.clearCount, 0);

    const descriptorDirectory = path.join(appData, 'Mineradio');
    assert.deepEqual(await fs.readdir(descriptorDirectory), []);
  });
});

test('never_overwrites_or_deletes_new_owner', async () => {
  await withTempAppData(async (appData) => {
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    assert.equal(typeof createBridgeDiscoveryPublisher, 'function');

    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_570,
      clock: () => 4_000_000,
      instanceId: 'instance-owner',
      pid: 4_324,
      timer: createIdleTimer(),
      token: 'owner-token',
    });
    await publisher.ready;

    const descriptorPath = path.join(appData, 'Mineradio', 'eisland-bridge-v1.json');
    const newOwnerDescriptor = {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 45_678,
      token: 'new-owner-token',
      instanceId: 'instance-owner',
      pid: 9_999,
      expiresAtMs: 4_999_999,
    };
    const newOwnerJson = JSON.stringify(newOwnerDescriptor);
    await fs.writeFile(descriptorPath, newOwnerJson, 'utf8');

    await publisher.publish();
    assert.equal(await fs.readFile(descriptorPath, 'utf8'), newOwnerJson);

    await publisher.close();
    assert.equal(await fs.readFile(descriptorPath, 'utf8'), newOwnerJson);
  });
});

test('refreshes_every_1000ms_with_5000ms_expiry_and_closes_idempotently', async () => {
  await withTempAppData(async (appData) => {
    const timer = {
      intervals: [],
      clearInterval(handle) {
        handle.clearCount += 1;
        handle.cleared = true;
      },
      setInterval(callback, delay) {
        const handle = {
          callback,
          clearCount: 0,
          cleared: false,
          delay,
        };
        this.intervals.push(handle);
        return handle;
      },
      async fire(handle = this.intervals[0]) {
        return handle.callback();
      },
    };
    let now = 5_000_000;
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_571,
      clock: () => now,
      instanceId: 'instance-lifecycle',
      pid: 4_325,
      timer,
      token: 'lifecycle-token',
    });
    await publisher.ready;

    assert.equal(timer.intervals.length, 1);
    assert.equal(timer.intervals[0].delay, 1_000);
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    assert.equal(
      JSON.parse(await fs.readFile(descriptorPath, 'utf8')).expiresAtMs,
      5_005_000,
    );

    now += 1_000;
    await timer.fire();
    assert.equal(
      JSON.parse(await fs.readFile(descriptorPath, 'utf8')).expiresAtMs,
      5_006_000,
    );

    const firstClose = publisher.close();
    const secondClose = publisher.close();
    await Promise.all([firstClose, secondClose]);
    assert.equal(timer.intervals[0].clearCount, 1);
    await assert.rejects(fs.access(descriptorPath), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(descriptorDirectory), []);

    const laterOwner = {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 45_679,
      token: 'later-owner-token',
      instanceId: 'later-instance',
      pid: 9_998,
      expiresAtMs: 5_999_999,
    };
    const laterOwnerJson = JSON.stringify(laterOwner);
    await fs.writeFile(descriptorPath, laterOwnerJson, 'utf8');

    now += 1_000;
    await timer.fire();
    await publisher.close();
    assert.equal(await fs.readFile(descriptorPath, 'utf8'), laterOwnerJson);
    assert.deepEqual(await fs.readdir(descriptorDirectory), ['eisland-bridge-v1.json']);
  });
});
test('does_not_overwrite_later_publisher_during_gated_refresh', async () => {
  await withTempAppData(async (appData) => {
    const timer = {
      intervals: [],
      clearInterval() {},
      setInterval(callback) {
        const handle = { callback };
        this.intervals.push(handle);
        return handle;
      },
      fire() {
        return this.intervals[0].callback();
      },
    };
    let renameCount = 0;
    const refreshRenameStarted = createDeferred();
    const permitRefreshRename = createDeferred();
    const gatedFs = {
      ...fs,
      async rename(fromPath, toPath) {
        renameCount += 1;
        if (renameCount === 2) {
          refreshRenameStarted.resolve();
          await permitRefreshRename.promise;
        }
        return fs.rename(fromPath, toPath);
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const oldPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_573,
      clock: () => 6_000_000,
      fs: gatedFs,
      instanceId: 'instance-refresh-old',
      pid: 4_327,
      timer,
      token: 'refresh-old-token',
    });
    await oldPublisher.ready;

    const refreshing = timer.fire();
    await refreshRenameStarted.promise;
    const newPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_574,
      clock: () => 6_000_000,
      instanceId: 'instance-refresh-new',
      pid: 4_328,
      timer: createIdleTimer(),
      token: 'refresh-new-token',
    });
    const newPublisherFinishedBeforeRefresh = await Promise.race([
      newPublisher.ready.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    assert.equal(newPublisherFinishedBeforeRefresh, false);

    permitRefreshRename.resolve();
    await Promise.all([refreshing, newPublisher.ready]);

    const descriptorPath = path.join(appData, 'Mineradio', 'eisland-bridge-v1.json');
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_574,
      token: 'refresh-new-token',
      instanceId: 'instance-refresh-new',
      pid: 4_328,
      expiresAtMs: 6_005_000,
    });
  });
});
test('does_not_delete_later_publisher_during_gated_close', async () => {
  await withTempAppData(async (appData) => {
    const descriptorPath = path.join(appData, 'Mineradio', 'eisland-bridge-v1.json');
    const closeUnlinkStarted = createDeferred();
    const permitCloseUnlink = createDeferred();
    const gatedFs = {
      ...fs,
      async unlink(filePath) {
        if (filePath === descriptorPath) {
          closeUnlinkStarted.resolve();
          await permitCloseUnlink.promise;
        }
        return fs.unlink(filePath);
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const oldPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_575,
      clock: () => 7_000_000,
      fs: gatedFs,
      instanceId: 'instance-close-old',
      pid: 4_329,
      timer: createIdleTimer(),
      token: 'close-old-token',
    });
    await oldPublisher.ready;

    const closing = oldPublisher.close();
    await closeUnlinkStarted.promise;
    const newPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_576,
      clock: () => 7_000_000,
      instanceId: 'instance-close-new',
      pid: 4_330,
      timer: createIdleTimer(),
      token: 'close-new-token',
    });
    const newPublisherFinishedBeforeClose = await Promise.race([
      newPublisher.ready.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    assert.equal(newPublisherFinishedBeforeClose, false);

    permitCloseUnlink.resolve();
    await Promise.all([closing, newPublisher.ready]);

    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_576,
      token: 'close-new-token',
      instanceId: 'instance-close-new',
      pid: 4_330,
      expiresAtMs: 7_005_000,
    });
  });
});
test('removes_owned_temporary_descriptor_after_transient_cleanup_failure', async () => {
  await withTempAppData(async (appData) => {
    const failureToken = 'temporary-cleanup-failure-token';
    let temporaryUnlinkAttempts = 0;
    let denyFirstSanitize = true;
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const foreignTemporaryPath = path.join(
      descriptorDirectory,
      '.eisland-bridge-v1.foreign.tmp',
    );
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(foreignTemporaryPath, 'foreign temporary descriptor', 'utf8');
    const failingFs = {
      ...fs,
      async rename() {
        throw new Error(failureToken);
      },
      async unlink(filePath) {
        if (filePath.endsWith('.tmp') && filePath !== foreignTemporaryPath) {
          temporaryUnlinkAttempts += 1;
          if (temporaryUnlinkAttempts < 3) throw new Error(failureToken);
        }
        return fs.unlink(filePath);
      },
      async writeFile(filePath, contents, options) {
        if (
          filePath.endsWith('.tmp') &&
          filePath !== foreignTemporaryPath &&
          contents === '' &&
          denyFirstSanitize
        ) {
          denyFirstSanitize = false;
          throw new Error(failureToken);
        }
        return fs.writeFile(filePath, contents, options);
      },
    };
    const timer = createControllableTimer();
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_577,
      clock: () => 8_000_000,
      fs: failingFs,
      instanceId: 'instance-temporary-cleanup',
      pid: 4_331,
      timer,
      token: failureToken,
    });

    await waitForTimeout(timer, 1);
    await timer.fireTimeout();
    await waitForTimeout(timer, 2);
    await timer.fireTimeout();
    await assert.rejects(publisher.ready, (error) => {
      assert.equal(error?.message, 'Bridge discovery descriptor publication failed.');
      assert.doesNotMatch(String(error?.message), new RegExp(failureToken));
      return true;
    });

    const temporaryNames = (await fs.readdir(descriptorDirectory)).filter((name) =>
      name.endsWith('.tmp'),
    );
    assert.equal(temporaryNames.length, 1);
    assert.equal(temporaryNames[0], path.basename(foreignTemporaryPath));
    assert.equal(await fs.readFile(foreignTemporaryPath, 'utf8'), 'foreign temporary descriptor');
    assert.equal(temporaryUnlinkAttempts, 3);

    await publisher.close();
    assert.deepEqual(await fs.readdir(descriptorDirectory), [
      path.basename(foreignTemporaryPath),
    ]);
  });
});
test('reports_persistent_owned_temporary_cleanup_failure_without_touching_foreign_files', async () => {
  await withTempAppData(async (appData) => {
    const failureToken = 'persistent-temporary-cleanup-failure-token';
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const foreignTemporaryPath = path.join(
      descriptorDirectory,
      '.eisland-bridge-v1.foreign.tmp',
    );
    let foreignUnlinkAttempts = 0;
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(foreignTemporaryPath, 'foreign temporary descriptor', 'utf8');
    const failingFs = {
      ...fs,
      async rename() {
        throw new Error(failureToken);
      },
      async unlink(filePath) {
        if (filePath === foreignTemporaryPath) foreignUnlinkAttempts += 1;
        if (filePath.endsWith('.tmp') && filePath !== foreignTemporaryPath) {
          throw new Error(failureToken);
        }
        return fs.unlink(filePath);
      },
      async writeFile(filePath, contents, options) {
        if (
          filePath.endsWith('.tmp') &&
          filePath !== foreignTemporaryPath &&
          contents === ''
        ) {
          throw new Error(failureToken);
        }
        return fs.writeFile(filePath, contents, options);
      },
    };
    const timer = createControllableTimer();
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_578,
      clock: () => 8_100_000,
      fs: failingFs,
      instanceId: 'instance-persistent-temporary-cleanup',
      pid: 4_332,
      timer,
      token: failureToken,
    });

    await waitForTimeout(timer, 1);
    await timer.fireTimeout();
    await waitForTimeout(timer, 2);
    await timer.fireTimeout();
    await assert.rejects(publisher.ready, (error) => {
      assert.equal(error?.message, 'Bridge discovery descriptor cleanup failed.');
      assert.doesNotMatch(String(error?.message), new RegExp(failureToken));
      return true;
    });

    const closing = publisher.close();
    await waitForTimeout(timer, 3);
    await timer.fireTimeout();
    await waitForTimeout(timer, 4);
    await timer.fireTimeout();
    await assert.rejects(closing, (error) => {
      assert.equal(error?.message, 'Bridge discovery descriptor cleanup failed.');
      assert.doesNotMatch(String(error?.message), new RegExp(failureToken));
      return true;
    });
    assert.equal(foreignUnlinkAttempts, 0);
    assert.equal(await fs.readFile(foreignTemporaryPath, 'utf8'), 'foreign temporary descriptor');
  });
});
test('cancels_pending_lock_acquisition_when_closed', async () => {
  await withTempAppData(async (appData) => {
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const lockPath = path.join(descriptorDirectory, '.eisland-bridge-v1.json.lock');
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(lockPath, 'external lock', 'utf8');
    let sawInitialLock = false;
    const lockedFs = {
      ...fs,
      async writeFile(filePath, contents, options) {
        try {
          return await fs.writeFile(filePath, contents, options);
        } catch (error) {
          if (
            filePath === lockPath &&
            options?.flag === 'wx' &&
            error?.code === 'EEXIST' &&
            !sawInitialLock
          ) {
            sawInitialLock = true;
            await fs.unlink(lockPath);
          }
          throw error;
        }
      },
    };
    const timer = createControllableTimer();
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_579,
      clock: () => 8_200_000,
      fs: lockedFs,
      instanceId: 'instance-cancel-lock',
      pid: 4_333,
      timer,
      token: 'cancel-lock-token',
    });

    await waitForTimeout(timer, 1);
    const ready = publisher.ready;
    const closing = publisher.close();
    assert.equal(timer.timeouts[0].cleared, true);
    assert.equal(await ready, false);
    assert.equal(await closing, false);
    assert.equal(sawInitialLock, true);
    await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
  });
});
test('does_not_report_success_when_descriptor_lock_release_persists', async () => {
  await withTempAppData(async (appData) => {
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const lockPath = path.join(descriptorDirectory, '.eisland-bridge-v1.json.lock');
    const failureToken = 'persistent-lock-release-failure-token';
    let rejectRelease = false;
    let releaseAttempts = 0;
    const failingFs = {
      ...fs,
      async unlink(filePath) {
        if (filePath === lockPath && rejectRelease) {
          releaseAttempts += 1;
          throw new Error(failureToken);
        }
        return fs.unlink(filePath);
      },
    };
    const timer = createControllableTimer();
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_580,
      clock: () => 8_300_000,
      fs: failingFs,
      instanceId: 'instance-release-lock',
      pid: 4_334,
      timer,
      token: failureToken,
    });
    await publisher.ready;

    rejectRelease = true;
    const refreshing = timer.fireInterval();
    try {
      await waitForTimeout(timer, 1);
      await timer.fireTimeout();
      await waitForTimeout(timer, 2);
      await timer.fireTimeout();
      assert.equal(await refreshing, false);
      assert.equal(releaseAttempts, 3);
    } finally {
      rejectRelease = false;
      await refreshing;
      await fs.unlink(lockPath).catch(() => {});
    }
  });
});
test('normalizes_mkdir_failure_without_leaking_token', async () => {
  await withTempAppData(async (appData) => {
    const failureToken = 'mkdir-failure-token';
    const failingFs = {
      ...fs,
      async mkdir() {
        throw new Error(failureToken);
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_578,
      clock: () => 9_000_000,
      fs: failingFs,
      instanceId: 'instance-mkdir-failure',
      pid: 4_332,
      timer: createIdleTimer(),
      token: failureToken,
    });

    await assert.rejects(publisher.ready, (error) => {
      assert.equal(error?.message, 'Bridge discovery descriptor publication failed.');
      assert.doesNotMatch(String(error?.message), new RegExp(failureToken));
      return true;
    });
    await Promise.all([publisher.close(), publisher.close()]);
  });
});
