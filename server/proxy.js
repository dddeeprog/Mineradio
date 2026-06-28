const { assertAllowedRemoteMediaUrl } = require('./security');

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const AUDIO_PROXY_TIMEOUT_MS = 12000;
const COVER_PROXY_TIMEOUT_MS = 10000;

function audioProxyHeadersFor(audioUrl, range, userAgent) {
  const headers = { 'User-Agent': userAgent || DEFAULT_USER_AGENT, Referer: 'https://music.163.com/' };
  try {
    const host = new URL(audioUrl).hostname.toLowerCase();
    if (host.includes('qq.com') || host.includes('qpic.cn')) headers.Referer = 'https://y.qq.com/';
  } catch (e) {}
  if (range) headers.Range = range;
  return headers;
}

function audioContentTypeForUrl(audioUrl, upstreamType) {
  let pathname = '';
  try { pathname = new URL(audioUrl).pathname.toLowerCase(); } catch (e) {}
  if (/\.flac$/.test(pathname)) return 'audio/flac';
  if (/\.mp3$/.test(pathname)) return 'audio/mpeg';
  if (/\.(m4a|mp4)$/.test(pathname)) return 'audio/mp4';
  if (/\.ogg$/.test(pathname)) return 'audio/ogg';
  if (/\.wav$/.test(pathname)) return 'audio/wav';
  return upstreamType || 'audio/mpeg';
}

function assertAllowedProxyTarget(value) {
  return assertAllowedRemoteMediaUrl(value);
}

module.exports = {
  AUDIO_PROXY_TIMEOUT_MS,
  COVER_PROXY_TIMEOUT_MS,
  assertAllowedProxyTarget,
  audioContentTypeForUrl,
  audioProxyHeadersFor,
};
