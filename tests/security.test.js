const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertAllowedRemoteMediaUrl,
  isAllowedCorsOrigin,
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
