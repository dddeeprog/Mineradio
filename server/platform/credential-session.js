'use strict';

const CREDENTIAL_SESSION_SCHEMA = 'mineradio-credential-session-v1';
const CREDENTIAL_SESSION_PROVIDERS = Object.freeze([
  'netease',
  'qq',
  'kugou',
  'qishui',
  'spotify',
]);
const PROVIDER_SET = new Set(CREDENTIAL_SESSION_PROVIDERS);
const SESSION_MODES = new Set([
  'encrypted',
  'memory-only',
  'restricted-file',
]);
const MAX_CREDENTIAL_DEPTH = 32;
const MAX_CREDENTIAL_NODES = 4096;
const MAX_CREDENTIAL_STRING_LENGTH = 1024 * 1024;
const MIGRATION_ID_PATTERN = /^[a-f0-9]{64}$/;

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireProvider(provider) {
  if (!PROVIDER_SET.has(provider)) {
    throw sessionError(
      'CREDENTIAL_SESSION_PROVIDER_UNSUPPORTED',
      'Credential provider is unsupported',
    );
  }
  return provider;
}

function requireMode(mode) {
  if (!SESSION_MODES.has(mode)) {
    throw new TypeError('Credential session mode is invalid');
  }
  return mode;
}

function invalidCredentialError() {
  return sessionError(
    'CREDENTIAL_SESSION_INVALID_CREDENTIAL',
    'Credential must be a bounded JSON-safe plain object',
  );
}

function readMigrationId(options) {
  if (options === undefined) return null;
  const prototype = options && typeof options === 'object'
    ? Object.getPrototypeOf(options)
    : null;
  const descriptor = options && typeof options === 'object'
    ? Object.getOwnPropertyDescriptor(options, 'migrationId')
    : null;
  if (!options
    || Array.isArray(options)
    || (prototype !== Object.prototype && prototype !== null)
    || Reflect.ownKeys(options).length !== 1
    || !descriptor
    || !Object.hasOwn(descriptor, 'value')
    || !MIGRATION_ID_PATTERN.test(descriptor.value)) {
    throw sessionError(
      'CREDENTIAL_SESSION_INVALID_MIGRATION_ID',
      'Credential migration marker is invalid',
    );
  }
  return descriptor.value;
}

function cloneCredential(value) {
  const active = new WeakSet();
  let nodes = 0;

  function clone(input, depth) {
    nodes += 1;
    if (nodes > MAX_CREDENTIAL_NODES || depth > MAX_CREDENTIAL_DEPTH) {
      throw invalidCredentialError();
    }
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') {
      if (input.length > MAX_CREDENTIAL_STRING_LENGTH) {
        throw invalidCredentialError();
      }
      return input;
    }
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw invalidCredentialError();
      return input;
    }
    if (typeof input !== 'object' || active.has(input)) {
      throw invalidCredentialError();
    }

    active.add(input);
    try {
      if (Array.isArray(input)) {
        const keys = Reflect.ownKeys(input);
        if (keys.length !== input.length + 1 || !keys.includes('length')) {
          throw invalidCredentialError();
        }
        return input.map(item => clone(item, depth + 1));
      }

      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        throw invalidCredentialError();
      }
      const output = Object.create(null);
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string') throw invalidCredentialError();
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor
          || !Object.hasOwn(descriptor, 'value')
          || descriptor.enumerable !== true) {
          throw invalidCredentialError();
        }
        output[key] = clone(descriptor.value, depth + 1);
      }
      return output;
    } finally {
      active.delete(input);
    }
  }

  const result = clone(value, 0);
  if (!result || Array.isArray(result) || typeof result !== 'object') {
    throw invalidCredentialError();
  }
  return result;
}

function publicAccountId(credential) {
  const accountId = credential.accountId;
  if (typeof accountId === 'string' && accountId.length > 0) return accountId;
  if (Number.isSafeInteger(accountId)) return accountId;
  return null;
}

function createCredentialSession(options = {}) {
  const mode = requireMode(options.mode || 'memory-only');
  const persistCredential = options.persistCredential === undefined
    ? async () => ({ persisted: false, mode })
    : options.persistCredential;
  const clearCredential = options.clearCredential === undefined
    ? async () => ({ persisted: false, mode })
    : options.clearCredential;
  if (typeof persistCredential !== 'function') {
    throw new TypeError('persistCredential must be a function');
  }
  if (typeof clearCredential !== 'function') {
    throw new TypeError('clearCredential must be a function');
  }

  const records = new Map();
  const listeners = new Set();
  let state = 'cold';
  let revision = 0;
  let queue = Promise.resolve();

  function requireReady() {
    if (state !== 'ready') {
      throw sessionError(
        'CREDENTIAL_SESSION_NOT_HYDRATED',
        'Credential session has not been hydrated',
      );
    }
  }

  function enqueue(operation) {
    const next = queue.catch(() => {}).then(operation);
    queue = next;
    return next;
  }

  function publish(event) {
    const frozenEvent = Object.freeze({ ...event });
    for (const listener of listeners) {
      try {
        listener(frozenEvent);
      } catch (_error) {
        // Subscribers observe committed state and cannot roll it back.
      }
    }
  }

  function hydrate(credentials = {}) {
    if (state !== 'cold') {
      throw sessionError(
        'CREDENTIAL_SESSION_ALREADY_HYDRATED',
        'Credential session is already hydrated',
      );
    }
    const prototype = credentials && typeof credentials === 'object'
      ? Object.getPrototypeOf(credentials)
      : null;
    if (!credentials
      || Array.isArray(credentials)
      || (prototype !== Object.prototype && prototype !== null)) {
      throw invalidCredentialError();
    }

    const hydrated = new Map();
    for (const provider of Reflect.ownKeys(credentials)) {
      if (typeof provider !== 'string') throw invalidCredentialError();
      requireProvider(provider);
      const credential = cloneCredential(credentials[provider]);
      hydrated.set(provider, {
        credential,
        accountId: publicAccountId(credential),
        revision: 1,
      });
    }

    revision = 1;
    for (const [provider, record] of hydrated) records.set(provider, record);
    state = 'ready';
    return diagnostics();
  }

  function read(provider) {
    requireProvider(provider);
    requireReady();
    const record = records.get(provider);
    return record ? cloneCredential(record.credential) : null;
  }

  async function replace(provider, credential, options) {
    requireProvider(provider);
    requireReady();
    const migrationId = readMigrationId(options);
    const credentialCopy = cloneCredential(credential);

    return enqueue(async () => {
      const nextRevision = revision + 1;
      const persistenceMetadata = { revision: nextRevision };
      if (migrationId) persistenceMetadata.migrationId = migrationId;
      let persistence;
      try {
        persistence = await persistCredential(
          provider,
          cloneCredential(credentialCopy),
          Object.freeze(persistenceMetadata),
        );
      } catch (_error) {
        throw sessionError(
          'CREDENTIAL_SESSION_PERSIST_FAILED',
          'Credential could not be persisted',
        );
      }
      const persisted = persistence && persistence.persisted === true;
      const resultMode = persistence && SESSION_MODES.has(persistence.mode)
        ? persistence.mode
        : mode;
      const accountId = publicAccountId(credentialCopy);
      records.set(provider, {
        credential: credentialCopy,
        accountId,
        revision: nextRevision,
      });
      revision = nextRevision;
      publish({
        type: 'replaced',
        provider,
        hasCredential: true,
        accountId,
        revision,
      });
      return {
        provider,
        persisted,
        mode: resultMode,
        revision,
      };
    });
  }

  async function clear(provider) {
    requireProvider(provider);
    requireReady();

    return enqueue(async () => {
      const current = records.get(provider);
      if (!current) {
        return {
          provider,
          persisted: mode === 'encrypted',
          mode,
          revision,
          cleared: false,
        };
      }
      const nextRevision = revision + 1;
      let persistence;
      try {
        persistence = await clearCredential(
          provider,
          Object.freeze({ revision: nextRevision }),
        );
      } catch (_error) {
        throw sessionError(
          'CREDENTIAL_SESSION_CLEAR_FAILED',
          'Credential could not be cleared',
        );
      }
      const persisted = persistence && persistence.persisted === true;
      const resultMode = persistence && SESSION_MODES.has(persistence.mode)
        ? persistence.mode
        : mode;
      records.delete(provider);
      revision = nextRevision;
      publish({
        type: 'cleared',
        provider,
        hasCredential: false,
        accountId: null,
        revision,
      });
      return {
        provider,
        persisted,
        mode: resultMode,
        revision,
        cleared: true,
      };
    });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Credential session listener must be a function');
    }
    listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener);
    };
  }

  function diagnostics() {
    return {
      schema: CREDENTIAL_SESSION_SCHEMA,
      state,
      mode,
      revision,
      providers: CREDENTIAL_SESSION_PROVIDERS
        .filter(provider => records.has(provider))
        .map(provider => {
          const record = records.get(provider);
          return {
            provider,
            hasCredential: true,
            accountId: record.accountId,
            revision: record.revision,
          };
        }),
    };
  }

  return Object.freeze({
    hydrate,
    replace,
    clear,
    read,
    subscribe,
    diagnostics,
  });
}

function createCredentialSessionHost() {
  let attached = null;

  return Object.freeze({
    attach(session) {
      let ready = false;
      try {
        ready = session
          && typeof session.read === 'function'
          && typeof session.replace === 'function'
          && typeof session.clear === 'function'
          && typeof session.diagnostics === 'function'
          && session.diagnostics().state === 'ready';
      } catch (_error) {
        ready = false;
      }
      if (!ready) {
        throw sessionError(
          'CREDENTIAL_SESSION_HOST_NOT_READY',
          'Credential session must be hydrated before attachment',
        );
      }
      if (attached && attached !== session) {
        throw sessionError(
          'CREDENTIAL_SESSION_HOST_ALREADY_ATTACHED',
          'Credential session host already has a session',
        );
      }
      attached = session;
      return attached;
    },

    get() {
      return attached;
    },
  });
}

const processCredentialSessionHost = createCredentialSessionHost();

module.exports = {
  CREDENTIAL_SESSION_PROVIDERS,
  CREDENTIAL_SESSION_SCHEMA,
  createCredentialSession,
  createCredentialSessionHost,
  processCredentialSessionHost,
};
