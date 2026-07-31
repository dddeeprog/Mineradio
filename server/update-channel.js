'use strict';

function normalizeUpdateChannel(value) {
  return String(value || '').trim().toLowerCase() === 'beta' ? 'beta' : 'latest';
}

function createGithubUpdatePlan(config) {
  const source = config && typeof config === 'object' ? config : {};
  const owner = encodeURIComponent(String(source.owner || '').trim());
  const repo = encodeURIComponent(String(source.repo || '').trim());
  const channel = normalizeUpdateChannel(source.channel);
  const manifestName = `${channel}.yml`;

  return {
    channel,
    manifestName,
    releaseApiUrl: channel === 'latest'
      ? `https://api.github.com/repos/${owner}/${repo}/releases/latest`
      : `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`,
    fallbackManifestUrl: channel === 'latest'
      ? `https://github.com/${owner}/${repo}/releases/latest/download/${manifestName}`
      : '',
  };
}

function selectGithubRelease(payload, channel) {
  const normalizedChannel = normalizeUpdateChannel(channel);
  if (normalizedChannel === 'latest') {
    return payload && !Array.isArray(payload) ? payload : null;
  }
  if (!Array.isArray(payload)) return null;
  const manifestName = `${normalizedChannel}.yml`;
  return payload.find(release => {
    if (!release || release.draft || !Array.isArray(release.assets)) return false;
    return release.assets.some(asset => String(asset && asset.name || '').toLowerCase() === manifestName);
  }) || null;
}

module.exports = {
  createGithubUpdatePlan,
  normalizeUpdateChannel,
  selectGithubRelease,
};
