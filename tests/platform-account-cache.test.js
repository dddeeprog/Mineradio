'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const {
  createAccountCacheBinding,
  createAccountFingerprint,
  createAccountScopedCache,
} = require('../server/platform/account-cache');
const {
  createAccountContext,
} = require('../server/platform/account-context');

function expectedFingerprint(provider, accountId, credential) {
  const credentialHash = createHash('sha256').update(credential).digest('hex');
  return createHash('sha256')
    .update(`${provider}\0${accountId}\0${credentialHash}`)
    .digest('hex');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('fingerprints are stable, account-specific and never expose credentials', () => {
  const input = {
    provider: 'netease',
    accountId: '1001',
    credential: 'MUSIC_U=secret-a',
  };
  const fingerprint = createAccountFingerprint(input);

  assert.equal(
    fingerprint,
    expectedFingerprint(input.provider, input.accountId, input.credential),
  );
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(createAccountFingerprint(input), fingerprint);
  assert.notEqual(createAccountFingerprint({
    ...input,
    accountId: '1002',
  }), fingerprint);
  assert.notEqual(createAccountFingerprint({
    ...input,
    credential: 'MUSIC_U=secret-b',
  }), fingerprint);
  assert.notEqual(createAccountFingerprint({
    ...input,
    provider: 'qq',
  }), fingerprint);
  assert.equal(fingerprint.includes('secret-a'), false);
  assert.equal(fingerprint.includes('1001'), false);
});

test('fingerprints reject incomplete or unsupported credential input', () => {
  for (const input of [
    null,
    {},
    { provider: '', accountId: '1', credential: 'a' },
    { provider: 'netease', accountId: '', credential: 'a' },
    { provider: 'netease', accountId: '1', credential: '' },
    { provider: 'netease', accountId: '1', credential: { cookie: 'secret' } },
  ]) {
    assert.throws(() => createAccountFingerprint(input), {
      name: 'TypeError',
    });
  }
});

test('collection membership and source values stay isolated and expire', () => {
  let now = 1000;
  const cache = createAccountScopedCache({
    maxEntries: 6,
    defaultTtlMs: 500,
    now: () => now,
  });
  const collectionValue = { collected: true, tags: ['favorite'] };
  cache.set('scope-a', 'collection', 'album:1', collectionValue, 100);
  cache.set('scope-a', 'membership', 'profile', { level: 9 });
  cache.set('scope-b', 'source', 'song:1', { url: 'https://audio.test/1' });

  collectionValue.tags.push('mutated-outside');
  const firstRead = cache.get('scope-a', 'collection', 'album:1');
  firstRead.tags.push('mutated-read');

  assert.deepEqual(cache.get('scope-a', 'collection', 'album:1'), {
    collected: true,
    tags: ['favorite'],
  });
  assert.equal(cache.get('scope-b', 'collection', 'album:1'), undefined);
  assert.deepEqual(cache.get('scope-a', 'membership', 'profile'), { level: 9 });
  assert.deepEqual(cache.get('scope-b', 'source', 'song:1'), {
    url: 'https://audio.test/1',
  });

  now = 1101;
  assert.equal(cache.get('scope-a', 'collection', 'album:1'), undefined);
  assert.equal(cache.snapshot().expirations, 1);
});

test('cache rejects unknown namespaces and invalid bounds', () => {
  assert.throws(() => createAccountScopedCache({ maxEntries: 0 }), {
    name: 'RangeError',
  });
  assert.throws(() => createAccountScopedCache({ defaultTtlMs: 0 }), {
    name: 'RangeError',
  });

  const cache = createAccountScopedCache();
  assert.throws(
    () => cache.set('scope', 'unknown', 'key', true),
    /namespace/i,
  );
  assert.throws(
    () => cache.get('scope', 'unknown', 'key'),
    /namespace/i,
  );
});

test('cache updates LRU on reads and evicts the least recently used entry', () => {
  let now = 10;
  const cache = createAccountScopedCache({
    maxEntries: 2,
    defaultTtlMs: 1000,
    now: () => now,
  });

  cache.set('scope', 'collection', 'first', 1);
  now += 1;
  cache.set('scope', 'collection', 'second', 2);
  now += 1;
  assert.equal(cache.get('scope', 'collection', 'first'), 1);
  now += 1;
  cache.set('scope', 'collection', 'third', 3);

  assert.equal(cache.get('scope', 'collection', 'second'), undefined);
  assert.equal(cache.get('scope', 'collection', 'first'), 1);
  assert.equal(cache.get('scope', 'collection', 'third'), 3);
  assert.equal(cache.snapshot().evictions, 1);
});

test('scope clearing and deletion do not affect other accounts', () => {
  const cache = createAccountScopedCache();
  cache.set('scope-a', 'collection', 'album:1', true);
  cache.set('scope-a', 'source', 'song:1', 'source-a');
  cache.set('scope-b', 'collection', 'album:1', false);

  assert.equal(cache.delete('scope-a', 'source', 'song:1'), true);
  assert.equal(cache.delete('scope-a', 'source', 'song:1'), false);
  assert.equal(cache.clearScope('scope-a'), 1);
  assert.equal(cache.get('scope-a', 'collection', 'album:1'), undefined);
  assert.equal(cache.get('scope-b', 'collection', 'album:1'), false);
  assert.equal(cache.clear(), 1);
  assert.equal(cache.snapshot().entries, 0);
});

function bindAccount(cache, accountId, credential) {
  assert.equal(typeof createAccountCacheBinding, 'function');
  return createAccountCacheBinding({
    cache,
    provider: 'netease',
    accountId,
    credential,
  });
}

test('production cache bindings isolate collection membership and source across A B A', () => {
  const cache = createAccountScopedCache();
  const accountA = bindAccount(cache, 'account-a', 'credential-a');
  const accountB = bindAccount(cache, 'account-b', 'credential-b');
  const values = {
    collection: { collected: true },
    membership: { vipLevel: 'svip' },
    source: { url: 'https://audio.test/account-a' },
  };

  for (const [namespace, value] of Object.entries(values)) {
    accountA.set(namespace, 'shared-key', value);
    assert.equal(accountB.get(namespace, 'shared-key'), undefined);
  }

  const accountARestored = bindAccount(cache, 'account-a', 'credential-a');
  for (const [namespace, value] of Object.entries(values)) {
    assert.deepEqual(accountARestored.get(namespace, 'shared-key'), value);
  }
});

test('production cache binding delete and clear stay inside the bound account', () => {
  const cache = createAccountScopedCache();
  const accountA = bindAccount(cache, 'account-a', 'credential-a');
  const accountB = bindAccount(cache, 'account-b', 'credential-b');
  for (const namespace of ['collection', 'membership', 'source']) {
    accountA.set(namespace, 'shared-key', `a-${namespace}`);
    accountB.set(namespace, 'shared-key', `b-${namespace}`);
  }

  assert.equal(accountA.delete('collection', 'shared-key'), true);
  assert.equal(accountA.get('collection', 'shared-key'), undefined);
  assert.equal(accountB.get('collection', 'shared-key'), 'b-collection');
  assert.equal(accountA.clear(), 2);
  assert.equal(accountA.get('membership', 'shared-key'), undefined);
  assert.equal(accountA.get('source', 'shared-key'), undefined);
  assert.equal(accountB.get('membership', 'shared-key'), 'b-membership');
  assert.equal(accountB.get('source', 'shared-key'), 'b-source');
});

test('cache snapshots expose counts only', () => {
  const cache = createAccountScopedCache();
  cache.set('scope-account-secret', 'collection', 'album:private', {
    cookie: 'MUSIC_U=snapshot-secret',
  });
  cache.set('scope-account-secret', 'membership', 'vip:private', true);

  const snapshot = cache.snapshot();
  assert.deepEqual(snapshot.namespaces, {
    collection: 1,
    membership: 1,
    source: 0,
  });
  assert.equal(snapshot.entries, 2);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'entries',
    'evictions',
    'expirations',
    'namespaces',
  ]);
  const serialized = JSON.stringify(snapshot);
  for (const secret of [
    'scope-account-secret',
    'album:private',
    'vip:private',
    'snapshot-secret',
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test('account switch clears the old scope before publishing a sanitized account', async () => {
  const events = [];
  const published = [];
  const context = createAccountContext({
    clearScope(scope) {
      events.push(`cache:${scope}`);
    },
    clearInflight(provider) {
      events.push(`inflight:${provider}`);
    },
    clearSession(provider) {
      events.push(`session:${provider}`);
    },
    publish(provider, account) {
      events.push(`publish:${provider}:${account.accountId}`);
      published.push(account);
    },
  });

  await context.switchAccount('netease', {
    accountId: '1001',
    credential: 'credential-a',
    nickname: 'First',
  });
  events.length = 0;
  await context.switchAccount('netease', {
    accountId: '1002',
    credential: 'credential-b',
    nickname: 'Second',
    token: 'must-not-publish',
    membership: {
      vipLevel: 'svip',
      isVip: true,
      token: 'membership-secret',
    },
  });

  assert.deepEqual(events, [
    `cache:${createAccountFingerprint({
      provider: 'netease',
      accountId: '1001',
      credential: 'credential-a',
    })}`,
    'inflight:netease',
    'publish:netease:1002',
  ]);
  assert.deepEqual(published.at(-1), {
    loggedIn: true,
    accountId: '1002',
    nickname: 'Second',
    avatar: '',
    membership: {
      vipLevel: 'svip',
      isVip: true,
      isSvip: false,
      known: true,
    },
  });
  assert.equal(JSON.stringify(published).includes('must-not-publish'), false);
  assert.equal(JSON.stringify(published).includes('membership-secret'), false);
  assert.deepEqual(context.getState('netease'), {
    status: 'active',
    account: published.at(-1),
  });
});

test('account switch awaits every cleanup hook before publishing', async () => {
  const events = [];
  let gates = null;
  const context = createAccountContext({
    async clearScope() {
      events.push('cache:start');
      await gates.cache.promise;
      events.push('cache:end');
    },
    async clearInflight() {
      events.push('inflight:start');
      await gates.inflight.promise;
      events.push('inflight:end');
    },
    async clearSession() {
      events.push('session:unexpected');
    },
    publish(provider, account) {
      events.push(`publish:${provider}:${account.accountId}`);
    },
  });
  await context.switchAccount('netease', {
    accountId: 'old',
    credential: 'old-credential',
  });
  events.length = 0;
  gates = {
    cache: deferred(),
    inflight: deferred(),
  };

  const transition = context.switchAccount('netease', {
    accountId: 'new',
    credential: 'new-credential',
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['cache:start']);

  gates.cache.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['cache:start', 'cache:end', 'inflight:start']);

  gates.inflight.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await transition;
  assert.deepEqual(events, [
    'cache:start',
    'cache:end',
    'inflight:start',
    'inflight:end',
    'publish:netease:new',
  ]);
});

test('logout uses the same cleanup order and publishes logged-out state', async () => {
  const events = [];
  const context = createAccountContext({
    clearScope(scope) {
      events.push(`cache:${scope}`);
    },
    clearInflight(provider) {
      events.push(`inflight:${provider}`);
    },
    clearSession(provider) {
      events.push(`session:${provider}`);
    },
    publish(provider, account) {
      events.push(`publish:${provider}:${account.loggedIn}`);
    },
  });
  await context.switchAccount('qq', {
    accountId: 'qq-1',
    credential: 'qq-secret',
  });
  events.length = 0;

  await context.logout('qq');

  assert.deepEqual(events, [
    `cache:${createAccountFingerprint({
      provider: 'qq',
      accountId: 'qq-1',
      credential: 'qq-secret',
    })}`,
    'inflight:qq',
    'session:qq',
    'publish:qq:false',
  ]);
  assert.deepEqual(context.getState('qq'), {
    status: 'loggedOut',
    account: {
      loggedIn: false,
      accountId: '',
      nickname: '',
      avatar: '',
      membership: {
        vipLevel: 'none',
        isVip: false,
        isSvip: false,
        known: false,
      },
    },
  });
});

test('same-provider switches are serialized in call order', async () => {
  const firstPublishGate = deferred();
  const events = [];
  const context = createAccountContext({
    async publish(provider, account) {
      events.push(`start:${provider}:${account.accountId}`);
      if (account.accountId === 'first') await firstPublishGate.promise;
      events.push(`end:${provider}:${account.accountId}`);
    },
  });

  const first = context.switchAccount('netease', {
    accountId: 'first',
    credential: 'credential-first',
  });
  const second = context.switchAccount('netease', {
    accountId: 'second',
    credential: 'credential-second',
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['start:netease:first']);

  firstPublishGate.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(events, [
    'start:netease:first',
    'end:netease:first',
    'start:netease:second',
    'end:netease:second',
  ]);
  assert.equal(context.getState('netease').account.accountId, 'second');
});

test('switch cleanup failure restores the previous active state and never publishes', async () => {
  const published = [];
  const context = createAccountContext({
    clearScope() {
      throw new Error('MUSIC_U=cleanup-secret');
    },
    publish(provider, account) {
      published.push({ provider, account });
    },
  });
  await context.switchAccount('netease', {
    accountId: 'old',
    credential: 'old-secret',
  });
  published.length = 0;

  await assert.rejects(
    context.switchAccount('netease', {
      accountId: 'new',
      credential: 'new-secret',
    }),
    error => {
      assert.equal(error.code, 'ACCOUNT_TRANSITION_FAILED');
      assert.equal(error.message, 'Account transition failed');
      assert.equal(JSON.stringify(error).includes('cleanup-secret'), false);
      return true;
    },
  );
  assert.equal(published.length, 0);
  assert.deepEqual(context.getState('netease'), {
    status: 'active',
    account: {
      loggedIn: true,
      accountId: 'old',
      nickname: '',
      avatar: '',
      membership: {
        vipLevel: 'none',
        isVip: false,
        isSvip: false,
        known: false,
      },
    },
  });
});

test('first login and logout failures roll back to their prior stable states', async () => {
  let failPublish = true;
  let failLogout = false;
  const context = createAccountContext({
    clearSession() {
      if (failLogout) throw new Error('logout-secret');
    },
    publish(_provider, account) {
      if (failPublish && account.loggedIn) throw new Error('publish-secret');
    },
  });

  await assert.rejects(
    context.switchAccount('spotify', {
      accountId: 'new-user',
      credential: 'new-secret',
    }),
    { code: 'ACCOUNT_TRANSITION_FAILED' },
  );
  assert.deepEqual(context.getState('spotify'), {
    status: 'loggedOut',
    account: {
      loggedIn: false,
      accountId: '',
      nickname: '',
      avatar: '',
      membership: {
        vipLevel: 'none',
        isVip: false,
        isSvip: false,
        known: false,
      },
    },
  });

  failPublish = false;
  await context.switchAccount('spotify', {
    accountId: 'active-user',
    credential: 'active-secret',
  });
  failLogout = true;
  await assert.rejects(context.logout('spotify'), {
    code: 'ACCOUNT_TRANSITION_FAILED',
  });
  assert.equal(context.getState('spotify').status, 'active');
  assert.equal(context.getState('spotify').account.accountId, 'active-user');
});
