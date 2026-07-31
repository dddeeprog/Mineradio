'use strict';

const {
  createCredentialStore: defaultCreateCredentialStore,
} = require('./credential-store');
const {
  createDataMigrationJournal: defaultCreateMigrationJournal,
  createDefaultMigrationManifest,
} = require('./data-migration-journal');
const {
  CREDENTIAL_SESSION_PROVIDERS,
  createCredentialSession: defaultCreateCredentialSession,
  processCredentialSessionHost,
} = require('../server/platform/credential-session');

function credentialFromLegacyValue(provider, value) {
  const text = Buffer.isBuffer(value)
    ? value.toString('utf8').trim()
    : String(value || '').trim();
  if (!text) {
    const error = new Error('Legacy credential is empty');
    error.code = 'PLATFORM_CREDENTIAL_IMPORT_INVALID';
    throw error;
  }
  if (provider !== 'netease' && provider !== 'qq') {
    const error = new Error('Legacy credential provider is unsupported');
    error.code = 'PLATFORM_CREDENTIAL_IMPORT_UNSUPPORTED';
    throw error;
  }
  return { cookie: text };
}

function hydratedCredentials(store) {
  const credentials = Object.create(null);
  for (const provider of CREDENTIAL_SESSION_PROVIDERS) {
    const credential = store.get(provider);
    if (credential) credentials[provider] = credential;
  }
  return credentials;
}

async function createPlatformCredentialRuntime(options = {}) {
  const paths = options.paths;
  const sourceRoots = Array.isArray(options.sourceRoots)
    ? options.sourceRoots.slice()
    : [];
  const createManifest = options.createManifest || createDefaultMigrationManifest;
  const createMigrationJournal = options.createMigrationJournal
    || defaultCreateMigrationJournal;
  const createCredentialStore = options.createCredentialStore
    || defaultCreateCredentialStore;
  const createCredentialSession = options.createCredentialSession
    || defaultCreateCredentialSession;
  const credentialSessionHost = options.credentialSessionHost
    || processCredentialSessionHost;

  const manifest = createManifest(paths);
  const migrationJournal = createMigrationJournal({
    filePath: paths.migrationJournal,
    sourceRoots,
    manifest,
  });
  await migrationJournal.resumeFiles();

  const credentialStoreOptions = {
    ...(options.credentialStoreOptions || {}),
    filePath: paths.credentials,
    safeStorage: options.safeStorage,
  };
  let credentialStorageRecovery = '';
  let credentialStore;
  try {
    credentialStore = createCredentialStore(credentialStoreOptions);
  } catch (error) {
    const code = error && error.code;
    if (code !== 'CREDENTIAL_STORE_CORRUPT'
      && code !== 'CREDENTIAL_STORE_READ_FAILED') {
      throw error;
    }
    credentialStorageRecovery = code;
    credentialStore = createCredentialStore({
      ...credentialStoreOptions,
      safeStorage: null,
    });
  }
  const storeStatus = credentialStore.snapshot();
  const session = createCredentialSession({
    mode: storeStatus.mode,
    persistCredential(provider, credential, metadata) {
      const storeOptions = metadata.migrationId
        ? { migrationId: metadata.migrationId }
        : undefined;
      return credentialStore.set(provider, credential, storeOptions);
    },
    clearCredential(provider) {
      credentialStore.delete(provider);
      return {
        persisted: credentialStore.snapshot().persistenceAvailable === true,
        mode: credentialStore.snapshot().mode,
      };
    },
  });
  session.hydrate(hydratedCredentials(credentialStore));

  await migrationJournal.resumeCredentialImports({
    verifyCredentialImport(provider, migrationId) {
      return credentialStore.hasMigration(provider, migrationId);
    },
    async importCredential(provider, value, metadata) {
      const result = await session.replace(
        provider,
        credentialFromLegacyValue(provider, value),
        { migrationId: metadata.migrationId },
      );
      const verified = result.persisted === true
        && credentialStore.hasMigration(provider, metadata.migrationId);
      return {
        persisted: result.persisted,
        verified,
      };
    },
  });

  credentialSessionHost.attach(session);
  return Object.freeze({
    session,
    status() {
      return {
        credential: session.diagnostics(),
        credentialStorage: {
          degraded: credentialStorageRecovery !== '',
          reason: credentialStorageRecovery,
        },
        migration: migrationJournal.status(),
      };
    },
  });
}

module.exports = {
  createPlatformCredentialRuntime,
};
