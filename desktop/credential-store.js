'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CREDENTIAL_SCHEMA = 'mineradio-provider-credentials-v1';
const SUPPORTED_CREDENTIAL_PROVIDERS = Object.freeze([
  'netease',
  'qq',
  'kugou',
  'qishui',
  'spotify',
]);
const SUPPORTED_PROVIDER_SET = new Set(SUPPORTED_CREDENTIAL_PROVIDERS);

function createCredentialStoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createCorruptError() {
  return createCredentialStoreError(
    'CREDENTIAL_STORE_CORRUPT',
    'Credential store data is corrupt',
  );
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object') return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (_error) {
    return false;
  }
}

function cloneCredential(value) {
  try {
    const clone = JSON.parse(JSON.stringify(value));
    if (!isPlainObject(clone)) throw new Error('invalid credential clone');
    return clone;
  } catch (_error) {
    throw createCredentialStoreError(
      'CREDENTIAL_STORE_INVALID_CREDENTIAL',
      'Credential must be a JSON-serializable plain object',
    );
  }
}

function assertSupportedProvider(provider) {
  if (!SUPPORTED_PROVIDER_SET.has(provider)) {
    throw createCredentialStoreError(
      'CREDENTIAL_STORE_UNSUPPORTED_PROVIDER',
      'Unsupported credential provider',
    );
  }
}

function assertPlainCredential(credential) {
  if (!isPlainObject(credential)) {
    throw createCredentialStoreError(
      'CREDENTIAL_STORE_INVALID_CREDENTIAL',
      'Credential must be a JSON-serializable plain object',
    );
  }
}

function createAtomicTemporaryPath(filePath) {
  const resolvedFile = path.resolve(filePath);
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  return path.join(
    path.dirname(resolvedFile),
    `.${path.basename(resolvedFile)}.${suffix}.tmp`,
  );
}

function writeFileAtomic(filePath, value, options = {}) {
  if (!Buffer.isBuffer(value)) {
    throw new TypeError('Atomic credential writes require a Buffer');
  }

  const fileSystem = options.fileSystem || fs;
  const resolvedFile = path.resolve(filePath);
  const temporaryFile = createAtomicTemporaryPath(resolvedFile);
  let descriptor = null;

  try {
    descriptor = fileSystem.openSync(temporaryFile, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, value);
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    fileSystem.renameSync(temporaryFile, resolvedFile);
  } catch (error) {
    if (descriptor != null) {
      try {
        fileSystem.closeSync(descriptor);
      } catch (_closeError) {
        // Preserve the original write error.
      }
    }
    try {
      fileSystem.unlinkSync(temporaryFile);
    } catch (_cleanupError) {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function readFile(filePath) {
  return fs.readFileSync(filePath);
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
}

function encryptionIsAvailable(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    return false;
  }
  try {
    return safeStorage.isEncryptionAvailable() === true;
  } catch (_error) {
    return false;
  }
}

function emptyProviders() {
  return Object.create(null);
}

function isValidAccountId(accountId) {
  return accountId == null
    || typeof accountId === 'string'
    || typeof accountId === 'number';
}

function isValidUpdatedAt(updatedAt) {
  return typeof updatedAt === 'string' || typeof updatedAt === 'number';
}

function validateEnvelope(envelope) {
  if (!isPlainObject(envelope)
    || envelope.schema !== CREDENTIAL_SCHEMA
    || !isPlainObject(envelope.providers)) {
    throw createCorruptError();
  }

  const envelopeKeys = Object.keys(envelope);
  if (envelopeKeys.length !== 2
    || !envelopeKeys.includes('schema')
    || !envelopeKeys.includes('providers')) {
    throw createCorruptError();
  }

  const providers = emptyProviders();
  for (const [provider, record] of Object.entries(envelope.providers)) {
    if (!SUPPORTED_PROVIDER_SET.has(provider)
      || !isPlainObject(record)
      || !isPlainObject(record.credential)
      || !isValidAccountId(record.accountId)
      || !isValidUpdatedAt(record.updatedAt)) {
      throw createCorruptError();
    }

    const recordKeys = Object.keys(record);
    if (recordKeys.length !== 3
      || !recordKeys.includes('credential')
      || !recordKeys.includes('accountId')
      || !recordKeys.includes('updatedAt')) {
      throw createCorruptError();
    }

    providers[provider] = {
      credential: cloneCredential(record.credential),
      accountId: record.accountId,
      updatedAt: record.updatedAt,
    };
  }
  return providers;
}

function readEncryptedProviders(filePath, safeStorage, read) {
  let encrypted;
  try {
    encrypted = read(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyProviders();
    throw createCredentialStoreError(
      'CREDENTIAL_STORE_READ_FAILED',
      'Credential store could not be read',
    );
  }

  if (encrypted == null || (Buffer.isBuffer(encrypted) && encrypted.length === 0)) {
    return emptyProviders();
  }
  if (!Buffer.isBuffer(encrypted)) throw createCorruptError();

  try {
    const decrypted = safeStorage.decryptString(Buffer.from(encrypted));
    if (typeof decrypted !== 'string') throw new Error('invalid decrypted value');
    return validateEnvelope(JSON.parse(decrypted));
  } catch (_error) {
    throw createCorruptError();
  }
}

function accountIdFromCredential(credential) {
  const { accountId } = credential;
  return isValidAccountId(accountId) ? (accountId ?? null) : null;
}

function copyProviders(providers) {
  const copy = emptyProviders();
  for (const [provider, record] of Object.entries(providers)) {
    copy[provider] = record;
  }
  return copy;
}

function createCredentialStore(options = {}) {
  const filePath = options.filePath;
  const safeStorage = options.safeStorage;
  const read = options.readFile || readFile;
  const atomicWrite = options.writeFileAtomic || writeFileAtomic;
  const remove = options.removeFile || removeFile;
  const now = options.now || (() => new Date().toISOString());
  const persistenceAvailable = encryptionIsAvailable(safeStorage);
  const mode = persistenceAvailable ? 'encrypted' : 'memory-only';
  let providers = persistenceAvailable
    ? readEncryptedProviders(filePath, safeStorage, read)
    : emptyProviders();

  function persist(nextProviders) {
    let encrypted;
    try {
      encrypted = safeStorage.encryptString(JSON.stringify({
        schema: CREDENTIAL_SCHEMA,
        providers: nextProviders,
      }));
    } catch (_error) {
      throw createCredentialStoreError(
        'CREDENTIAL_STORE_ENCRYPT_FAILED',
        'Credential store data could not be encrypted',
      );
    }

    if (!Buffer.isBuffer(encrypted)) {
      throw createCredentialStoreError(
        'CREDENTIAL_STORE_ENCRYPT_FAILED',
        'Credential store data could not be encrypted',
      );
    }

    try {
      atomicWrite(filePath, encrypted);
    } catch (_error) {
      throw createCredentialStoreError(
        'CREDENTIAL_STORE_WRITE_FAILED',
        'Credential store data could not be persisted',
      );
    }
  }

  function removePersistedFile() {
    try {
      remove(filePath);
    } catch (_error) {
      throw createCredentialStoreError(
        'CREDENTIAL_STORE_REMOVE_FAILED',
        'Credential store data could not be removed',
      );
    }
  }

  return {
    get(provider) {
      assertSupportedProvider(provider);
      const record = providers[provider];
      return record ? cloneCredential(record.credential) : null;
    },

    set(provider, credential) {
      assertSupportedProvider(provider);
      assertPlainCredential(credential);
      const credentialCopy = cloneCredential(credential);
      let updatedAt;
      try {
        updatedAt = now();
      } catch (_error) {
        throw createCredentialStoreError(
          'CREDENTIAL_STORE_TIME_FAILED',
          'Credential update time could not be created',
        );
      }
      if (!isValidUpdatedAt(updatedAt)) {
        throw createCredentialStoreError(
          'CREDENTIAL_STORE_TIME_FAILED',
          'Credential update time could not be created',
        );
      }

      const nextProviders = copyProviders(providers);
      nextProviders[provider] = {
        credential: credentialCopy,
        accountId: accountIdFromCredential(credentialCopy),
        updatedAt,
      };
      if (persistenceAvailable) persist(nextProviders);
      providers = nextProviders;

      return {
        persisted: persistenceAvailable,
        mode,
      };
    },

    delete(provider) {
      assertSupportedProvider(provider);
      if (!providers[provider]) return false;

      const nextProviders = copyProviders(providers);
      delete nextProviders[provider];
      if (persistenceAvailable) {
        if (Object.keys(nextProviders).length === 0) {
          removePersistedFile();
        } else {
          persist(nextProviders);
        }
      }
      providers = nextProviders;
      return true;
    },

    clear() {
      if (Object.keys(providers).length === 0) return false;
      if (persistenceAvailable) removePersistedFile();
      providers = emptyProviders();
      return true;
    },

    snapshot() {
      return {
        schema: CREDENTIAL_SCHEMA,
        mode,
        persistenceAvailable,
        providers: SUPPORTED_CREDENTIAL_PROVIDERS
          .filter(provider => providers[provider])
          .map(provider => ({
            provider,
            accountId: providers[provider].accountId,
            updatedAt: providers[provider].updatedAt,
            hasCredential: true,
          })),
      };
    },
  };
}

module.exports = {
  CREDENTIAL_SCHEMA,
  SUPPORTED_CREDENTIAL_PROVIDERS,
  createCredentialStore,
  isPlainObject,
  writeFileAtomic,
};
