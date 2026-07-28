const net = require('net');

const LOOPBACK_HOST = '127.0.0.1';

const GET_ONLY_ROUTES = new Set([
  '/api/platform/capabilities',
  '/api/platform/search',
]);

const POST_ONLY_ROUTES = new Set([
  '/api/update/download',
  '/api/update/patch',
  '/api/logout',
  '/api/qq/logout',
  '/api/login/cookie',
  '/api/qq/login/cookie',
  '/api/song/like',
  '/api/playlist/create',
  '/api/playlist/add-song',
  '/api/folia/theme/generate',
]);

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/[.]$/, '')
    .toLowerCase();
}

function envFlagEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function isLoopbackHost(value) {
  const host = normalizeHost(value);
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function resolveBindHost(env) {
  env = env || process.env;
  const requested = String(env.HOST || '').trim();
  if (!requested) return LOOPBACK_HOST;
  if (isLoopbackHost(requested)) return requested;
  return envFlagEnabled(env.MINERADIO_ALLOW_LAN) ? requested : LOOPBACK_HOST;
}

function parseIPv4(host) {
  const parts = normalizeHost(host).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(part => {
    if (!/^\d+$/.test(part)) return NaN;
    const n = Number(part);
    return n >= 0 && n <= 255 ? n : NaN;
  });
  return nums.every(Number.isInteger) ? nums : null;
}

function isLocalIPv4(parts) {
  if (!parts) return false;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
}

function isLocalIPv6(host) {
  const normalized = normalizeHost(host);
  return normalized === '::1'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.')
    || normalized.startsWith('::ffff:169.254.');
}

function isLocalNetworkHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const ipType = net.isIP(host);
  if (ipType === 4) return isLocalIPv4(parseIPv4(host));
  if (ipType === 6) return isLocalIPv6(host);
  return false;
}

function assertHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch (err) {
    throw new Error('INVALID_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('INVALID_URL_PROTOCOL');
  }
  return parsed;
}

function assertAllowedRemoteMediaUrl(value) {
  const parsed = assertHttpUrl(value);
  if (isLocalNetworkHost(parsed.hostname)) {
    throw new Error('LOCAL_NETWORK_URL_REJECTED');
  }
  return parsed;
}

function isAllowedCorsOrigin(origin, port) {
  const raw = String(origin || '').trim();
  if (!raw) return true;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  if (String(parsed.port || '') !== String(port || '')) return false;
  const host = normalizeHost(parsed.hostname);
  return host === '127.0.0.1' || host === 'localhost';
}

function corsHeadersForOrigin(origin, port) {
  if (!isAllowedCorsOrigin(origin, port) || !origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
  };
}

function isStateChangingRoute(pathname) {
  return POST_ONLY_ROUTES.has(String(pathname || ''));
}

function isMethodAllowedForRoute(pathname, method) {
  pathname = String(pathname || '');
  method = String(method || '').toUpperCase();
  if (GET_ONLY_ROUTES.has(pathname)) return method === 'GET';
  if (POST_ONLY_ROUTES.has(pathname)) return method === 'POST';
  return true;
}

module.exports = {
  assertAllowedRemoteMediaUrl,
  assertHttpUrl,
  corsHeadersForOrigin,
  isAllowedCorsOrigin,
  isMethodAllowedForRoute,
  isStateChangingRoute,
  resolveBindHost,
};
