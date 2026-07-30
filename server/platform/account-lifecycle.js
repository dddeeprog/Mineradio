'use strict';

const { createHash } = require('node:crypto');

function lifecycleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireProvider(provider) {
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new TypeError('provider must be a non-empty string');
  }
  return provider;
}

function accountIdFrom(account, provider, credentialMaterial) {
  const value = account.accountId ?? account.userId;
  if ((typeof value === 'string' && value.length > 0)
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'bigint') {
    return String(value);
  }
  return `pending-${createHash('sha256')
    .update(provider)
    .update('\0')
    .update(credentialMaterial)
    .digest('hex')
    .slice(0, 24)}`;
}

function credentialMaterial(credential) {
  for (const key of [
    'cookie',
    'token',
    'accessToken',
    'refreshToken',
  ]) {
    if (typeof credential[key] === 'string' && credential[key].length > 0) {
      return credential[key];
    }
  }
  return JSON.stringify(credential);
}

function membershipFrom(account) {
  if (account.membership
    && typeof account.membership === 'object'
    && !Array.isArray(account.membership)) {
    return account.membership;
  }
  const membership = {};
  for (const key of ['vipLevel', 'isVip', 'isSvip']) {
    if (Object.prototype.hasOwnProperty.call(account, key)) {
      membership[key] = account[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(account, 'membershipKnown')) {
    membership.known = account.membershipKnown;
  }
  return membership;
}

function createAccountLifecycle(options = {}) {
  const credentialSession = options.credentialSession;
  const accountContext = options.accountContext;
  if (!credentialSession
    || typeof credentialSession.read !== 'function'
    || typeof credentialSession.replace !== 'function'
    || typeof credentialSession.clear !== 'function') {
    throw new TypeError('credentialSession is required');
  }
  if (!accountContext
    || typeof accountContext.switchAccount !== 'function'
    || typeof accountContext.logout !== 'function') {
    throw new TypeError('accountContext is required');
  }

  const queues = new Map();

  function enqueue(provider, operation) {
    const previous = queues.get(provider) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(provider, next);
    const cleanup = () => {
      if (queues.get(provider) === next) queues.delete(provider);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  async function restoreCredential(provider, previousCredential) {
    if (previousCredential) {
      await credentialSession.replace(provider, previousCredential);
    } else {
      await credentialSession.clear(provider);
    }
  }

  function login(provider, credential, resolveAccount) {
    provider = requireProvider(provider);
    if (typeof resolveAccount !== 'function') {
      throw new TypeError('resolveAccount must be a function');
    }

    return enqueue(provider, async () => {
      const previousCredential = credentialSession.read(provider);
      try {
        await credentialSession.replace(provider, credential);
        const account = await resolveAccount();
        if (!account || typeof account !== 'object' || account.loggedIn !== true) {
          throw lifecycleError(
            'ACCOUNT_LIFECYCLE_AUTH_REJECTED',
            'Platform credential was rejected',
          );
        }
        const material = credentialMaterial(credential);
        return await accountContext.switchAccount(provider, {
          accountId: accountIdFrom(account, provider, material),
          credential: material,
          nickname: account.nickname,
          avatar: account.avatar,
          membership: membershipFrom(account),
        });
      } catch (_error) {
        try {
          await restoreCredential(provider, previousCredential);
        } catch (_rollbackError) {
          // The public failure remains value-free even if persistence rollback fails.
        }
        throw lifecycleError(
          'ACCOUNT_LIFECYCLE_LOGIN_FAILED',
          'Platform account login failed',
        );
      }
    });
  }

  function logout(provider) {
    provider = requireProvider(provider);
    return enqueue(provider, async () => {
      const previousCredential = credentialSession.read(provider);
      try {
        return await accountContext.logout(provider);
      } catch (_error) {
        try {
          if (previousCredential && credentialSession.read(provider) === null) {
            await credentialSession.replace(provider, previousCredential);
          }
        } catch (_rollbackError) {
          // Preserve the value-free lifecycle failure.
        }
        throw lifecycleError(
          'ACCOUNT_LIFECYCLE_LOGOUT_FAILED',
          'Platform account logout failed',
        );
      }
    });
  }

  return Object.freeze({
    login,
    logout,
  });
}

module.exports = {
  createAccountLifecycle,
};
