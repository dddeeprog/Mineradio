'use strict';

const { createAccountFingerprint } = require('./account-cache');

const EMPTY_MEMBERSHIP = Object.freeze({
  vipLevel: 'none',
  isVip: false,
  isSvip: false,
  known: false,
});

function clone(value) {
  return structuredClone(value);
}

function publicMembership(value) {
  const membership = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const hasKnownFields = [
    'vipLevel',
    'isVip',
    'isSvip',
    'known',
  ].some(key => Object.prototype.hasOwnProperty.call(membership, key));
  const isSvip = membership.isSvip === true;
  const isVip = isSvip || membership.isVip === true;

  return {
    vipLevel: typeof membership.vipLevel === 'string' && membership.vipLevel
      ? membership.vipLevel
      : (isSvip ? 'svip' : (isVip ? 'vip' : 'none')),
    isVip,
    isSvip,
    known: Object.prototype.hasOwnProperty.call(membership, 'known')
      ? membership.known === true
      : hasKnownFields,
  };
}

function publicAccount(account, loggedIn) {
  account = account && typeof account === 'object' && !Array.isArray(account)
    ? account
    : {};
  return {
    loggedIn,
    accountId: loggedIn ? String(account.accountId) : '',
    nickname: loggedIn && typeof account.nickname === 'string'
      ? account.nickname
      : '',
    avatar: loggedIn && typeof account.avatar === 'string'
      ? account.avatar
      : '',
    membership: loggedIn
      ? publicMembership(account.membership)
      : { ...EMPTY_MEMBERSHIP },
  };
}

function requireProvider(provider) {
  if (typeof provider !== 'string' || provider.length === 0) {
    throw new TypeError('provider must be a non-empty string');
  }
  return provider;
}

function transitionError(provider) {
  const error = new Error('Account transition failed');
  error.code = 'ACCOUNT_TRANSITION_FAILED';
  error.provider = provider;
  return error;
}

function optionalHook(value, label) {
  if (value === undefined) return async () => {};
  if (typeof value !== 'function') {
    throw new TypeError(`${label} must be a function`);
  }
  return value;
}

function createAccountContext(options) {
  options = options && typeof options === 'object' ? options : {};
  const clearScope = optionalHook(options.clearScope, 'clearScope');
  const clearInflight = optionalHook(options.clearInflight, 'clearInflight');
  const clearSession = optionalHook(options.clearSession, 'clearSession');
  const publish = optionalHook(options.publish, 'publish');
  const states = new Map();
  const queues = new Map();

  function loggedOutState() {
    return {
      status: 'loggedOut',
      scope: null,
      account: publicAccount({}, false),
    };
  }

  function currentState(provider) {
    return states.get(provider) || loggedOutState();
  }

  function enqueue(provider, operation) {
    const previous = queues.get(provider) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(operation);
    queues.set(provider, next);
    const cleanup = () => {
      if (queues.get(provider) === next) queues.delete(provider);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  async function cleanPrevious(provider, previous) {
    if (!previous.scope) return;
    await clearScope(previous.scope);
    await clearInflight(provider);
    await clearSession(provider);
  }

  function switchAccount(provider, account) {
    provider = requireProvider(provider);
    account = account && typeof account === 'object' && !Array.isArray(account)
      ? account
      : {};
    const scope = createAccountFingerprint({
      provider,
      accountId: account.accountId,
      credential: account.credential,
    });
    const nextAccount = publicAccount(account, true);

    return enqueue(provider, async () => {
      const previous = currentState(provider);
      states.set(provider, {
        ...previous,
        status: 'switching',
      });
      try {
        await cleanPrevious(provider, previous);
        await publish(provider, clone(nextAccount));
      } catch (_) {
        throw transitionError(provider);
      }
      states.set(provider, {
        status: 'active',
        scope,
        account: clone(nextAccount),
      });
      return clone(nextAccount);
    });
  }

  function logout(provider) {
    provider = requireProvider(provider);
    const nextAccount = publicAccount({}, false);

    return enqueue(provider, async () => {
      const previous = currentState(provider);
      states.set(provider, {
        ...previous,
        status: 'switching',
      });
      try {
        if (previous.scope) await clearScope(previous.scope);
        await clearInflight(provider);
        await clearSession(provider);
        await publish(provider, clone(nextAccount));
      } catch (_) {
        throw transitionError(provider);
      }
      states.set(provider, {
        status: 'loggedOut',
        scope: null,
        account: clone(nextAccount),
      });
      return clone(nextAccount);
    });
  }

  function getState(provider) {
    provider = requireProvider(provider);
    const state = currentState(provider);
    return {
      status: state.status,
      account: clone(state.account),
    };
  }

  return {
    switchAccount,
    logout,
    getState,
  };
}

module.exports = {
  createAccountContext,
};
