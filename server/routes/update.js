'use strict';

function newestJob(jobs, predicate) {
  const values = Array.from(jobs && jobs.values ? jobs.values() : []);
  return values
    .filter(item => !predicate || predicate(item))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
}

function createUpdateRoutes(deps) {
  deps = deps || {};
  const sendJSON = deps.sendJSON;
  const fetchLatestUpdateInfo = deps.fetchLatestUpdateInfo;
  const localUpdateFallback = deps.localUpdateFallback;
  const startUpdateDownloadJob = deps.startUpdateDownloadJob;
  const startUpdatePatchJob = deps.startUpdatePatchJob;
  const publicUpdateJob = deps.publicUpdateJob;
  const updateDownloadJobs = deps.updateDownloadJobs;
  const updateConfigured = !!deps.updateConfigured;

  [
    ['sendJSON', sendJSON],
    ['fetchLatestUpdateInfo', fetchLatestUpdateInfo],
    ['localUpdateFallback', localUpdateFallback],
    ['startUpdateDownloadJob', startUpdateDownloadJob],
    ['startUpdatePatchJob', startUpdatePatchJob],
    ['publicUpdateJob', publicUpdateJob],
  ].forEach(([name, fn]) => {
    if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  });
  if (!updateDownloadJobs || typeof updateDownloadJobs.get !== 'function') {
    throw new TypeError('updateDownloadJobs is required');
  }

  async function handleLatest(_req, res) {
    try {
      sendJSON(res, await fetchLatestUpdateInfo());
    } catch (err) {
      sendJSON(res, {
        ...localUpdateFallback(err.message || 'Update check failed', { configured: updateConfigured }),
        error: err.message || 'Update check failed',
      });
    }
  }

  async function handleDownload(_req, res) {
    try {
      const info = await fetchLatestUpdateInfo();
      const job = startUpdateDownloadJob(info);
      sendJSON(res, job, job.ok ? 200 : 400);
    } catch (err) {
      console.error('[UpdateDownload]', err);
      sendJSON(res, { ok: false, error: err.message || 'UPDATE_DOWNLOAD_START_FAILED' }, 500);
    }
  }

  function handleDownloadStatus(_req, res, url) {
    const id = url.searchParams.get('id') || '';
    const job = id
      ? updateDownloadJobs.get(id)
      : newestJob(updateDownloadJobs);
    sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
  }

  async function handlePatch(_req, res) {
    try {
      const info = await fetchLatestUpdateInfo();
      const job = startUpdatePatchJob(info);
      sendJSON(res, job, job.ok ? 200 : 400);
    } catch (err) {
      console.error('[UpdatePatch]', err);
      sendJSON(res, { ok: false, error: err.message || 'UPDATE_PATCH_START_FAILED' }, 500);
    }
  }

  function handlePatchStatus(_req, res, url) {
    const id = url.searchParams.get('id') || '';
    const job = id
      ? updateDownloadJobs.get(id)
      : newestJob(updateDownloadJobs, item => item.mode === 'patch');
    sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/update/latest') {
      await handleLatest(req, res, url);
      return true;
    }
    if (pn === '/api/update/download') {
      await handleDownload(req, res, url);
      return true;
    }
    if (pn === '/api/update/download/status') {
      handleDownloadStatus(req, res, url);
      return true;
    }
    if (pn === '/api/update/patch') {
      await handlePatch(req, res, url);
      return true;
    }
    if (pn === '/api/update/patch/status') {
      handlePatchStatus(req, res, url);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createUpdateRoutes,
};
