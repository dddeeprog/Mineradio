'use strict';

async function pipeReadableBody(upstream, res) {
  if (!upstream || !upstream.body) {
    res.end();
    return;
  }
  if (typeof upstream.body.getReader === 'function') {
    const reader = upstream.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      res.write(chunk.value);
    }
    res.end();
    return;
  }
  upstream.body.pipe(res);
}

function createProxyRoutes(deps) {
  deps = deps || {};
  const resolvePort = typeof deps.port === 'function' ? deps.port : () => deps.port;
  const userAgent = deps.userAgent || '';
  const corsHeadersForOrigin = deps.corsHeadersForOrigin;
  const assertAllowedProxyTarget = deps.assertAllowedProxyTarget;
  const audioProxyHeadersFor = deps.audioProxyHeadersFor;
  const audioContentTypeForUrl = deps.audioContentTypeForUrl;
  const fetchImpl = deps.fetchImpl || fetch;

  [
    ['corsHeadersForOrigin', corsHeadersForOrigin],
    ['assertAllowedProxyTarget', assertAllowedProxyTarget],
    ['audioProxyHeadersFor', audioProxyHeadersFor],
    ['audioContentTypeForUrl', audioContentTypeForUrl],
    ['fetchImpl', fetchImpl],
  ].forEach(([name, fn]) => {
    if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  });

  async function handleCover(req, res, url) {
    try {
      const coverUrl = url.searchParams.get('url');
      try {
        assertAllowedProxyTarget(coverUrl);
      } catch (e) {
        res.writeHead(400, corsHeadersForOrigin(req.headers.origin, resolvePort()));
        res.end('Invalid cover url');
        return;
      }
      const resp = await fetchImpl(coverUrl, { headers: { 'User-Agent': userAgent, Referer: 'https://music.163.com/' } });
      const ct = resp.headers.get('content-type') || 'image/jpeg';
      const cl = resp.headers.get('content-length');
      const hdr = {
        'Content-Type': ct,
        ...corsHeadersForOrigin(req.headers.origin, resolvePort()),
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400',
      };
      if (cl) hdr['Content-Length'] = cl;
      res.writeHead(resp.status, hdr);
      await pipeReadableBody(resp, res);
    } catch (err) {
      console.error('[Cover]', err);
      res.writeHead(500);
      res.end();
    }
  }

  async function handleAudio(req, res, url) {
    try {
      const audioUrl = url.searchParams.get('url');
      if (!audioUrl) {
        res.writeHead(400);
        res.end('Missing url');
        return;
      }
      try {
        assertAllowedProxyTarget(audioUrl);
      } catch (e) {
        res.writeHead(400, corsHeadersForOrigin(req.headers.origin, resolvePort()));
        res.end('Invalid audio url');
        return;
      }
      const range = req.headers.range || '';
      const hdr = audioProxyHeadersFor(audioUrl, range);
      const up = await fetchImpl(audioUrl, { headers: hdr });
      const out = {
        'Content-Type': audioContentTypeForUrl(audioUrl, up.headers.get('content-type')),
        ...corsHeadersForOrigin(req.headers.origin, resolvePort()),
        'Accept-Ranges': 'bytes',
      };
      const cl = up.headers.get('content-length');
      if (cl) out['Content-Length'] = cl;
      const cr = up.headers.get('content-range');
      if (cr) out['Content-Range'] = cr;
      res.writeHead(up.status, out);
      await pipeReadableBody(up, res);
    } catch (err) {
      console.error('[Audio]', err);
      res.writeHead(500);
      res.end();
    }
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/cover') {
      await handleCover(req, res, url);
      return true;
    }
    if (pn === '/api/audio') {
      await handleAudio(req, res, url);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createProxyRoutes,
};
