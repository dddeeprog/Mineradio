'use strict';

const { createHash } = require('node:crypto');

const CACHE_NAMESPACES = Object.freeze([
  'collection',
  'membership',
  'source',
]);
const CACHE_NAMESPACE_SET = new Set(CACHE_NAMESPACES);
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function normalizeAccountId(value) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  throw new TypeError('accountId must be a non-empty string or finite number');
}

function normalizeCredential(value) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Buffer.isBuffer(value) && value.length > 0) return value;
  throw new TypeError('credential must be a non-empty string or Buffer');
}

function createAccountFingerprint(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('account fingerprint input must be an object');
  }

  const provider = requireNonEmptyString(input.provider, 'provider');
  const accountId = normalizeAccountId(input.accountId);
  const credential = normalizeCredential(input.credential);
  const credentialHash = createHash('sha256').update(credential).digest('hex');

  return createHash('sha256')
    .update(provider)
    .update('\0')
    .update(accountId)
    .update('\0')
    .update(credentialHash)
    .digest('hex');
}

function requirePositiveNumber(value, label, integer) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value <= 0
    || (integer && !Number.isInteger(value))
  ) {
    throw new RangeError(`${label} must be a positive${integer ? ' integer' : ''}`);
  }
  return value;
}

function validateNamespace(namespace) {
  if (!CACHE_NAMESPACE_SET.has(namespace)) {
    throw new TypeError(`Unsupported cache namespace: ${String(namespace)}`);
  }
  return namespace;
}

function cloneValue(value) {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function createAccountScopedCache(options) {
  options = options && typeof options === 'object' ? options : {};
  const maxEntries = options.maxEntries === undefined
    ? DEFAULT_MAX_ENTRIES
    : requirePositiveNumber(options.maxEntries, 'maxEntries', true);
  const defaultTtlMs = options.defaultTtlMs === undefined
    ? DEFAULT_TTL_MS
    : requirePositiveNumber(options.defaultTtlMs, 'defaultTtlMs', false);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const entries = new Map();
  let evictions = 0;
  let expirations = 0;

  function timestamp() {
    try {
      const value = now();
      return Number.isFinite(value) ? value : Date.now();
    } catch (_) {
      return Date.now();
    }
  }

  function validateLocation(scope, namespace, key) {
    return {
      scope: requireNonEmptyString(scope, 'scope'),
      namespace: validateNamespace(namespace),
      key: requireNonEmptyString(key, 'key'),
    };
  }

  function cacheKey(location) {
    return JSON.stringify([
      location.scope,
      location.namespace,
      location.key,
    ]);
  }

  function removeExpired(currentTime) {
    for (const [id, entry] of entries) {
      if (currentTime >= entry.expiresAt) {
        entries.delete(id);
        expirations += 1;
      }
    }
  }

  function get(scope, namespace, key) {
    const location = validateLocation(scope, namespace, key);
    const id = cacheKey(location);
    const entry = entries.get(id);
    if (!entry) return undefined;
    if (timestamp() >= entry.expiresAt) {
      entries.delete(id);
      expirations += 1;
      return undefined;
    }

    entries.delete(id);
    entries.set(id, entry);
    return cloneValue(entry.value);
  }

  function set(scope, namespace, key, value, ttlMs) {
    const location = validateLocation(scope, namespace, key);
    const effectiveTtl = ttlMs === undefined
      ? defaultTtlMs
      : requirePositiveNumber(ttlMs, 'ttlMs', false);
    const currentTime = timestamp();
    const expiresAt = currentTime + effectiveTtl;
    if (!Number.isFinite(expiresAt)) {
      throw new RangeError('cache expiry must be finite');
    }

    removeExpired(currentTime);
    const id = cacheKey(location);
    entries.delete(id);
    entries.set(id, {
      ...location,
      value: cloneValue(value),
      expiresAt,
    });

    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
      evictions += 1;
    }
    return cloneValue(value);
  }

  function deleteEntry(scope, namespace, key) {
    const location = validateLocation(scope, namespace, key);
    return entries.delete(cacheKey(location));
  }

  function clearScope(scope) {
    requireNonEmptyString(scope, 'scope');
    let removed = 0;
    for (const [id, entry] of entries) {
      if (entry.scope === scope) {
        entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  function clear() {
    const removed = entries.size;
    entries.clear();
    return removed;
  }

  function snapshot() {
    removeExpired(timestamp());
    const namespaces = Object.fromEntries(
      CACHE_NAMESPACES.map(namespace => [namespace, 0]),
    );
    for (const entry of entries.values()) {
      namespaces[entry.namespace] += 1;
    }
    return {
      entries: entries.size,
      namespaces,
      evictions,
      expirations,
    };
  }

  return {
    get,
    set,
    delete: deleteEntry,
    clearScope,
    clear,
    snapshot,
  };
}

function createAccountCacheBinding(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('account cache binding options must be an object');
  }

  const cache = options.cache;
  if (!cache || typeof cache !== 'object') {
    throw new TypeError('cache must be an account-scoped cache');
  }
  for (const method of ['get', 'set', 'delete', 'clearScope']) {
    if (typeof cache[method] !== 'function') {
      throw new TypeError(`cache.${method} must be a function`);
    }
  }

  const scope = createAccountFingerprint(options);
  return Object.freeze({
    get(namespace, key) {
      return cache.get(scope, namespace, key);
    },
    set(namespace, key, value, ttlMs) {
      return cache.set(scope, namespace, key, value, ttlMs);
    },
    delete(namespace, key) {
      return cache.delete(scope, namespace, key);
    },
    clear() {
      return cache.clearScope(scope);
    },
  });
}

module.exports = {
  CACHE_NAMESPACES,
  createAccountCacheBinding,
  createAccountFingerprint,
  createAccountScopedCache,
};
