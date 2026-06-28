const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isAllowedAppUrl,
  isAllowedLoginUrl,
  isSafeExternalUrl,
} = require('../desktop/navigation-guard');

test('main app navigation is limited to the active loopback origin', () => {
  assert.equal(isAllowedAppUrl('http://127.0.0.1:34567/', 34567), true);
  assert.equal(isAllowedAppUrl('http://127.0.0.1:34567/index.html', 34567), true);
  assert.equal(isAllowedAppUrl('http://localhost:34567/', 34567), false);
  assert.equal(isAllowedAppUrl('http://127.0.0.1:3000/', 34567), false);
  assert.equal(isAllowedAppUrl('https://example.com/', 34567), false);
});

test('external opener only allows ordinary https urls', () => {
  assert.equal(isSafeExternalUrl('https://example.com/path?q=1'), true);
  assert.equal(isSafeExternalUrl('http://example.com/'), false);
  assert.equal(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe'), false);
  assert.equal(isSafeExternalUrl('mineradio://update'), false);
  assert.equal(isSafeExternalUrl('not a url'), false);
});

test('provider login windows only load provider-owned hosts', () => {
  assert.equal(isAllowedLoginUrl('https://music.163.com/#/login', 'netease'), true);
  assert.equal(isAllowedLoginUrl('https://passport.163.com/login', 'netease'), true);
  assert.equal(isAllowedLoginUrl('https://music.163.com.evil.test/login', 'netease'), false);

  assert.equal(isAllowedLoginUrl('https://y.qq.com/n/ryqq/profile', 'qq'), true);
  assert.equal(isAllowedLoginUrl('https://xui.ptlogin2.qq.com/cgi-bin/xlogin', 'qq'), true);
  assert.equal(isAllowedLoginUrl('https://example.com/login', 'qq'), false);
});
