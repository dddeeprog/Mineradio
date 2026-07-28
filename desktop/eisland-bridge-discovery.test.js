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

test('does_not_overwrite_fresh_active_external_descriptor_on_initial_publish', async () => {
  await withTempAppData(async (appData) => {
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    const externalDescriptor = {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_591,
      token: 'external-active-token',
      instanceId: 'external-active-instance',
      pid: 50_005,
      expiresAtMs: 9_205_000,
    };
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(descriptorPath, JSON.stringify(externalDescriptor), 'utf8');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_592,
      clock: () => 9_200_000,
      instanceId: 'instance-active-descriptor-candidate',
      isProcessAlive(candidatePid) {
        assert.equal(candidatePid, externalDescriptor.pid);
        return true;
      },
      pid: 4_347,
      timer: createIdleTimer(),
      token: 'candidate-active-descriptor-token',
    });

    assert.equal(await publisher.ready, false);
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), externalDescriptor);
    assert.equal(await publisher.close(), false);
  });
});
test('publishes_atomically_without_partial_json', async () => {
  await withTempAppData(async (appData) => {
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    assert.equal(typeof createBridgeDiscoveryPublisher, 'function');

    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    const priorDescriptor = {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_567,
      token: 'expired-prior-token',
      instanceId: 'expired-prior-instance',
      pid: 50_007,
      expiresAtMs: 1_999_999,
    };
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(descriptorPath, JSON.stringify(priorDescriptor), 'utf8');

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
      isProcessAlive(candidatePid) {
        assert.equal(candidatePid, priorDescriptor.pid);
        return false;
      },
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
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), priorDescriptor);
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
test('releases_superseded_generation_and_stops_refresh_without_deleting_foreign_descriptor', async () => {
  await withTempAppData(async (appData) => {
    const timer = createControllableTimer();
    const successorTimer = createControllableTimer();
    const firstPid = 4_329;
    const foreignDescriptor = {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_591,
      token: 'foreign-token',
      instanceId: 'foreign-instance',
      pid: 50_006,
      expiresAtMs: 9_999_000,
    };
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(
      descriptorDirectory,
      'eisland-bridge-v1.json',
    );
    const descriptorLockPath = path.join(
      descriptorDirectory,
      '.eisland-bridge-v1.json.lock',
    );
    let descriptorLockWriteAttempts = 0;
    const guardedFs = {
      ...fs,
      async writeFile(filePath, ...args) {
        if (filePath === descriptorLockPath) descriptorLockWriteAttempts += 1;
        return fs.writeFile(filePath, ...args);
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_573,
      clock: () => 10_000_000,
      fs: guardedFs,
      instanceId: 'instance-superseded',
      pid: firstPid,
      timer,
      token: 'superseded-token',
    });
    await publisher.ready;
    await fs.writeFile(descriptorPath, JSON.stringify(foreignDescriptor), 'utf8');

    let successor;
    try {
      assert.equal(await timer.fireInterval(), false);
      assert.equal(timer.intervals[0].cleared, true);
      assert.equal(timer.intervals[0].clearCount, 1);
      assert.deepEqual(
        JSON.parse(await fs.readFile(descriptorPath, 'utf8')),
        foreignDescriptor,
      );
      await publisher.close();
      assert.equal(descriptorLockWriteAttempts, 2);
      assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), foreignDescriptor);

      successor = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_592,
        clock: () => 10_000_000,
        instanceId: 'instance-superseded-successor',
        isProcessAlive: (candidatePid) => candidatePid === firstPid,
        pid: 4_330,
        timer: successorTimer,
        token: 'superseded-successor-token',
      });
      const successorReady = await Promise.race([
        successor.ready.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      assert.equal(successorReady, true);
      assert.deepEqual(
        JSON.parse(await fs.readFile(descriptorPath, 'utf8')),
        {
          protocol: 'mineradio-bridge/v1',
          bridgePort: 34_592,
          token: 'superseded-successor-token',
          instanceId: 'instance-superseded-successor',
          pid: 4_330,
          expiresAtMs: 10_005_000,
        },
      );
    } finally {
      await Promise.allSettled([successor?.close()]);
      await Promise.allSettled([publisher.close()]);
    }
  });
});

test('does_not_allow_later_publisher_to_take_over_until_old_publisher_closes', async () => {
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
    const newTimer = createControllableTimer();
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
    let newPublisher;

    try {
      const refreshing = timer.fire();
      await refreshRenameStarted.promise;
      newPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_574,
        clock: () => 6_000_000,
        instanceId: 'instance-refresh-new',
        isProcessAlive: () => true,
        pid: 4_328,
        timer: newTimer,
        token: 'refresh-new-token',
      });
      const newReady = newPublisher.ready;
      await waitForTimeout(newTimer, 1);

      permitRefreshRename.resolve();
      await refreshing;
      await newTimer.fireTimeout();
      const newPublisherFinishedBeforeClose = await Promise.race([
        newReady.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      assert.equal(newPublisherFinishedBeforeClose, false);
      await waitForTimeout(newTimer, 2);

      await oldPublisher.close();
      await newTimer.fireTimeout();
      await newReady;

      const descriptorPath = path.join(appData, 'Mineradio', 'eisland-bridge-v1.json');
      assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), {
        protocol: 'mineradio-bridge/v1',
        bridgePort: 34_574,
        token: 'refresh-new-token',
        instanceId: 'instance-refresh-new',
        pid: 4_328,
        expiresAtMs: 6_005_000,
      });
    } finally {
      permitRefreshRename.resolve();
      await Promise.allSettled([oldPublisher.close(), newPublisher?.close()]);
    }
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
      isProcessAlive: () => true,
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
test('normalizes_set_interval_failure_without_leaking_token', async () => {
  await withTempAppData(async (appData) => {
    const failureToken = 'set-interval-failure-token';
    const timer = {
      ...createIdleTimer(),
      setInterval() {
        throw new Error(failureToken);
      },
    };
    const unhandledReasons = [];
    const onUnhandledRejection = (reason) => unhandledReasons.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
      const publisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_581,
        clock: () => 8_400_000,
        instanceId: 'instance-set-interval',
        pid: 4_335,
        timer,
        token: failureToken,
      });

      await assert.rejects(publisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery descriptor timer operation failed.');
        assert.doesNotMatch(String(error?.message), new RegExp(failureToken));
        return true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandledReasons, []);

      await publisher.close();
      assert.deepEqual(await fs.readdir(path.join(appData, 'Mineradio')), []);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
test('normalizes_timer_teardown_failures_after_cleanup_with_one_close_promise', async () => {
  await withTempAppData(async (appData) => {
    const clearIntervalToken = 'clear-interval-failure-token';
    const clearTimeoutToken = 'clear-timeout-failure-token';
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    const lockPath = path.join(descriptorDirectory, '.eisland-bridge-v1.json.lock');
    let clearIntervalCalls = 0;
    let clearTimeoutCalls = 0;
    let releasedExternalLock = false;
    const timer = createControllableTimer();
    timer.clearInterval = () => {
      clearIntervalCalls += 1;
      throw new Error(clearIntervalToken);
    };
    timer.clearTimeout = () => {
      clearTimeoutCalls += 1;
      throw new Error(clearTimeoutToken);
    };
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
            !releasedExternalLock
          ) {
            releasedExternalLock = true;
            await fs.unlink(lockPath);
          }
          throw error;
        }
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_582,
      clock: () => 8_500_000,
      fs: lockedFs,
      instanceId: 'instance-timer-teardown',
      pid: 4_336,
      timer,
      token: `${clearIntervalToken}-${clearTimeoutToken}`,
    });
    await publisher.ready;

    await fs.writeFile(lockPath, 'external lock', 'utf8');
    const pendingPublication = publisher.publish();
    await waitForTimeout(timer, 1);

    let firstClose;
    assert.doesNotThrow(() => {
      firstClose = publisher.close();
    });
    const secondClose = publisher.close();

    assert.equal(typeof firstClose?.then, 'function');
    assert.strictEqual(firstClose, secondClose);
    assert.equal(await pendingPublication, false);
    assert.equal(clearTimeoutCalls, 1);
    assert.equal(clearIntervalCalls, 1);
    await assert.rejects(firstClose, (error) => {
      assert.equal(error?.message, 'Bridge discovery descriptor timer operation failed.');
      assert.doesNotMatch(String(error?.message), new RegExp(clearIntervalToken));
      assert.doesNotMatch(String(error?.message), new RegExp(clearTimeoutToken));
      return true;
    });
    await assert.rejects(fs.access(descriptorPath), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(descriptorDirectory), []);
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
test('reclaims_dead_owner_lock_before_publishing', async () => {
  await withTempAppData(async (appData) => {
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    const lockPath = path.join(descriptorDirectory, '.eisland-bridge-v1.json.lock');
    const deadOwner = {
      instanceId: 'crashed-instance',
      pid: 50_001,
      lockId: '3fc40e7c-6568-49c0-bb7d-0c6aa6a406e4',
    };
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify(deadOwner), 'utf8');
    let livenessChecks = 0;
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_583,
      clock: () => 8_600_000,
      instanceId: 'instance-reclaim-dead-lock',
      isProcessAlive(candidatePid) {
        livenessChecks += 1;
        assert.equal(candidatePid, deadOwner.pid);
        return false;
      },
      pid: 4_337,
      timer: createIdleTimer(),
      token: 'reclaim-dead-lock-token',
    });

    await publisher.ready;
    assert.ok(livenessChecks >= 1);
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_583,
      token: 'reclaim-dead-lock-token',
      instanceId: 'instance-reclaim-dead-lock',
      pid: 4_337,
      expiresAtMs: 8_605_000,
    });

    await publisher.close();
    assert.deepEqual(await fs.readdir(descriptorDirectory), []);
  });
});
test('does_not_let_residual_reclaim_file_block_dead_lock_recovery', async () => {
  await withTempAppData(async (appData) => {
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    const lockPath = path.join(descriptorDirectory, '.eisland-bridge-v1.json.lock');
    const deadOwner = {
      instanceId: 'crashed-residual-owner',
      pid: 50_002,
      lockId: '8af77d5a-7801-4226-bffe-f628503a7b2f',
    };
    const residualReclaimPath = `${lockPath}.${deadOwner.lockId}.reclaim`;
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify(deadOwner), 'utf8');
    await fs.writeFile(residualReclaimPath, '', 'utf8');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_587,
      clock: () => 8_900_000,
      instanceId: 'instance-residual-reclaim',
      isProcessAlive(candidatePid) {
        assert.equal(candidatePid, deadOwner.pid);
        return false;
      },
      pid: 4_343,
      timer: createIdleTimer(),
      token: 'residual-reclaim-token',
    });

    await publisher.ready;
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_587,
      token: 'residual-reclaim-token',
      instanceId: 'instance-residual-reclaim',
      pid: 4_343,
      expiresAtMs: 8_905_000,
    });
    assert.equal(await fs.readFile(residualReclaimPath, 'utf8'), '');

    await publisher.close();
    assert.deepEqual(await fs.readdir(descriptorDirectory), [
      path.basename(residualReclaimPath),
    ]);
  });
});
test('recovers_after_quarantine_move_failure_for_dead_lock', async () => {
  await withTempAppData(async (appData) => {
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    const lockPath = path.join(descriptorDirectory, '.eisland-bridge-v1.json.lock');
    const deadOwner = {
      instanceId: 'crashed-quarantine-owner',
      pid: 50_003,
      lockId: '39ba47e8-946c-4a63-a17c-e9f6a98aaa85',
    };
    let quarantinePath;
    let failAfterQuarantineMove = true;
    const interruptedFs = {
      ...fs,
      async rename(sourcePath, destinationPath) {
        await fs.rename(sourcePath, destinationPath);
        if (
          failAfterQuarantineMove &&
          sourcePath === lockPath &&
          destinationPath.startsWith(`${lockPath}.dead.${deadOwner.lockId}.`)
        ) {
          failAfterQuarantineMove = false;
          quarantinePath = destinationPath;
          const error = new Error('simulated reclaimer interruption');
          error.code = 'EIO';
          throw error;
        }
      },
    };
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify(deadOwner), 'utf8');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_588,
      clock: () => 9_000_000,
      fs: interruptedFs,
      instanceId: 'instance-quarantine-recovery',
      isProcessAlive(candidatePid) {
        assert.equal(candidatePid, deadOwner.pid);
        return false;
      },
      pid: 4_344,
      timer: createIdleTimer(),
      token: 'quarantine-recovery-token',
    });

    await publisher.ready;
    assert.equal(failAfterQuarantineMove, false);
    assert.ok(quarantinePath);
    assert.deepEqual(JSON.parse(await fs.readFile(quarantinePath, 'utf8')), deadOwner);
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_588,
      token: 'quarantine-recovery-token',
      instanceId: 'instance-quarantine-recovery',
      pid: 4_344,
      expiresAtMs: 9_005_000,
    });

    await publisher.close();
    assert.deepEqual(await fs.readdir(descriptorDirectory), [path.basename(quarantinePath)]);
  });
});
test('fences_dead_lock_reclaim_before_second_publisher_enters_critical_section', async () => {
  await withTempAppData(async (appData) => {
    const descriptorDirectory = path.join(appData, 'Mineradio');
    const descriptorPath = path.join(descriptorDirectory, 'eisland-bridge-v1.json');
    const lockPath = path.join(descriptorDirectory, '.eisland-bridge-v1.json.lock');
    const deadOwner = {
      instanceId: 'fence-dead-owner',
      pid: 50_004,
      lockId: 'd12b5e87-020f-44a6-a07e-7dca3c7b58da',
    };
    const firstValidationReached = createDeferred();
    const permitFirstValidation = createDeferred();
    const secondCriticalSectionReached = createDeferred();
    const permitSecondCriticalSection = createDeferred();
    const firstPid = 4_345;
    let firstLivenessChecks = 0;
    await fs.mkdir(descriptorDirectory, { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify(deadOwner), 'utf8');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_589,
      clock: () => 9_100_000,
      instanceId: 'instance-fence-first',
      isProcessAlive(candidatePid) {
        assert.equal(candidatePid, deadOwner.pid);
        firstLivenessChecks += 1;
        if (firstLivenessChecks === 2) {
          firstValidationReached.resolve();
          return permitFirstValidation.promise.then(() => false);
        }
        return false;
      },
      pid: firstPid,
      timer: createIdleTimer(),
      token: 'fence-first-token',
    });
    const firstReady = firstPublisher.ready;
    let secondPublisher;
    let secondReady;

    try {
      await firstValidationReached.promise;
      const secondFs = {
        ...fs,
        async rename(sourcePath, destinationPath) {
          if (destinationPath === descriptorPath) {
            secondCriticalSectionReached.resolve();
            await permitSecondCriticalSection.promise;
          }
          return fs.rename(sourcePath, destinationPath);
        },
      };
      secondPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_590,
        clock: () => 9_100_000,
        fs: secondFs,
        instanceId: 'instance-fence-second',
        isProcessAlive(candidatePid) {
          if (candidatePid === firstPid) return true;
          assert.equal(candidatePid, deadOwner.pid);
          return false;
        },
        pid: 4_346,
        timer: createIdleTimer(),
        token: 'fence-second-token',
      });
      secondReady = secondPublisher.ready;
      const secondEnteredBeforeFirstCompleted = await Promise.race([
        secondCriticalSectionReached.promise.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 50)),
      ]);

      assert.equal(secondEnteredBeforeFirstCompleted, false);
      permitFirstValidation.resolve();
      await firstReady;
    } finally {
      permitFirstValidation.resolve();
      permitSecondCriticalSection.resolve();
      await Promise.allSettled([firstReady, secondReady]);
      await Promise.allSettled([firstPublisher.close(), secondPublisher?.close()]);
    }
  });
});
test('keeps_active_and_permission_owner_locks', async () => {
  await withTempAppData(async (appData) => {
    const scenarios = [
      {
        name: 'active',
        probe: () => true,
      },
      {
        name: 'permission',
        probe: () => {
          const error = new Error('permission-owner-lock-token');
          error.code = 'EPERM';
          throw error;
        },
      },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const scenarioAppData = path.join(appData, scenario.name);
      const descriptorDirectory = path.join(scenarioAppData, 'Mineradio');
      const lockPath = path.join(descriptorDirectory, '.eisland-bridge-v1.json.lock');
      const owner = {
        instanceId: scenario.name + '-owner',
        pid: 50_010 + index,
        lockId: '3fc40e7c-6568-49c0-bb7d-0c6aa6a406e' + index,
      };
      const ownerText = JSON.stringify(owner);
      let livenessChecks = 0;
      let lockUnlinkAttempts = 0;
      await fs.mkdir(descriptorDirectory, { recursive: true });
      await fs.writeFile(lockPath, ownerText, 'utf8');
      const guardedFs = {
        ...fs,
        async unlink(filePath) {
          if (filePath === lockPath) lockUnlinkAttempts += 1;
          return fs.unlink(filePath);
        },
      };
      const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
      const publisher = createBridgeDiscoveryPublisher({
        appData: scenarioAppData,
        bridgePort: 34_584 + index,
        clock: () => 8_700_000,
        fs: guardedFs,
        instanceId: scenario.name + '-candidate',
        isProcessAlive(candidatePid) {
          livenessChecks += 1;
          assert.equal(candidatePid, owner.pid);
          return scenario.probe();
        },
        pid: 4_340 + index,
        timer: createIdleTimer(),
        token: scenario.name + '-candidate-token',
      });

      await assert.rejects(publisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery descriptor lock acquisition failed.');
        assert.doesNotMatch(String(error?.message), /permission-owner-lock-token/);
        return true;
      });
      assert.ok(livenessChecks >= 1);
      assert.equal(lockUnlinkAttempts, 0);
      assert.equal(await fs.readFile(lockPath, 'utf8'), ownerText);
      await publisher.close();
    }
  });
});

test('keeps_generation_metadata_bounded_across_many_complete_lifecycles', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();

    for (let round = 0; round < 32; round += 1) {
      const publisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_600 + round,
        clock: () => 10_100_000 + round,
        instanceId: 'instance-generation-bound-' + round,
        pid: 4_400 + round,
        timer: createIdleTimer(),
        token: 'generation-bound-token-' + round,
      });

      assert.equal(await publisher.ready, true);
      assert.equal(await publisher.close(), true);
      const entries = await fs.readdir(generationDirectory);
      assert.ok(
        entries.length <= 3,
        'Generation metadata must remain bounded; found ' + entries.length + ' entries.',
      );
    }
  });
});

test('does_not_accumulate_generation_metadata_when_historical_cleanup_persists', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_610,
      clock: () => 10_150_000,
      instanceId: 'instance-generation-cleanup-first',
      pid: 4_430,
      timer: createIdleTimer(),
      token: 'generation-cleanup-first-token',
    });
    await firstPublisher.ready;
    await firstPublisher.close();

    const firstRootOwner = JSON.parse(await fs.readFile(generationRootPath, 'utf8'));
    const firstOwnerPath = path.join(
      generationDirectory,
      'owner.' + firstRootOwner.lockId + '.json',
    );
    const stubbornHistoryPaths = new Set([
      firstOwnerPath,
      firstOwnerPath + '.next',
      firstOwnerPath + '.released',
    ]);
    const failingFs = {
      ...fs,
      async unlink(filePath) {
        if (stubbornHistoryPaths.has(filePath)) {
          const error = new Error('persistent-generation-cleanup-failure');
          error.code = 'EACCES';
          throw error;
        }
        return fs.unlink(filePath);
      },
    };
    let secondPublisher;
    let thirdPublisher;
    try {
      secondPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_611,
        clock: () => 10_150_000,
        fs: failingFs,
        instanceId: 'instance-generation-cleanup-second',
        pid: 4_431,
        timer: createIdleTimer(),
        token: 'generation-cleanup-second-token',
      });
      await assert.rejects(secondPublisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery generation cleanup failed.');
        return true;
      });
      await secondPublisher.close();

      const entriesBeforeRetry = (await fs.readdir(generationDirectory)).sort();
      thirdPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_612,
        clock: () => 10_150_000,
        fs: failingFs,
        instanceId: 'instance-generation-cleanup-third',
        pid: 4_432,
        timer: createIdleTimer(),
        token: 'generation-cleanup-third-token',
      });
      await assert.rejects(thirdPublisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery generation cleanup failed.');
        return true;
      });
      const entriesAfterRetry = await fs.readdir(generationDirectory);
      assert.ok(
        entriesAfterRetry.every((entry) => entriesBeforeRetry.includes(entry)),
        'Persistent cleanup may remove recovered intent, but must not add metadata.',
      );
    } finally {
      await Promise.allSettled([thirdPublisher?.close()]);
      await Promise.allSettled([secondPublisher?.close()]);
      await Promise.allSettled([firstPublisher.close()]);
    }
  });
});

test('cleans_an_unlinked_generation_candidate_after_link_failure', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const failingFs = {
      ...fs,
      async link() {
        const error = new Error('generation-link-failure');
        error.code = 'EACCES';
        throw error;
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_613,
      clock: () => 10_160_000,
      fs: failingFs,
      instanceId: 'instance-generation-link-failure',
      pid: 4_436,
      timer: createIdleTimer(),
      token: 'generation-link-failure-token',
    });

    await assert.rejects(publisher.ready);
    assert.deepEqual(await fs.readdir(generationDirectory), []);
    await publisher.close();
  });
});

test('blocks_a_live_pending_generation_candidate_before_appending', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const pendingPid = 4_448;
    const scannerRetryScheduled = createDeferred();
    const pendingOwner = {
      instanceId: 'instance-live-pending',
      pid: pendingPid,
      lockId: 'd9c93ca1-2b4f-4dc4-8d1f-0b3a6fa2e2b1',
    };
    const pendingOwnerPath = path.join(
      generationDirectory,
      'owner.' + pendingOwner.lockId + '.json',
    );
    const pendingPath = pendingOwnerPath + '.pending';
    await fs.mkdir(generationDirectory, { recursive: true });
    await fs.writeFile(pendingOwnerPath, JSON.stringify(pendingOwner), 'utf8');
    await fs.writeFile(pendingPath, JSON.stringify(pendingOwner), 'utf8');

    let generationLinkAttempts = 0;
    const scannerFs = {
      ...fs,
      async link(sourcePath, destinationPath) {
        if (destinationPath.startsWith(generationDirectory)) {
          generationLinkAttempts += 1;
        }
        return fs.link(sourcePath, destinationPath);
      },
    };
    const scannerTimer = {
      clearInterval() {},
      clearTimeout() {},
      setInterval() {
        return {};
      },
      setTimeout() {
        scannerRetryScheduled.resolve();
        return {};
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    let scannerPublisher;
    let scannerReadyError = Promise.resolve();
    try {
      scannerPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_616,
        clock: () => 10_165_000,
        fs: scannerFs,
        instanceId: 'instance-pending-bound-scanner',
        isProcessAlive(candidatePid) {
          return candidatePid === pendingPid;
        },
        pid: 4_450,
        timer: scannerTimer,
        token: 'pending-bound-scanner-token',
      });
      const scannerReady = scannerPublisher.ready;
      scannerReadyError = scannerReady.catch((error) => error);
      const scannerOutcome = await Promise.race([
        scannerRetryScheduled.promise.then(() => 'retry'),
        new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50)),
      ]);
      assert.equal(scannerOutcome, 'retry');
      assert.equal(generationLinkAttempts, 0);
      assert.deepEqual(
        (await fs.readdir(generationDirectory)).sort(),
        [path.basename(pendingOwnerPath), path.basename(pendingPath)].sort(),
      );
      assert.equal(
        await Promise.race([
          scannerReady.then(() => true, () => false),
          new Promise((resolve) => setTimeout(() => resolve(false), 20)),
        ]),
        false,
      );
    } finally {
      await Promise.allSettled([scannerPublisher?.close()]);
      await scannerReadyError;
    }
  });
});

test('releases_an_abandoned_prelink_candidate_and_reclaims_it', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const candidatePid = 4_451;
    const failingFs = {
      ...fs,
      async link(sourcePath, destinationPath) {
        if (destinationPath.endsWith('.next')) {
          const error = new Error('candidate-link-failure');
          error.code = 'EACCES';
          throw error;
        }
        return fs.link(sourcePath, destinationPath);
      },
      async unlink() {
        const error = new Error('candidate-cleanup-failure');
        error.code = 'EACCES';
        throw error;
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_614,
      clock: () => 10_165_000,
      instanceId: 'instance-prelink-first',
      pid: 4_449,
      timer: createIdleTimer(),
      token: 'prelink-first-token',
    });
    await firstPublisher.ready;
    await firstPublisher.close();

    let failingPublisher;
    let successorPublisher;
    try {
      failingPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_615,
        clock: () => 10_165_000,
        fs: failingFs,
        instanceId: 'instance-prelink-failing',
        pid: candidatePid,
        timer: createIdleTimer(),
        token: 'prelink-failing-token',
      });
      await assert.rejects(failingPublisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery generation cleanup failed.');
        return true;
      });

      const candidateMarker = (await fs.readdir(generationDirectory))
        .find((fileName) => fileName.endsWith('.compacting'));
      assert.ok(candidateMarker);
      const candidateOwnerFileName = candidateMarker.slice(
        0,
        -'.compacting'.length,
      );
      const candidateOwnerPath = path.join(
        generationDirectory,
        candidateOwnerFileName,
      );
      await fs.access(candidateOwnerPath);
      await fs.access(candidateOwnerPath + '.pending');
      await fs.access(candidateOwnerPath + '.compacting');
      await fs.access(candidateOwnerPath + '.released');

      successorPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_616,
        clock: () => 10_165_000,
        instanceId: 'instance-prelink-successor',
        isProcessAlive(candidatePidToCheck) {
          return candidatePidToCheck !== candidatePid;
        },
        pid: 4_450,
        timer: createIdleTimer(),
        token: 'prelink-successor-token',
      });
      assert.equal(await successorPublisher.ready, true);
      await assert.rejects(fs.access(candidateOwnerPath), { code: 'ENOENT' });
      await assert.rejects(fs.access(candidateOwnerPath + '.pending'), { code: 'ENOENT' });
      await assert.rejects(fs.access(candidateOwnerPath + '.compacting'), { code: 'ENOENT' });
      await assert.rejects(fs.access(candidateOwnerPath + '.released'), { code: 'ENOENT' });
    } finally {
      await Promise.allSettled([successorPublisher?.close()]);
      await Promise.allSettled([failingPublisher?.close()]);
      await Promise.allSettled([firstPublisher.close()]);
    }
  });
});

test('releases_a_generation_when_root_compaction_rename_fails', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const secondPid = 4_437;
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_614,
      clock: () => 10_170_000,
      instanceId: 'instance-root-rename-first',
      pid: 4_438,
      timer: createIdleTimer(),
      token: 'root-rename-first-token',
    });
    await firstPublisher.ready;
    await firstPublisher.close();

    const failingFs = {
      ...fs,
      async rename(sourcePath, destinationPath) {
        if (destinationPath === generationRootPath) {
          const error = new Error('root-compaction-rename-failure');
          error.code = 'EACCES';
          throw error;
        }
        return fs.rename(sourcePath, destinationPath);
      },
    };
    let secondPublisher;
    let successorPublisher;
    try {
      secondPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_615,
        clock: () => 10_170_000,
        fs: failingFs,
        instanceId: 'instance-root-rename-second',
        pid: secondPid,
        timer: createIdleTimer(),
        token: 'root-rename-second-token',
      });
      await assert.rejects(secondPublisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery generation cleanup failed.');
        return true;
      });

      successorPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_616,
        clock: () => 10_170_000,
        instanceId: 'instance-root-rename-successor',
        isProcessAlive(candidatePid) {
          return candidatePid === secondPid;
        },
        pid: 4_439,
        timer: createIdleTimer(),
        token: 'root-rename-successor-token',
      });
      assert.equal(await successorPublisher.ready, true);
    } finally {
      await Promise.allSettled([successorPublisher?.close()]);
      await Promise.allSettled([secondPublisher?.close()]);
      await Promise.allSettled([firstPublisher.close()]);
    }
  });
});

test('rolls_back_a_generation_after_explicit_root_compaction_rename_failure', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_622,
      clock: () => 10_171_000,
      instanceId: 'instance-root-rollback-first',
      pid: 4_451,
      timer: createIdleTimer(),
      token: 'root-rollback-first-token',
    });
    await firstPublisher.ready;
    await firstPublisher.close();
    const rootOwnerBeforeFailure = await fs.readFile(generationRootPath, 'utf8');
    const entriesBeforeFailure = (await fs.readdir(generationDirectory)).sort();

    const failingFs = {
      ...fs,
      async rename(sourcePath, destinationPath) {
        if (destinationPath === generationRootPath) {
          const error = new Error('explicit-root-compaction-rename-failure');
          error.code = 'EACCES';
          throw error;
        }
        return fs.rename(sourcePath, destinationPath);
      },
    };
    let publisher;
    try {
      publisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_623,
        clock: () => 10_171_000,
        fs: failingFs,
        instanceId: 'instance-root-rollback-failing',
        pid: 4_452,
        timer: createIdleTimer(),
        token: 'root-rollback-failing-token',
      });
      await assert.rejects(publisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery generation cleanup failed.');
        return true;
      });

      assert.equal(
        await fs.readFile(generationRootPath, 'utf8'),
        rootOwnerBeforeFailure,
      );
      assert.deepEqual(
        (await fs.readdir(generationDirectory)).sort(),
        entriesBeforeFailure,
      );
    } finally {
      await Promise.allSettled([publisher?.close()]);
      await Promise.allSettled([firstPublisher.close()]);
    }
  });
});

test('keeps_the_new_root_when_rename_reports_failure_after_commit', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_624,
      clock: () => 10_172_000,
      instanceId: 'instance-root-commit-first',
      pid: 4_453,
      timer: createIdleTimer(),
      token: 'root-commit-first-token',
    });
    await firstPublisher.ready;
    await firstPublisher.close();
    const previousRootOwner = JSON.parse(
      await fs.readFile(generationRootPath, 'utf8'),
    );
    const previousOwnerPath = path.join(
      generationDirectory,
      'owner.' + previousRootOwner.lockId + '.json',
    );

    const commitThenThrowFs = {
      ...fs,
      async rename(sourcePath, destinationPath) {
        const result = await fs.rename(sourcePath, destinationPath);
        if (destinationPath === generationRootPath) {
          const error = new Error('rename-reported-after-commit');
          error.code = 'EACCES';
          throw error;
        }
        return result;
      },
    };
    let publisher;
    try {
      publisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_625,
        clock: () => 10_172_000,
        fs: commitThenThrowFs,
        instanceId: 'instance-root-commit-second',
        pid: 4_454,
        timer: createIdleTimer(),
        token: 'root-commit-second-token',
      });
      assert.equal(await publisher.ready, true);

      const compactedOwner = JSON.parse(
        await fs.readFile(generationRootPath, 'utf8'),
      );
      assert.equal(compactedOwner.instanceId, 'instance-root-commit-second');
      assert.equal(compactedOwner.pid, 4_454);
      const compactedOwnerPath = path.join(
        generationDirectory,
        'owner.' + compactedOwner.lockId + '.json',
      );
      await fs.access(compactedOwnerPath);
      await assert.rejects(fs.access(previousOwnerPath), { code: 'ENOENT' });
      await assert.rejects(
        fs.access(compactedOwnerPath + '.compacting'),
        { code: 'ENOENT' },
      );
    } finally {
      await Promise.allSettled([publisher?.close()]);
      await Promise.allSettled([firstPublisher.close()]);
    }
  });
});

test('recovers_a_released_compacting_terminal_after_root_commit', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const terminalOwner = {
      instanceId: 'instance-recovery-root-terminal',
      pid: 4_455,
      lockId: '9a92864f-5f84-4f92-b8eb-a0e5b20c0911',
    };
    const terminalOwnerPath = path.join(
      generationDirectory,
      'owner.' + terminalOwner.lockId + '.json',
    );
    await fs.mkdir(generationDirectory, { recursive: true });
    await fs.writeFile(terminalOwnerPath, JSON.stringify(terminalOwner), 'utf8');
    await fs.link(terminalOwnerPath, generationRootPath);
    await fs.writeFile(
      terminalOwnerPath + '.compacting',
      JSON.stringify(terminalOwner),
      'utf8',
    );
    await fs.writeFile(terminalOwnerPath + '.released', '', 'utf8');

    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    let successorPublisher;
    try {
      successorPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_626,
        clock: () => 10_172_000,
        instanceId: 'instance-recovery-root-successor',
        isProcessAlive: () => false,
        pid: 4_456,
        timer: createIdleTimer(),
        token: 'recovery-root-successor-token',
      });
      assert.equal(await successorPublisher.ready, true);
      const rootOwner = JSON.parse(await fs.readFile(generationRootPath, 'utf8'));
      assert.equal(rootOwner.instanceId, 'instance-recovery-root-successor');
      await assert.rejects(fs.access(terminalOwnerPath), { code: 'ENOENT' });
      await assert.rejects(
        fs.access(terminalOwnerPath + '.compacting'),
        { code: 'ENOENT' },
      );
    } finally {
      await Promise.allSettled([successorPublisher?.close()]);
    }
  });
});

test('rolls_back_a_released_compacting_successor_before_retrying', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const predecessorOwner = {
      instanceId: 'instance-recovery-predecessor',
      pid: 4_457,
      lockId: 'b8b8fc2d-9ed8-4f1b-9d93-1a3ce5cfa011',
    };
    const candidateOwner = {
      instanceId: 'instance-recovery-linked-candidate',
      pid: 4_458,
      lockId: 'c1ab7db8-3185-4d32-83ca-3fc0cd9e6111',
    };
    const predecessorOwnerPath = path.join(
      generationDirectory,
      'owner.' + predecessorOwner.lockId + '.json',
    );
    const candidateOwnerPath = path.join(
      generationDirectory,
      'owner.' + candidateOwner.lockId + '.json',
    );
    await fs.mkdir(generationDirectory, { recursive: true });
    await fs.writeFile(
      predecessorOwnerPath,
      JSON.stringify(predecessorOwner),
      'utf8',
    );
    await fs.writeFile(
      candidateOwnerPath,
      JSON.stringify(candidateOwner),
      'utf8',
    );
    await fs.link(predecessorOwnerPath, generationRootPath);
    await fs.link(candidateOwnerPath, predecessorOwnerPath + '.next');
    await fs.writeFile(
      candidateOwnerPath + '.compacting',
      JSON.stringify(candidateOwner),
      'utf8',
    );
    await fs.writeFile(candidateOwnerPath + '.released', '', 'utf8');

    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    let successorPublisher;
    try {
      successorPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_627,
        clock: () => 10_172_000,
        instanceId: 'instance-recovery-linked-successor',
        isProcessAlive: () => false,
        pid: 4_459,
        timer: createIdleTimer(),
        token: 'recovery-linked-successor-token',
      });
      assert.equal(await successorPublisher.ready, true);
      const rootOwner = JSON.parse(await fs.readFile(generationRootPath, 'utf8'));
      assert.equal(rootOwner.instanceId, 'instance-recovery-linked-successor');
      await assert.rejects(fs.access(candidateOwnerPath), { code: 'ENOENT' });
      await assert.rejects(
        fs.access(candidateOwnerPath + '.compacting'),
        { code: 'ENOENT' },
      );
      await assert.rejects(
        fs.access(candidateOwnerPath + '.released'),
        { code: 'ENOENT' },
      );
    } finally {
      await Promise.allSettled([successorPublisher?.close()]);
    }
  });
});

test('reclaims_a_released_pending_compaction_intent_before_first_root', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const abandonedOwner = {
      instanceId: 'instance-recovery-pending-candidate',
      pid: 4_460,
      lockId: 'd2c0a53e-4f17-45fd-b08c-eec470ea7111',
    };
    const abandonedOwnerPath = path.join(
      generationDirectory,
      'owner.' + abandonedOwner.lockId + '.json',
    );
    await fs.mkdir(generationDirectory, { recursive: true });
    await fs.writeFile(
      abandonedOwnerPath,
      JSON.stringify(abandonedOwner),
      'utf8',
    );
    await fs.writeFile(
      abandonedOwnerPath + '.pending',
      JSON.stringify(abandonedOwner),
      'utf8',
    );
    await fs.writeFile(
      abandonedOwnerPath + '.compacting',
      JSON.stringify(abandonedOwner),
      'utf8',
    );
    await fs.writeFile(abandonedOwnerPath + '.released', '', 'utf8');

    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    let successorPublisher;
    try {
      successorPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_628,
        clock: () => 10_172_000,
        instanceId: 'instance-recovery-pending-successor',
        isProcessAlive: () => false,
        pid: 4_461,
        timer: createIdleTimer(),
        token: 'recovery-pending-successor-token',
      });
      assert.equal(await successorPublisher.ready, true);
      await assert.rejects(fs.access(abandonedOwnerPath), { code: 'ENOENT' });
      await assert.rejects(
        fs.access(abandonedOwnerPath + '.pending'),
        { code: 'ENOENT' },
      );
      await assert.rejects(
        fs.access(abandonedOwnerPath + '.compacting'),
        { code: 'ENOENT' },
      );
      await assert.rejects(
        fs.access(abandonedOwnerPath + '.released'),
        { code: 'ENOENT' },
      );
    } finally {
      await Promise.allSettled([successorPublisher?.close()]);
    }
  });
});

test('releases_a_generation_when_post_compaction_read_fails', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_617,
      clock: () => 10_175_000,
      instanceId: 'instance-root-read-first',
      pid: 4_440,
      timer: createIdleTimer(),
      token: 'root-read-first-token',
    });
    await firstPublisher.ready;
    await firstPublisher.close();

    let rootWasCompacted = false;
    const failingFs = {
      ...fs,
      async rename(sourcePath, destinationPath) {
        const result = await fs.rename(sourcePath, destinationPath);
        if (destinationPath === generationRootPath) rootWasCompacted = true;
        return result;
      },
      async readFile(filePath, ...args) {
        if (rootWasCompacted && filePath === generationRootPath) {
          const error = new Error('post-compaction-root-read-failure');
          error.code = 'EACCES';
          throw error;
        }
        return fs.readFile(filePath, ...args);
      },
    };
    let publisher;
    try {
      publisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_618,
        clock: () => 10_175_000,
        fs: failingFs,
        instanceId: 'instance-root-read-second',
        pid: 4_441,
        timer: createIdleTimer(),
        token: 'root-read-second-token',
      });
      await assert.rejects(publisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery generation cleanup failed.');
        return true;
      });

      const compactedRootOwner = JSON.parse(await fs.readFile(generationRootPath, 'utf8'));
      const compactedOwnerPath = path.join(
        generationDirectory,
        'owner.' + compactedRootOwner.lockId + '.json',
      );
      await fs.access(compactedOwnerPath + '.released');
    } finally {
      await Promise.allSettled([publisher?.close()]);
      await Promise.allSettled([firstPublisher.close()]);
    }
  });
});

test('does_not_append_after_persistent_root_compaction_rename_failure', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_617,
      clock: () => 10_180_000,
      instanceId: 'instance-root-rename-persistent-first',
      pid: 4_440,
      timer: createIdleTimer(),
      token: 'root-rename-persistent-first-token',
    });
    await firstPublisher.ready;
    await firstPublisher.close();

    const failingFs = {
      ...fs,
      async rename(sourcePath, destinationPath) {
        if (destinationPath === generationRootPath) {
          const error = new Error('persistent-root-compaction-rename-failure');
          error.code = 'EACCES';
          throw error;
        }
        return fs.rename(sourcePath, destinationPath);
      },
    };
    let secondPublisher;
    let thirdPublisher;
    try {
      secondPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_618,
        clock: () => 10_180_000,
        fs: failingFs,
        instanceId: 'instance-root-rename-persistent-second',
        pid: 4_441,
        timer: createIdleTimer(),
        token: 'root-rename-persistent-second-token',
      });
      await assert.rejects(secondPublisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery generation cleanup failed.');
        return true;
      });
      const entriesBeforeRetry = (await fs.readdir(generationDirectory)).sort();

      thirdPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_619,
        clock: () => 10_180_000,
        fs: failingFs,
        instanceId: 'instance-root-rename-persistent-third',
        pid: 4_442,
        timer: createIdleTimer(),
        token: 'root-rename-persistent-third-token',
      });
      await assert.rejects(thirdPublisher.ready, (error) => {
        assert.equal(error?.message, 'Bridge discovery generation cleanup failed.');
        return true;
      });
      assert.deepEqual(
        (await fs.readdir(generationDirectory)).sort(),
        entriesBeforeRetry,
      );
    } finally {
      await Promise.allSettled([thirdPublisher?.close()]);
      await Promise.allSettled([secondPublisher?.close()]);
      await Promise.allSettled([firstPublisher.close()]);
    }
  });
});

test('removes_a_live_unreachable_generation_candidate_before_acquiring_root', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const staleOwner = {
      instanceId: 'instance-live-unreachable-candidate',
      pid: 4_443,
      lockId: 'a14b5bc8-26f1-4bb1-8b16-5930ecb274da',
    };
    const staleOwnerPath = path.join(
      generationDirectory,
      'owner.' + staleOwner.lockId + '.json',
    );
    await fs.mkdir(generationDirectory, { recursive: true });
    await fs.writeFile(staleOwnerPath, JSON.stringify(staleOwner), 'utf8');

    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_620,
      clock: () => 10_190_000,
      instanceId: 'instance-live-unreachable-successor',
      isProcessAlive: () => true,
      pid: 4_444,
      timer: createIdleTimer(),
      token: 'live-unreachable-successor-token',
    });

    await publisher.ready;
    await assert.rejects(fs.access(staleOwnerPath), { code: 'ENOENT' });
    await publisher.close();
  });
});

test('fences_a_slow_compactor_before_any_later_generation_append', async () => {
  await withTempAppData(async (appData) => {
    const generationDirectory = path.join(
      appData,
      '.eisland-bridge-v1.json.generations',
    );
    const generationRootPath = path.join(generationDirectory, 'root');
    const candidatePid = 4_446;
    const candidateRootRenameStarted = createDeferred();
    const permitCandidateRootRename = createDeferred();
    const scannerRetryScheduled = createDeferred();
    let candidateRootRenameWasHeld = false;
    let scannerGenerationLinks = 0;
    let scannerRootRenames = 0;
    let scannerReadCompactingMarker = false;
    const candidateFs = {
      ...fs,
      async rename(sourcePath, destinationPath) {
        if (
          !candidateRootRenameWasHeld &&
          destinationPath === generationRootPath
        ) {
          candidateRootRenameWasHeld = true;
          candidateRootRenameStarted.resolve();
          await permitCandidateRootRename.promise;
        }
        return fs.rename(sourcePath, destinationPath);
      },
    };
    const scannerFs = {
      ...fs,
      async link(sourcePath, destinationPath) {
        if (destinationPath.startsWith(generationDirectory)) {
          scannerGenerationLinks += 1;
        }
        return fs.link(sourcePath, destinationPath);
      },
      async readFile(filePath, ...args) {
        if (filePath.endsWith('.compacting')) {
          scannerReadCompactingMarker = true;
        }
        return fs.readFile(filePath, ...args);
      },
      async rename(sourcePath, destinationPath) {
        if (destinationPath === generationRootPath) {
          scannerRootRenames += 1;
        }
        return fs.rename(sourcePath, destinationPath);
      },
    };
    const scannerTimer = {
      clearInterval() {},
      clearTimeout() {},
      setInterval() {
        return {};
      },
      setTimeout() {
        scannerRetryScheduled.resolve();
        return {};
      },
    };
    const { createBridgeDiscoveryPublisher } = loadBridgeDiscovery();
    const firstPublisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_636,
      clock: () => 10_210_000,
      instanceId: 'instance-unreachable-cleanup-first',
      pid: 4_445,
      timer: createIdleTimer(),
      token: 'unreachable-cleanup-first-token',
    });
    await firstPublisher.ready;
    await firstPublisher.close();
    const rootOwnerBeforeCompaction = await fs.readFile(generationRootPath, 'utf8');

    let candidatePublisher;
    let scannerPublisher;
    let candidateReadyError = Promise.resolve();
    let scannerReadyError = Promise.resolve();
    try {
      candidatePublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_637,
        clock: () => 10_210_000,
        fs: candidateFs,
        instanceId: 'instance-unreachable-cleanup-candidate',
        isProcessAlive(candidatePidToCheck) {
          return candidatePidToCheck === candidatePid;
        },
        pid: candidatePid,
        timer: createIdleTimer(),
        token: 'unreachable-cleanup-candidate-token',
      });
      const candidateReady = candidatePublisher.ready;
      candidateReadyError = candidateReady.catch((error) => error);
      await candidateRootRenameStarted.promise;

      scannerPublisher = createBridgeDiscoveryPublisher({
        appData,
        bridgePort: 34_638,
        clock: () => 10_210_000,
        fs: scannerFs,
        instanceId: 'instance-unreachable-cleanup-scanner',
        isProcessAlive(candidatePidToCheck) {
          return candidatePidToCheck === candidatePid;
        },
        pid: 4_447,
        timer: scannerTimer,
        token: 'unreachable-cleanup-scanner-token',
      });
      const scannerReady = scannerPublisher.ready;
      scannerReadyError = scannerReady.catch((error) => error);
      await scannerRetryScheduled.promise;
      assert.equal(scannerReadCompactingMarker, true);
      assert.equal(scannerGenerationLinks, 0);
      assert.equal(scannerRootRenames, 0);
      assert.equal(
        await fs.readFile(generationRootPath, 'utf8'),
        rootOwnerBeforeCompaction,
      );
      assert.equal(
        await Promise.race([
          scannerReady.then(() => true, () => false),
          new Promise((resolve) => setTimeout(() => resolve(false), 20)),
        ]),
        false,
      );

      permitCandidateRootRename.resolve();
      assert.equal(await candidateReady, true);
    } finally {
      permitCandidateRootRename.resolve();
      await Promise.allSettled([scannerPublisher?.close()]);
      await Promise.allSettled([candidatePublisher?.close()]);
      await scannerReadyError;
      await candidateReadyError;
      await Promise.allSettled([firstPublisher.close()]);
    }
  });
});

test('coalesces_refresh_ticks_while_publication_is_in_flight', async () => {
  await withTempAppData(async (appData) => {
    const timer = createControllableTimer();
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
    const publisher = createBridgeDiscoveryPublisher({
      appData,
      bridgePort: 34_586,
      clock: () => 8_800_000,
      fs: gatedFs,
      instanceId: 'instance-coalesced-refresh',
      pid: 4_342,
      timer,
      token: 'coalesced-refresh-token',
    });
    await publisher.ready;

    const firstRefresh = timer.fireInterval();
    await refreshRenameStarted.promise;
    const repeatedRefreshes = [
      timer.fireInterval(),
      timer.fireInterval(),
      timer.fireInterval(),
    ];
    permitRefreshRename.resolve();
    await Promise.all([firstRefresh, ...repeatedRefreshes]);

    assert.equal(renameCount, 2);
    const descriptorDirectory = path.join(appData, 'Mineradio');
    assert.deepEqual(await fs.readdir(descriptorDirectory), ['eisland-bridge-v1.json']);
    assert.deepEqual(JSON.parse(await fs.readFile(
      path.join(descriptorDirectory, 'eisland-bridge-v1.json'),
      'utf8',
    )), {
      protocol: 'mineradio-bridge/v1',
      bridgePort: 34_586,
      token: 'coalesced-refresh-token',
      instanceId: 'instance-coalesced-refresh',
      pid: 4_342,
      expiresAtMs: 8_805_000,
    });

    await publisher.close();
    assert.deepEqual(await fs.readdir(descriptorDirectory), []);
  });
});
