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
    setInterval() {
      return {};
    },
  };
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
