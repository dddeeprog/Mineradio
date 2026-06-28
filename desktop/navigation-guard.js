function parseUrl(value) {
  try {
    return new URL(String(value || ''));
  } catch (err) {
    return null;
  }
}

function normalizeHost(value) {
  return String(value || '').trim().replace(/[.]$/, '').toLowerCase();
}

function isAllowedAppUrl(value, port) {
  const url = parseUrl(value);
  if (!url) return false;
  return url.protocol === 'http:'
    && normalizeHost(url.hostname) === '127.0.0.1'
    && String(url.port || '') === String(port || '');
}

function isSafeExternalUrl(value) {
  const url = parseUrl(value);
  if (!url) return false;
  return url.protocol === 'https:' && !!normalizeHost(url.hostname);
}

function hostMatches(host, allowed) {
  const normalized = normalizeHost(host);
  return allowed.some(item => normalized === item || normalized.endsWith('.' + item));
}

function isAllowedLoginUrl(value, provider) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:') return false;
  const host = normalizeHost(url.hostname);
  if (provider === 'netease') {
    return hostMatches(host, [
      'music.163.com',
      'passport.163.com',
      'reg.163.com',
      'urs.163.com',
    ]);
  }
  if (provider === 'qq') {
    return hostMatches(host, [
      'qq.com',
      'y.qq.com',
      'ptlogin2.qq.com',
    ]);
  }
  return false;
}

module.exports = {
  isAllowedAppUrl,
  isAllowedLoginUrl,
  isSafeExternalUrl,
};
