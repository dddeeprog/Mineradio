const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertAllowedRemoteMediaUrl,
  isAllowedCorsOrigin,
  isAllowedRequestOrigin,
  isStateChangingRoute,
  isMethodAllowedForRoute,
  resolveBindHost,
} = require('../server/security');

test('server binds to loopback unless LAN exposure is explicitly enabled', () => {
  assert.equal(resolveBindHost({}), '127.0.0.1');
  assert.equal(resolveBindHost({ HOST: '0.0.0.0' }), '127.0.0.1');
  assert.equal(resolveBindHost({ HOST: '0.0.0.0', MINERADIO_ALLOW_LAN: '1' }), '0.0.0.0');
});

test('cors origin is limited to the active local app origin', () => {
  assert.equal(isAllowedCorsOrigin('', 34567), true);
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:34567', 34567), true);
  assert.equal(isAllowedCorsOrigin('http://localhost:34567', 34567), true);
  assert.equal(isAllowedCorsOrigin('https://evil.example', 34567), false);
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:3000', 34567), false);
});

test('state changing routes require POST', () => {
  assert.equal(isStateChangingRoute('/api/update/download'), true);
  assert.equal(isStateChangingRoute('/api/logout'), true);
  assert.equal(isStateChangingRoute('/api/song/like/check'), false);

  assert.equal(isMethodAllowedForRoute('/api/update/download', 'POST'), true);
  assert.equal(isMethodAllowedForRoute('/api/update/download', 'GET'), false);
  assert.equal(isMethodAllowedForRoute('/api/search', 'GET'), true);
});

test('netease album and community routes enforce their exact methods', () => {
  assert.equal(isMethodAllowedForRoute('/api/album/detail', 'GET'), true);
  assert.equal(isMethodAllowedForRoute('/api/album/detail', 'POST'), false);
  for (const pathname of [
    '/api/album/collect',
    '/api/playlist/subscribe',
    '/api/song/comments/like',
  ]) {
    assert.equal(isStateChangingRoute(pathname), true);
    assert.equal(isMethodAllowedForRoute(pathname, 'POST'), true);
    assert.equal(isMethodAllowedForRoute(pathname, 'GET'), false);
  }
  assert.equal(isStateChangingRoute('/api/song/comments'), true);
  assert.equal(isMethodAllowedForRoute('/api/song/comments', 'GET'), true);
  assert.equal(isMethodAllowedForRoute('/api/song/comments', 'POST'), true);
  assert.equal(isMethodAllowedForRoute('/api/song/comments', 'DELETE'), false);
});

test('write-route CSRF boundary rejects non-loopback and mismatched origins', () => {
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:34567', 34567), true);
  assert.equal(isAllowedCorsOrigin('http://localhost:34567', 34567), true);
  assert.equal(isAllowedCorsOrigin('https://music.example', 34567), false);
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:45678', 34567), false);
});

test('state-changing API requests reject a missing Origin', () => {
  const trustedOrigin = 'http://127.0.0.1:34567';
  for (const pathname of [
    '/api/platform/login/import',
    '/api/platform/logout',
    '/api/album/collect',
    '/api/song/comments',
  ]) {
    assert.equal(isStateChangingRoute(pathname), true);
    assert.equal(
      isAllowedRequestOrigin(trustedOrigin, 34567, 'POST'),
      true,
    );
    assert.equal(isAllowedRequestOrigin('', 34567, 'POST'), false);
    assert.equal(
      isAllowedRequestOrigin('https://evil.example', 34567, 'POST'),
      false,
    );
  }
  assert.equal(
    isAllowedRequestOrigin('', 34567, 'GET'),
    true,
  );
});

test('platform capability route is GET-only', () => {
  assert.equal(
    isMethodAllowedForRoute('/api/platform/capabilities', 'GET'),
    true,
  );
  assert.equal(
    isMethodAllowedForRoute('/api/platform/capabilities', 'POST'),
    false,
  );
  assert.equal(
    isMethodAllowedForRoute('/api/platform/capabilities', 'DELETE'),
    false,
  );
});

test('unified platform search route is GET-only', () => {
  assert.equal(
    isMethodAllowedForRoute('/api/platform/search', 'GET'),
    true,
  );
  assert.equal(
    isMethodAllowedForRoute('/api/platform/search', 'POST'),
    false,
  );
  assert.equal(
    isMethodAllowedForRoute('/api/platform/search', 'DELETE'),
    false,
  );
});

test('remote media URL validation rejects local network targets', () => {
  assert.doesNotThrow(() => assertAllowedRemoteMediaUrl('https://music.163.com/song/media/outer/url?id=1.mp3'));
  assert.doesNotThrow(() => assertAllowedRemoteMediaUrl('https://y.qq.com/music/photo_new/T002R300x300M000abc.jpg'));

  assert.throws(() => assertAllowedRemoteMediaUrl('ftp://example.com/file.mp3'), /INVALID_URL_PROTOCOL/);
  assert.throws(() => assertAllowedRemoteMediaUrl('http://127.0.0.1:3000/api/login/status'), /LOCAL_NETWORK_URL_REJECTED/);
  assert.throws(() => assertAllowedRemoteMediaUrl('http://localhost:3000/api/login/status'), /LOCAL_NETWORK_URL_REJECTED/);
  assert.throws(() => assertAllowedRemoteMediaUrl('http://10.0.0.5/audio.mp3'), /LOCAL_NETWORK_URL_REJECTED/);
  assert.throws(() => assertAllowedRemoteMediaUrl('http://169.254.169.254/latest/meta-data'), /LOCAL_NETWORK_URL_REJECTED/);
});
