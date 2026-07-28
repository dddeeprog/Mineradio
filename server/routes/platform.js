'use strict';

const {
  createCapabilitySnapshot: defaultCreateCapabilitySnapshot,
} = require('../platform/capabilities');

function requireFunction(deps, name) {
  const fn = deps[name];
  if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  return fn;
}

function createPlatformRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const getAccountStatuses = requireFunction(deps, 'getAccountStatuses');
  const createCapabilitySnapshot = deps.createCapabilitySnapshot === undefined
    ? defaultCreateCapabilitySnapshot
    : requireFunction(deps, 'createCapabilitySnapshot');

  async function handleCapabilities(res) {
    let statuses = {};
    try {
      statuses = await getAccountStatuses();
    } catch (_) {
      statuses = {};
    }

    let snapshot;
    try {
      // Implementation availability is server-owned; request data never reaches this call.
      snapshot = createCapabilitySnapshot(statuses);
    } catch (_) {
      snapshot = defaultCreateCapabilitySnapshot();
    }
    sendJSON(res, snapshot, 200);
  }

  async function handleRoute(pathname, req, res) {
    if (pathname !== '/api/platform/capabilities') return false;
    if (String(req && req.method || '').toUpperCase() !== 'GET') {
      sendJSON(res, {
        ok: false,
        error: 'METHOD_NOT_ALLOWED',
      }, 405);
      return true;
    }
    await handleCapabilities(res);
    return true;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createPlatformRoutes,
};
