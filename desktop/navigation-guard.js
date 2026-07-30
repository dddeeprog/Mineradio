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

const LOGIN_URL_RULES = Object.freeze({
  netease: Object.freeze([
    ['music.163.com', /^\/(?:$|login(?:\/|$)|discover(?:\/|$)|user(?:\/|$)|my(?:\/|$)|api(?:\/|$))/],
    ['passport.163.com', /^\/(?:$|login(?:\/|$)|oauth(?:\/|$))/],
    ['reg.163.com', /^\/(?:$|logins(?:\/|$)|services(?:\/|$))/],
    ['urs.163.com', /^\/(?:$|webzj(?:\/|$)|oauth(?:\/|$))/],
  ]),
  qq: Object.freeze([
    ['y.qq.com', /^\/(?:$|n(?:\/|$)|portal(?:\/|$))/],
    ['ptlogin2.qq.com', /^\/(?:$|cgi-bin(?:\/|$))/],
    ['xui.ptlogin2.qq.com', /^\/(?:$|cgi-bin(?:\/|$))/],
    ['graph.qq.com', /^\/(?:$|oauth2\.0(?:\/|$))/],
  ]),
  kugou: Object.freeze([
    ['www.kugou.com', /^\/(?:$|newuc(?:\/|$)|yy(?:\/|$))/],
    ['login-user.kugou.com', /^\/(?:$|login(?:\/|$)|user(?:\/|$))/],
    ['user.kugou.com', /^\/(?:$|login(?:\/|$)|uc(?:\/|$))/],
  ]),
  qishui: Object.freeze([
    ['qishui.douyin.com', /^\//],
    ['bff-pc.qishui.com', /^\/ucenter_web(?:\/|$)/],
    ['sso.douyin.com', /^\/(?:$|login(?:\/|$)|passport(?:\/|$))/],
    ['passport.qishui.com', /^\/(?:$|login(?:\/|$))/],
  ]),
  spotify: Object.freeze([
    ['accounts.spotify.com', /^\/(?:authorize|login|oauth2(?:\/|$)|[a-z]{2}\/(?:authorize|login))(?:\/|$)/],
  ]),
});

function isAllowedLoginUrl(value, provider) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:') return false;
  const rules = LOGIN_URL_RULES[provider];
  if (!rules) return false;
  const host = normalizeHost(url.hostname);
  return rules.some(([allowedHost, pathPattern]) => (
    host === allowedHost && pathPattern.test(url.pathname)
  ));
}

module.exports = {
  isAllowedAppUrl,
  isAllowedLoginUrl,
  isSafeExternalUrl,
};
