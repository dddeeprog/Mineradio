'use strict';

function createDiscoverRoutes(deps) {
  deps = deps || {};
  const sendJSON = deps.sendJSON;
  const handleDiscoverHome = deps.handleDiscoverHome;

  if (typeof sendJSON !== 'function') throw new TypeError('sendJSON is required');
  if (typeof handleDiscoverHome !== 'function') throw new TypeError('handleDiscoverHome is required');

  async function handleRoute(pn, _req, res) {
    if (pn !== '/api/discover/home') return false;
    try {
      sendJSON(res, await handleDiscoverHome());
    } catch (err) {
      console.error('[DiscoverHome]', err);
      sendJSON(res, { error: err.message, loggedIn: false, dailySongs: [], playlists: [], podcasts: [] }, 500);
    }
    return true;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createDiscoverRoutes,
};
