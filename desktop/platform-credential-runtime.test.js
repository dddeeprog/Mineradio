'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CREDENTIAL_SESSION_PROVIDERS,
  createCredentialSession,
  createCredentialSessionHost,
} = require('../server/platform/credential-session');
const {
  createPlatformCredentialRuntime,
} = require('./platform-credential-runtime');

function stablePaths() {
  return {
    userData: 'C:\\Mineradio',
    credentials: 'C:\\Mineradio\\credentials\\platform-credentials.bin',
    platformCache: 'C:\\Mineradio\\platform-cache\\platform-cache.json',
    listenJournal: 'C:\\Mineradio\\journal\\listen-sync-journal.json',
    migrationJournal: 'C:\\Mineradio\\journal\\data-migration-v1.json',
  };
}

test('restores files, hydrates credentials, verifies imports, then attaches one ready session', async () => {
  const order = [];
  const migrationId = 'a'.repeat(64);
  const persistedMigrations = new Set();
  const records = new Map([
    ['spotify', { accountId: 'spotify-user', refreshToken: 'spotify-secret' }],
  ]);
  const host = createCredentialSessionHost();
  const journal = {
    async resumeFiles() {
      order.push('resume-files');
    },
    async resumeCredentialImports(sink) {
      order.push('resume-imports');
      assert.equal(await sink.verifyCredentialImport('netease', migrationId), false);
      const result = await sink.importCredential(
        'netease',
        Buffer.from('  MUSIC_U=legacy-secret  '),
        { migrationId },
      );
      assert.deepEqual(result, { persisted: true, verified: true });
    },
    status() {
      return { schema: 'migration', pending: 0 };
    },
  };
  const store = {
    get(provider) {
      order.push(`get:${provider}`);
      return records.has(provider) ? structuredClone(records.get(provider)) : null;
    },
    set(provider, credential, metadata) {
      order.push(`set:${provider}:${metadata.migrationId}`);
      records.set(provider, structuredClone(credential));
      persistedMigrations.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, mode: 'encrypted' };
    },
    delete() {
      return false;
    },
    hasMigration(provider, id) {
      order.push(`verify:${provider}:${id}`);
      return persistedMigrations.has(`${provider}:${id}`);
    },
    snapshot() {
      return { mode: 'encrypted', persistenceAvailable: true, providers: [] };
    },
  };

  const runtime = await createPlatformCredentialRuntime({
    paths: stablePaths(),
    sourceRoots: ['C:\\legacy'],
    safeStorage: {},
    credentialSessionHost: host,
    createManifest() {
      order.push('manifest');
      return Object.freeze([]);
    },
    createMigrationJournal() {
      order.push('journal');
      return journal;
    },
    createCredentialStore() {
      order.push('store');
      return store;
    },
    createCredentialSession(options) {
      order.push(`session:${options.mode}`);
      return createCredentialSession(options);
    },
  });

  assert.deepEqual(order, [
    'manifest',
    'journal',
    'resume-files',
    'store',
    'session:encrypted',
    ...CREDENTIAL_SESSION_PROVIDERS.map(provider => `get:${provider}`),
    'resume-imports',
    `verify:netease:${migrationId}`,
    `set:netease:${migrationId}`,
    `verify:netease:${migrationId}`,
    'attach',
  ].filter(item => item !== 'attach'));
  assert.equal(host.get(), runtime.session);
  assert.equal(runtime.session.read('spotify').refreshToken, 'spotify-secret');
  assert.equal(runtime.session.read('netease').cookie, 'MUSIC_U=legacy-secret');
  assert.equal(JSON.stringify(runtime.status()).includes('legacy-secret'), false);
  assert.equal(JSON.stringify(runtime.status()).includes('spotify-secret'), false);
});

test('publishes memory-only downgrade without touching credential storage files', async () => {
  const diskAccess = [];
  const host = createCredentialSessionHost();
  const runtime = await createPlatformCredentialRuntime({
    paths: stablePaths(),
    sourceRoots: [],
    safeStorage: { isEncryptionAvailable: () => false },
    credentialSessionHost: host,
    createManifest: () => Object.freeze([]),
    createMigrationJournal: () => ({
      async resumeFiles() {},
      async resumeCredentialImports() {},
      status: () => ({ schema: 'migration', pending: 0 }),
    }),
    credentialStoreOptions: {
      readFile: () => diskAccess.push('read'),
      writeFileAtomic: () => diskAccess.push('write'),
      removeFile: () => diskAccess.push('remove'),
    },
  });

  assert.equal(runtime.status().credential.mode, 'memory-only');
  assert.equal(runtime.status().credential.state, 'ready');
  assert.deepEqual(diskAccess, []);
});

test('package check validates the platform credential runtime module', () => {
  const packageJson = require('../package.json');
  assert.match(
    packageJson.scripts.check,
    /node --check desktop\/platform-credential-runtime\.js/,
  );
});
