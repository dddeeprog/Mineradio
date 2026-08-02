'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAccountContext } = require('../server/platform/account-context');
const {
  createCredentialSession,
} = require('../server/platform/credential-session');
const {
  createAccountLifecycle,
} = require('../server/platform/account-lifecycle');

function serializeError(error) {
  return JSON.stringify(error, Object.getOwnPropertyNames(error));
}

function createFixture(options = {}) {
  const events = [];
  const session = createCredentialSession({
    mode: 'memory-only',
    async persistCredential(provider, credential) {
      events.push(`persist:${provider}:${credential.cookie || credential.token}`);
      if (options.failPersist) throw new Error('persist-secret');
      return { persisted: false, mode: 'memory-only' };
    },
    async clearCredential(provider) {
      events.push(`clear:${provider}`);
      return { persisted: false, mode: 'memory-only' };
    },
  });
  session.hydrate(options.credentials || {});
  const context = createAccountContext({
    clearScope(scope) {
      events.push(`scope:${scope}`);
    },
    clearInflight(provider) {
      events.push(`inflight:${provider}`);
    },
    clearSession(provider) {
      return session.clear(provider);
    },
    publish(provider, account) {
      events.push(`publish:${provider}:${account.loggedIn}:${account.accountId}`);
    },
  });
  const lifecycle = createAccountLifecycle({
    credentialSession: session,
    accountContext: context,
  });
  return { context, events, lifecycle, session };
}

test('login commits the credential before resolving and publishes a sanitized account', async () => {
  const fixture = createFixture();
  const result = await fixture.lifecycle.login(
    'netease',
    { cookie: 'MUSIC_U=new-secret' },
    async () => {
      assert.equal(fixture.session.read('netease').cookie, 'MUSIC_U=new-secret');
      fixture.events.push('resolve');
      return {
        loggedIn: true,
        userId: 1001,
        nickname: 'Tomato',
        avatar: 'https://img.example/avatar.jpg',
        membership: { isVip: true },
        token: 'must-not-publish',
      };
    },
  );

  assert.equal(result.accountId, '1001');
  assert.equal(result.loggedIn, true);
  assert.equal(JSON.stringify(result).includes('must-not-publish'), false);
  assert.deepEqual(fixture.events, [
    'persist:netease:MUSIC_U=new-secret',
    'resolve',
    'publish:netease:true:1001',
  ]);
  assert.equal(fixture.context.getState('netease').status, 'active');
});

test('login preserves top-level membership fields as known account state', async () => {
  const fixture = createFixture();

  const result = await fixture.lifecycle.login(
    'netease',
    { cookie: 'MUSIC_U=vip-secret' },
    async () => ({
      loggedIn: true,
      accountId: 'vip-user',
      vipLevel: 'vip',
      isVip: true,
    }),
  );

  assert.deepEqual(result.membership, {
    vipLevel: 'vip',
    isVip: true,
    isSvip: false,
    known: true,
  });
});

test('login failure restores the previous credential and account without leaking secrets', async () => {
  const fixture = createFixture({
    credentials: {
      qq: { accountId: 'old-user', cookie: 'uin=old-secret' },
    },
  });
  await fixture.context.switchAccount('qq', {
    accountId: 'old-user',
    credential: 'uin=old-secret',
  });
  fixture.events.length = 0;

  await assert.rejects(
    fixture.lifecycle.login(
      'qq',
      { cookie: 'uin=new-secret' },
      async () => {
        throw new Error('profile failed with new-secret');
      },
    ),
    error => error.code === 'ACCOUNT_LIFECYCLE_LOGIN_FAILED'
      && !serializeError(error).includes('new-secret')
      && !serializeError(error).includes('old-secret'),
  );

  assert.equal(fixture.session.read('qq').cookie, 'uin=old-secret');
  assert.equal(fixture.context.getState('qq').account.accountId, 'old-user');
  assert.deepEqual(fixture.events, [
    'persist:qq:uin=new-secret',
    'persist:qq:uin=old-secret',
  ]);
});

test('login derives a stable opaque account id when profile metadata is pending', async () => {
  const fixture = createFixture();
  const first = await fixture.lifecycle.login(
    'netease',
    { cookie: 'MUSIC_U=pending-secret' },
    async () => ({ loggedIn: true, pendingProfile: true }),
  );
  const second = await fixture.lifecycle.login(
    'netease',
    { cookie: 'MUSIC_U=pending-secret' },
    async () => ({ loggedIn: true, pendingProfile: true }),
  );

  assert.match(first.accountId, /^pending-[a-f0-9]{24}$/);
  assert.equal(second.accountId, first.accountId);
  assert.equal(first.accountId.includes('pending-secret'), false);
});

test('logout performs account cleanup and credential deletion before publishing', async () => {
  const fixture = createFixture();
  await fixture.lifecycle.login(
    'qishui',
    { token: 'qishui-secret' },
    async () => ({ loggedIn: true, accountId: 'qishui-user' }),
  );
  fixture.events.length = 0;

  const result = await fixture.lifecycle.logout('qishui');

  assert.equal(result.loggedIn, false);
  assert.equal(fixture.session.read('qishui'), null);
  assert.equal(fixture.context.getState('qishui').status, 'loggedOut');
  assert.equal(fixture.events[0].startsWith('scope:'), true);
  assert.deepEqual(fixture.events.slice(1), [
    'inflight:qishui',
    'clear:qishui',
    'publish:qishui:false:',
  ]);
});

test('logout restores the credential when a later account transition hook fails', async () => {
  let failLoggedOutPublish = false;
  const events = [];
  const session = createCredentialSession({
    mode: 'memory-only',
    async persistCredential(_provider, credential) {
      events.push(`persist:${credential.cookie}`);
      return { persisted: false, mode: 'memory-only' };
    },
    async clearCredential() {
      events.push('clear');
      return { persisted: false, mode: 'memory-only' };
    },
  });
  session.hydrate({});
  const context = createAccountContext({
    clearSession: provider => session.clear(provider),
    publish(_provider, account) {
      if (failLoggedOutPublish && !account.loggedIn) {
        throw new Error('publish failed with logout-secret');
      }
    },
  });
  const lifecycle = createAccountLifecycle({
    credentialSession: session,
    accountContext: context,
  });
  await lifecycle.login(
    'qq',
    { cookie: 'uin=rollback-secret' },
    async () => ({ loggedIn: true, accountId: 'rollback-user' }),
  );
  events.length = 0;
  failLoggedOutPublish = true;

  await assert.rejects(
    lifecycle.logout('qq'),
    error => error.code === 'ACCOUNT_LIFECYCLE_LOGOUT_FAILED'
      && !serializeError(error).includes('rollback-secret')
      && !serializeError(error).includes('logout-secret'),
  );

  assert.equal(context.getState('qq').status, 'active');
  assert.equal(session.read('qq').cookie, 'uin=rollback-secret');
  assert.deepEqual(events, ['clear', 'persist:uin=rollback-secret']);
});

test('package check validates the account lifecycle module', () => {
  const packageJson = require('../package.json');
  assert.match(
    packageJson.scripts.check,
    /node --check server\/platform\/account-lifecycle\.js/,
  );
});
