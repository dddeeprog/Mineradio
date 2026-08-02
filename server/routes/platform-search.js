'use strict';

function requireFunction(deps, name) {
  const value = deps[name];
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function safeValidationCode(error) {
  if (!error || error.statusCode !== 400) return '';
  return [
    'SEARCH_QUERY_REQUIRED',
    'SEARCH_QUERY_TOO_LONG',
    'SEARCH_PROVIDER_INVALID',
  ].includes(error.code)
    ? error.code
    : '';
}

function createPlatformSearchRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const search = requireFunction(deps, 'search');

  async function handleRoute(pathname, req, res, url) {
    if (pathname !== '/api/platform/search') return false;
    if (String(req && req.method || '').toUpperCase() !== 'GET') {
      sendJSON(res, {
        ok: false,
        error: 'METHOD_NOT_ALLOWED',
      }, 405);
      return true;
    }

    try {
      const searchParams = url && url.searchParams;
      const response = await search({
        query: searchParams
          ? searchParams.get('q') || searchParams.get('keywords') || ''
          : '',
        provider: searchParams ? searchParams.get('provider') || 'all' : 'all',
        limit: searchParams ? searchParams.get('limit') : undefined,
        offset: searchParams ? searchParams.get('offset') : undefined,
      });
      sendJSON(res, response, 200);
    } catch (error) {
      const validationCode = safeValidationCode(error);
      sendJSON(res, {
        ok: false,
        error: validationCode || 'SEARCH_FAILED',
      }, validationCode ? 400 : 500);
    }
    return true;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createPlatformSearchRoutes,
};
