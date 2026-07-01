'use strict';

function requireFunction(deps, name) {
  const fn = deps[name];
  if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  return fn;
}

function createAppStatusRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const appVersionPayload = requireFunction(deps, 'appVersionPayload');
  const getLoginInfo = requireFunction(deps, 'getLoginInfo');

  async function handleRoute(pn, _req, res) {
    if (pn === '/api/app/version') {
      sendJSON(res, appVersionPayload());
      return true;
    }
    if (pn === '/api/login/status') {
      sendJSON(res, await getLoginInfo());
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createAppStatusRoutes,
};
