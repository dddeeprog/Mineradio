'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const credentialStoreModule = require('./credential-store');
const {
  CREDENTIAL_SCHEMA,
  SUPPORTED_CREDENTIAL_PROVIDERS,
  createCredentialStore,
  discardCredentialStoreFile,
  writeFileAtomic,
} = credentialStoreModule;

const TEST_NOW = '2026-07-28T12:34:56.000Z';

function createSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.from(value, 'utf8').map(byte => byte ^ 0xa5);
    },
    decryptString(value) {
      return Buffer.from(value).map(byte => byte ^ 0xa5).toString('utf8');
    },
  };
}

function createMemoryDisk(initialValue) {
  let value = initialValue == null ? null : Buffer.from(initialValue);
  const calls = {
    reads: 0,
    writes: 0,
    removes: 0,
  };

  return {
    calls,
    exists: () => value != null,
    value: () => (value == null ? null : Buffer.from(value)),
    readFile() {
      calls.reads += 1;
      if (value == null) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return Buffer.from(value);
    },
    writeFileAtomic(_filePath, nextValue) {
      calls.writes += 1;
      value = Buffer.from(nextValue);
    },
    removeFile() {
      calls.removes += 1;
      if (value == null) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      value = null;
    },
  };
}

function createEncryptedStore(disk, options = {}) {
  return createCredentialStore({
    filePath: 'credentials.bin',
    safeStorage: options.safeStorage || createSafeStorage(),
    readFile: disk.readFile,
    writeFileAtomic: disk.writeFileAtomic,
    removeFile: disk.removeFile,
    now: options.now || (() => TEST_NOW),
  });
}

function encryptEnvelope(safeStorage, envelope) {
  return safeStorage.encryptString(JSON.stringify(envelope));
}

function serializeError(error) {
  return JSON.stringify(error, Object.getOwnPropertyNames(error));
}

function makeTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-credentials-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('exports the exact supported provider contract', () => {
  assert.deepEqual(
    SUPPORTED_CREDENTIAL_PROVIDERS,
    ['netease', 'qq', 'kugou', 'qishui', 'spotify'],
  );
  assert.equal(Object.isFrozen(SUPPORTED_CREDENTIAL_PROVIDERS), true);
});

test('exports only the credential store API and required helpers', () => {
  assert.deepEqual(
    Object.keys(credentialStoreModule).sort(),
    [
      'CREDENTIAL_SCHEMA',
      'SUPPORTED_CREDENTIAL_PROVIDERS',
      'createCredentialStore',
      'discardCredentialStoreFile',
      'writeFileAtomic',
    ].sort(),
  );
});

test('persists only encrypted envelope bytes and reads one provider', () => {
  const safeStorage = createSafeStorage();
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk, { safeStorage });
  const credential = {
    accountId: 'tomato',
    refreshToken: 'refresh-secret',
    nested: { clientSecret: 'client-secret' },
  };

  const result = store.set('spotify', credential);

  assert.deepEqual(result, { persisted: true, mode: 'encrypted' });
  assert.equal(Buffer.isBuffer(disk.value()), true);
  assert.equal(disk.value().includes(Buffer.from('refresh-secret')), false);
  assert.equal(disk.value().includes(Buffer.from('client-secret')), false);
  assert.deepEqual(
    JSON.parse(safeStorage.decryptString(disk.value())),
    {
      schema: CREDENTIAL_SCHEMA,
      providers: {
        spotify: {
          credential,
          accountId: 'tomato',
          updatedAt: TEST_NOW,
        },
      },
    },
  );

  const reloaded = createEncryptedStore(disk, { safeStorage });
  assert.deepEqual(reloaded.get('spotify'), credential);
  assert.equal(reloaded.get('netease'), null);
});

test('persists and verifies a credential migration marker across restarts without exposing it', () => {
  const migrationId = 'a'.repeat(64);
  const safeStorage = createSafeStorage();
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk, { safeStorage });

  store.set(
    'netease',
    { accountId: 'migration-user', cookie: 'MUSIC_U=migration-secret' },
    { migrationId },
  );

  assert.equal(store.hasMigration('netease', migrationId), true);
  assert.equal(store.hasMigration('netease', 'b'.repeat(64)), false);
  const decrypted = JSON.parse(safeStorage.decryptString(disk.value()));
  assert.equal(decrypted.providers.netease.migrationId, migrationId);

  const reloaded = createEncryptedStore(disk, { safeStorage });
  assert.equal(reloaded.hasMigration('netease', migrationId), true);
  assert.equal(JSON.stringify(reloaded.snapshot()).includes(migrationId), false);
  assert.equal(JSON.stringify(reloaded.snapshot()).includes('migration-secret'), false);
});

test('loads legacy encrypted records without migration markers and replaces stale markers on login', () => {
  const safeStorage = createSafeStorage();
  const migrationId = 'c'.repeat(64);
  const disk = createMemoryDisk(encryptEnvelope(safeStorage, {
    schema: CREDENTIAL_SCHEMA,
    providers: {
      qq: {
        credential: { accountId: 'legacy-user', cookie: 'uin=legacy-secret' },
        accountId: 'legacy-user',
        updatedAt: TEST_NOW,
      },
    },
  }));
  const store = createEncryptedStore(disk, { safeStorage });

  assert.equal(store.hasMigration('qq', migrationId), false);
  store.set(
    'qq',
    { accountId: 'imported-user', cookie: 'uin=imported-secret' },
    { migrationId },
  );
  assert.equal(store.hasMigration('qq', migrationId), true);

  store.set('qq', { accountId: 'interactive-user', cookie: 'uin=interactive-secret' });
  assert.equal(store.hasMigration('qq', migrationId), false);
});

test('encrypted stores refresh disk before merging sequential provider writes', () => {
  const disk = createMemoryDisk();
  const first = createEncryptedStore(disk);
  const second = createEncryptedStore(disk);

  first.set('netease', {
    accountId: 'netease-user',
    cookie: 'netease-secret',
  });
  second.set('spotify', {
    accountId: 'spotify-user',
    refreshToken: 'spotify-secret',
  });

  assert.deepEqual(second.get('netease'), {
    accountId: 'netease-user',
    cookie: 'netease-secret',
  });
  assert.deepEqual(second.get('spotify'), {
    accountId: 'spotify-user',
    refreshToken: 'spotify-secret',
  });
  assert.equal(disk.calls.reads, 4);

  const reloaded = createEncryptedStore(disk);
  assert.deepEqual(reloaded.get('netease'), {
    accountId: 'netease-user',
    cookie: 'netease-secret',
  });
  assert.deepEqual(reloaded.get('spotify'), {
    accountId: 'spotify-user',
    refreshToken: 'spotify-secret',
  });
});

test('get returns a fresh deep copy of credential data', () => {
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk);
  store.set('netease', {
    accountId: 'user-1',
    cookie: 'MUSIC_U=secret',
    profile: { aliases: ['first'] },
  });

  const first = store.get('netease');
  first.cookie = 'changed';
  first.profile.aliases.push('second');

  assert.deepEqual(store.get('netease'), {
    accountId: 'user-1',
    cookie: 'MUSIC_U=secret',
    profile: { aliases: ['first'] },
  });
  assert.notStrictEqual(store.get('netease'), store.get('netease'));
});

test('preserves every recursively JSON-safe credential value', () => {
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk);
  const credential = {
    accountId: 'json-safe',
    nullable: null,
    string: 'value',
    boolean: false,
    number: -12.5,
    array: [null, 'nested', true, 42, { deeper: ['value'] }],
    object: { nested: { zero: 0 } },
  };

  store.set('spotify', credential);

  assert.deepEqual(store.get('spotify'), credential);
  assert.deepEqual(createEncryptedStore(disk).get('spotify'), credential);
});

test('a missing credential file starts as an empty encrypted store', () => {
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk);

  assert.equal(store.get('qq'), null);
  assert.deepEqual(store.snapshot(), {
    schema: CREDENTIAL_SCHEMA,
    mode: 'encrypted',
    persistenceAvailable: true,
    providers: [],
  });
  assert.equal(disk.calls.writes, 0);
  assert.equal(disk.calls.removes, 0);
});

test('an existing empty ciphertext file is corrupt and remains untouched', () => {
  const ciphertext = Buffer.alloc(0);
  const disk = createMemoryDisk(ciphertext);

  assert.throws(
    () => createEncryptedStore(disk),
    error => error.code === 'CREDENTIAL_STORE_CORRUPT'
      && error.message === 'Credential store data is corrupt',
  );
  assert.deepEqual(disk.value(), ciphertext);
  assert.equal(disk.calls.reads, 1);
  assert.equal(disk.calls.writes, 0);
  assert.equal(disk.calls.removes, 0);
});

test('memory-only mode never touches disk and is lost on restart', () => {
  const diskAccess = [];
  const options = {
    filePath: 'credentials.bin',
    safeStorage: { isEncryptionAvailable: () => false },
    readFile: () => {
      diskAccess.push('read');
      throw new Error('must not read');
    },
    writeFileAtomic: () => {
      diskAccess.push('write');
      throw new Error('must not write');
    },
    removeFile: () => {
      diskAccess.push('remove');
      throw new Error('must not remove');
    },
    now: () => TEST_NOW,
  };
  const store = createCredentialStore(options);

  assert.deepEqual(
    store.set(
      'netease',
      { accountId: 'local', cookie: 'MUSIC_U=secret' },
      { migrationId: 'd'.repeat(64) },
    ),
    { persisted: false, mode: 'memory-only' },
  );
  assert.equal(store.hasMigration('netease', 'd'.repeat(64)), false);
  assert.deepEqual(store.get('netease'), {
    accountId: 'local',
    cookie: 'MUSIC_U=secret',
  });
  assert.deepEqual(store.snapshot(), {
    schema: CREDENTIAL_SCHEMA,
    mode: 'memory-only',
    persistenceAvailable: false,
    providers: [{
      provider: 'netease',
      accountId: 'local',
      updatedAt: TEST_NOW,
      hasCredential: true,
    }],
  });
  store.delete('netease');
  store.set('qq', { token: 'secret' });
  store.clear();
  assert.deepEqual(diskAccess, []);

  const restarted = createCredentialStore(options);
  assert.equal(restarted.get('netease'), null);
  assert.equal(restarted.get('qq'), null);
  assert.deepEqual(diskAccess, []);
});

test('rejects invalid migration markers before writing and keeps errors secret-free', () => {
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk);

  assert.throws(
    () => store.set(
      'spotify',
      { refreshToken: 'migration-marker-secret' },
      { migrationId: 'not-a-valid-marker' },
    ),
    error => error.code === 'CREDENTIAL_STORE_INVALID_MIGRATION_ID'
      && !serializeError(error).includes('migration-marker-secret')
      && !serializeError(error).includes('not-a-valid-marker'),
  );
  assert.equal(disk.calls.writes, 0);
  assert.equal(store.get('spotify'), null);
});

test('memory-only logout can explicitly discard legacy ciphertext without reading or writing', () => {
  const disk = createMemoryDisk(Buffer.from('legacy-encrypted-data'));
  const store = createCredentialStore({
    filePath: 'credentials.bin',
    safeStorage: { isEncryptionAvailable: () => false },
    readFile: disk.readFile,
    writeFileAtomic: disk.writeFileAtomic,
    removeFile: disk.removeFile,
    now: () => TEST_NOW,
  });
  store.set('qq', { accountId: 'memory-user', token: 'memory-secret' });

  assert.equal(store.clear(), true);
  assert.equal(disk.exists(), true);
  assert.equal(disk.calls.reads, 0);
  assert.equal(disk.calls.writes, 0);
  assert.equal(disk.calls.removes, 0);

  assert.equal(discardCredentialStoreFile({
    filePath: 'credentials.bin',
    removeFile: disk.removeFile,
  }), true);
  assert.equal(disk.exists(), false);
  assert.equal(disk.calls.reads, 0);
  assert.equal(disk.calls.writes, 0);
  assert.equal(disk.calls.removes, 1);

  assert.equal(discardCredentialStoreFile({
    filePath: 'credentials.bin',
    removeFile: disk.removeFile,
  }), false);
  assert.equal(disk.calls.removes, 2);
});

test('rejects unknown providers on every provider operation', () => {
  const store = createCredentialStore({
    filePath: 'credentials.bin',
    safeStorage: { isEncryptionAvailable: () => false },
  });

  for (const operation of [
    () => store.set('tidal', { token: 'secret' }),
    () => store.get('tidal'),
    () => store.delete('tidal'),
  ]) {
    assert.throws(
      operation,
      error => error.code === 'CREDENTIAL_STORE_UNSUPPORTED_PROVIDER'
        && !serializeError(error).includes('secret'),
    );
  }
});

test('rejects credentials that are not plain objects', () => {
  const store = createCredentialStore({
    filePath: 'credentials.bin',
    safeStorage: { isEncryptionAvailable: () => false },
  });

  for (const credential of [
    null,
    [],
    new Date(),
    new (class Credential {})(),
  ]) {
    assert.throws(
      () => store.set('spotify', credential),
      error => error.code === 'CREDENTIAL_STORE_INVALID_CREDENTIAL'
        && !serializeError(error).includes('secret'),
    );
  }
});

const INVALID_NESTED_CREDENTIALS = [
  ['undefined object field', () => ({
    nested: { secret: 'nested-secret', value: undefined },
  })],
  ['function array entry', () => ({
    nested: ['nested-secret', () => 'value'],
  })],
  ['symbol value', () => ({
    nested: { secret: 'nested-secret', value: Symbol('value') },
  })],
  ['bigint array entry', () => ({
    nested: ['nested-secret', 1n],
  })],
  ['NaN value', () => ({
    nested: { secret: 'nested-secret', value: Number.NaN },
  })],
  ['Infinity array entry', () => ({
    nested: ['nested-secret', Number.POSITIVE_INFINITY],
  })],
  ['Date value', () => ({
    nested: {
      secret: 'nested-secret',
      value: new Date('2026-07-28T00:00:00.000Z'),
    },
  })],
  ['Buffer array entry', () => ({
    nested: ['nested-secret', Buffer.from('buffer-secret')],
  })],
  ['custom prototype', () => {
    const value = Object.create({ inherited: true });
    value.secret = 'nested-secret';
    return { nested: value };
  }],
  ['circular reference', () => {
    const value = { secret: 'nested-secret' };
    value.self = value;
    return { nested: value };
  }],
];

for (const [description, createCredential] of INVALID_NESTED_CREDENTIALS) {
  test(`rejects nested ${description} without persisting it`, () => {
    const disk = createMemoryDisk();
    const store = createEncryptedStore(disk);

    assert.throws(
      () => store.set('spotify', createCredential()),
      error => error.code === 'CREDENTIAL_STORE_INVALID_CREDENTIAL'
        && !serializeError(error).includes('nested-secret')
        && !serializeError(error).includes('buffer-secret'),
    );
    assert.equal(store.get('spotify'), null);
    assert.equal(disk.calls.writes, 0);
    assert.equal(disk.calls.removes, 0);
  });
}

test('wraps decrypt failures in a stable secret-free corruption error', () => {
  const ciphertext = Buffer.from('raw-ciphertext-secret');
  const disk = createMemoryDisk(ciphertext);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: () => {
      throw new Error('must not encrypt');
    },
    decryptString: () => {
      throw new Error('decrypt failed with raw-ciphertext-secret');
    },
  };

  assert.throws(
    () => createEncryptedStore(disk, { safeStorage }),
    error => error.code === 'CREDENTIAL_STORE_CORRUPT'
      && error.message === 'Credential store data is corrupt'
      && !serializeError(error).includes('raw-ciphertext-secret'),
  );
  assert.deepEqual(disk.value(), ciphertext);
  assert.equal(disk.calls.writes, 0);
  assert.equal(disk.calls.removes, 0);
});

test('a corrupt store can be explicitly discarded after construction fails', () => {
  const ciphertext = Buffer.from('corrupt-encrypted-data');
  const disk = createMemoryDisk(ciphertext);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    decryptString: () => {
      throw new Error('corrupt-encrypted-data');
    },
  };

  assert.throws(
    () => createEncryptedStore(disk, { safeStorage }),
    error => error.code === 'CREDENTIAL_STORE_CORRUPT',
  );
  const readsAfterFailure = disk.calls.reads;

  assert.equal(discardCredentialStoreFile({
    filePath: 'credentials.bin',
    removeFile: disk.removeFile,
  }), true);
  assert.equal(disk.exists(), false);
  assert.equal(disk.calls.reads, readsAfterFailure);
  assert.equal(disk.calls.writes, 0);
  assert.equal(disk.calls.removes, 1);
});

test('treats damaged decrypted JSON as corrupt without overwriting it', () => {
  const safeStorage = createSafeStorage();
  const ciphertext = safeStorage.encryptString('{"refreshToken":"json-secret"');
  const disk = createMemoryDisk(ciphertext);

  assert.throws(
    () => createEncryptedStore(disk, { safeStorage }),
    error => error.code === 'CREDENTIAL_STORE_CORRUPT'
      && !serializeError(error).includes('json-secret'),
  );
  assert.deepEqual(disk.value(), ciphertext);
  assert.equal(disk.calls.writes, 0);
  assert.equal(disk.calls.removes, 0);
});

test('treats a mismatched schema as corrupt without exposing credentials', () => {
  const safeStorage = createSafeStorage();
  const ciphertext = encryptEnvelope(safeStorage, {
    schema: 'wrong-schema',
    providers: {
      spotify: {
        credential: { refreshToken: 'schema-secret' },
        accountId: 'tomato',
        updatedAt: TEST_NOW,
      },
    },
  });
  const disk = createMemoryDisk(ciphertext);

  assert.throws(
    () => createEncryptedStore(disk, { safeStorage }),
    error => error.code === 'CREDENTIAL_STORE_CORRUPT'
      && !serializeError(error).includes('schema-secret'),
  );
  assert.deepEqual(disk.value(), ciphertext);
  assert.equal(disk.calls.writes, 0);
  assert.equal(disk.calls.removes, 0);
});

test('deleting one provider persists the others unchanged', () => {
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk);
  store.set('netease', { accountId: 'n-1', cookie: 'netease-secret' });
  store.set('qq', { accountId: 'q-1', cookie: 'qq-secret' });
  const writesBeforeDelete = disk.calls.writes;

  assert.equal(store.delete('netease'), true);

  assert.equal(store.get('netease'), null);
  assert.deepEqual(store.get('qq'), {
    accountId: 'q-1',
    cookie: 'qq-secret',
  });
  assert.equal(disk.calls.writes, writesBeforeDelete + 1);
  assert.equal(disk.calls.removes, 0);
  const reloaded = createEncryptedStore(disk);
  assert.equal(reloaded.get('netease'), null);
  assert.deepEqual(reloaded.get('qq'), {
    accountId: 'q-1',
    cookie: 'qq-secret',
  });
});

test('encrypted delete refreshes disk and preserves providers added by another instance', () => {
  const disk = createMemoryDisk();
  const seed = createEncryptedStore(disk);
  seed.set('netease', { accountId: 'n-1', cookie: 'netease-secret' });
  seed.set('qq', { accountId: 'q-1', cookie: 'qq-secret' });
  const deletingStore = createEncryptedStore(disk);
  const writingStore = createEncryptedStore(disk);
  writingStore.set('spotify', {
    accountId: 's-1',
    refreshToken: 'spotify-secret',
  });

  assert.equal(deletingStore.delete('netease'), true);

  assert.equal(deletingStore.get('netease'), null);
  assert.deepEqual(deletingStore.get('qq'), {
    accountId: 'q-1',
    cookie: 'qq-secret',
  });
  assert.deepEqual(deletingStore.get('spotify'), {
    accountId: 's-1',
    refreshToken: 'spotify-secret',
  });
  const reloaded = createEncryptedStore(disk);
  assert.deepEqual(reloaded.get('spotify'), {
    accountId: 's-1',
    refreshToken: 'spotify-secret',
  });
});

test('encrypted delete can remove a provider added after the instance was created', () => {
  const disk = createMemoryDisk();
  const deletingStore = createEncryptedStore(disk);
  const writingStore = createEncryptedStore(disk);
  writingStore.set('kugou', { accountId: 'k-1', token: 'kugou-secret' });

  assert.equal(deletingStore.delete('kugou'), true);

  assert.equal(disk.exists(), false);
  assert.equal(deletingStore.get('kugou'), null);
});

test('deleting the last provider removes the credential file', () => {
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk);
  store.set('qishui', { accountId: 'qishui-1', token: 'secret' });
  const writesBeforeDelete = disk.calls.writes;

  assert.equal(store.delete('qishui'), true);

  assert.equal(store.get('qishui'), null);
  assert.equal(disk.exists(), false);
  assert.equal(disk.calls.writes, writesBeforeDelete);
  assert.equal(disk.calls.removes, 1);
  assert.equal(store.delete('qishui'), false);
  assert.equal(disk.calls.removes, 1);
});

test('clear removes all providers and the encrypted file', () => {
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk);
  store.set('kugou', { accountId: 'k-1', token: 'k-secret' });
  store.set('spotify', { accountId: 's-1', refreshToken: 's-secret' });

  assert.equal(store.clear(), true);

  assert.equal(store.get('kugou'), null);
  assert.equal(store.get('spotify'), null);
  assert.equal(disk.exists(), false);
  assert.equal(disk.calls.removes, 1);
  assert.equal(store.clear(), false);
  assert.equal(disk.calls.removes, 1);
});

test('encrypted clear refreshes disk before removing credentials written by another instance', () => {
  const disk = createMemoryDisk();
  const clearingStore = createEncryptedStore(disk);
  const writingStore = createEncryptedStore(disk);
  writingStore.set('qq', { accountId: 'q-1', cookie: 'qq-secret' });
  const readsBeforeClear = disk.calls.reads;

  assert.equal(clearingStore.clear(), true);

  assert.equal(disk.calls.reads, readsBeforeClear + 1);
  assert.equal(disk.calls.removes, 1);
  assert.equal(disk.exists(), false);
  assert.equal(clearingStore.get('qq'), null);
});

test('discard helper returns a stable secret-free error for removal failures', () => {
  assert.throws(
    () => discardCredentialStoreFile({
      filePath: 'credentials.bin',
      removeFile: () => {
        throw new Error('remove failed with encrypted-secret');
      },
    }),
    error => error.code === 'CREDENTIAL_STORE_REMOVE_FAILED'
      && error.message === 'Credential store data could not be removed'
      && !serializeError(error).includes('encrypted-secret'),
  );
});

test('snapshot and serialized errors contain only redacted metadata', () => {
  const disk = createMemoryDisk();
  const store = createEncryptedStore(disk);
  store.set('spotify', {
    accountId: 'tomato',
    cookie: 'cookie-value',
    token: 'token-value',
    refreshToken: 'refresh-value',
    oauthCode: 'oauth-value',
    clientSecret: 'client-value',
  });

  const snapshot = store.snapshot();
  assert.deepEqual(snapshot, {
    schema: CREDENTIAL_SCHEMA,
    mode: 'encrypted',
    persistenceAvailable: true,
    providers: [{
      provider: 'spotify',
      accountId: 'tomato',
      updatedAt: TEST_NOW,
      hasCredential: true,
    }],
  });
  const serializedSnapshot = JSON.stringify(snapshot);
  for (const forbidden of [
    'cookie',
    'token',
    'refreshToken',
    'oauthCode',
    'clientSecret',
    'cookie-value',
    'token-value',
    'refresh-value',
    'oauth-value',
    'client-value',
  ]) {
    assert.equal(serializedSnapshot.includes(forbidden), false, forbidden);
  }

  assert.throws(
    () => store.set('spotify', ['credential-secret']),
    error => {
      const serialized = serializeError(error);
      return error.code === 'CREDENTIAL_STORE_INVALID_CREDENTIAL'
        && !serialized.includes('credential-secret');
    },
  );
});

test('default atomic write replaces an existing file with new contents', (t) => {
  const directory = makeTempDirectory(t);
  const target = path.join(directory, 'platform-credentials.bin');
  fs.writeFileSync(target, 'old ciphertext');

  writeFileAtomic(target, Buffer.from('new ciphertext'));

  assert.equal(fs.readFileSync(target, 'utf8'), 'new ciphertext');
  assert.deepEqual(fs.readdirSync(directory), ['platform-credentials.bin']);
});

test('default atomic write fsyncs a same-directory temporary file and preserves the old file on failure', (t) => {
  const directory = makeTempDirectory(t);
  const target = path.join(directory, 'platform-credentials.bin');
  fs.writeFileSync(target, 'old ciphertext');
  let temporaryFile = '';
  let fsyncCount = 0;
  const fileSystem = Object.create(fs);
  fileSystem.openSync = (file, ...args) => {
    temporaryFile = file;
    return fs.openSync(file, ...args);
  };
  fileSystem.fsyncSync = (descriptor) => {
    fsyncCount += 1;
    fs.fsyncSync(descriptor);
  };
  fileSystem.renameSync = () => {
    throw new Error('injected rename failure');
  };

  assert.throws(
    () => writeFileAtomic(target, Buffer.from('new ciphertext'), { fileSystem }),
    /injected rename failure/,
  );

  assert.equal(path.dirname(temporaryFile), directory);
  assert.equal(fsyncCount, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old ciphertext');
  assert.equal(temporaryFile.length > 0, true);
  assert.equal(fs.existsSync(temporaryFile), false);
});
