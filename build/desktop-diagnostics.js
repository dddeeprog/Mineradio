'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CANONICAL_RELEASE = Object.freeze({
  owner: 'English-worse',
  repo: 'Mineradio',
});

const PROFILE_FIELDS = Object.freeze([
  'appId',
  'productName',
  'userDataRoot',
  'uninstallKey',
  'updateChannel',
  'artifactName',
  'outputDirectory',
]);

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function parseRepository(repository) {
  const raw = typeof repository === 'string'
    ? repository
    : requireRecord(repository, 'package repository').url;
  const match = String(raw || '').match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/i);
  if (!match) throw new Error('Package repository must be a GitHub repository URL');
  return { owner: match[1], repo: match[2] };
}

function firstGithubPublish(config, label) {
  const entries = Array.isArray(config.publish) ? config.publish : [config.publish];
  const publish = entries.find((entry) => entry && entry.provider === 'github');
  if (!publish) throw new Error(`${label} must declare a GitHub publish target`);
  return {
    owner: requireText(publish.owner, `${label} publish owner`),
    repo: requireText(publish.repo, `${label} publish repository`),
    channel: requireText(publish.channel || 'latest', `${label} publish channel`),
  };
}

function buildProfile(channel, config, metadata) {
  const declared = requireRecord(metadata.mineradioBuild, `${channel} mineradioBuild`);
  const update = requireRecord(
    metadata.mineradio && metadata.mineradio.update,
    `${channel} update metadata`,
  );
  const nsis = requireRecord(config.nsis, `${channel} NSIS configuration`);
  const directories = requireRecord(config.directories, `${channel} build directories`);
  const publish = firstGithubPublish(config, channel);

  const profile = {
    channel: requireText(declared.channel, `${channel} channel`),
    appId: requireText(config.appId, `${channel} appId`),
    productName: requireText(config.productName, `${channel} productName`),
    userDataRoot: requireText(declared.userDataRoot, `${channel} user data root`),
    uninstallKey: requireText(declared.uninstallKey || nsis.guid, `${channel} uninstall key`),
    updateChannel: requireText(update.channel || declared.updateChannel, `${channel} update channel`),
    artifactName: requireText(nsis.artifactName || config.artifactName, `${channel} artifact name`),
    outputDirectory: requireText(directories.output, `${channel} output directory`),
    publish,
  };

  if (profile.channel !== channel) {
    throw new Error(`${channel} profile declares the ${profile.channel} channel`);
  }
  if (declared.appId !== profile.appId || declared.productName !== profile.productName) {
    throw new Error(`${channel} package metadata disagrees with electron-builder identity`);
  }
  if (declared.artifactName !== profile.artifactName
      || declared.outputDirectory !== profile.outputDirectory) {
    throw new Error(`${channel} package metadata disagrees with build output configuration`);
  }
  if (declared.updateChannel !== profile.updateChannel) {
    throw new Error(`${channel} package metadata disagrees with the update channel`);
  }
  if (declared.releaseOwner !== publish.owner || declared.releaseRepo !== publish.repo
      || update.owner !== publish.owner || update.repo !== publish.repo) {
    throw new Error(`${channel} release ownership is inconsistent`);
  }
  return profile;
}

function createDesktopBuildDiagnostics(packageMetadata, betaConfig) {
  const pkg = requireRecord(packageMetadata, 'package metadata');
  const beta = requireRecord(betaConfig, 'beta build configuration');
  const repository = parseRepository(pkg.repository);
  const stable = buildProfile('stable', requireRecord(pkg.build, 'stable build configuration'), pkg);
  const betaMetadata = Object.assign({}, pkg, requireRecord(beta.extraMetadata, 'beta extraMetadata'));
  const betaProfile = buildProfile('beta', beta, betaMetadata);

  for (const target of [repository, stable.publish, betaProfile.publish]) {
    if (target.owner !== CANONICAL_RELEASE.owner || target.repo !== CANONICAL_RELEASE.repo) {
      throw new Error('Release ownership must remain English-worse/Mineradio');
    }
  }
  for (const field of PROFILE_FIELDS) {
    if (stable[field] === betaProfile[field]) {
      throw new Error(`Stable and beta profiles must isolate ${field}`);
    }
  }

  return {
    schemaVersion: 1,
    repository,
    profiles: { stable, beta: betaProfile },
  };
}

function readDesktopBuildDiagnostics(repoRoot = path.resolve(__dirname, '..')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const beta = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'build', 'electron-builder.beta.json'), 'utf8'),
  );
  return createDesktopBuildDiagnostics(pkg, beta);
}

module.exports = {
  createDesktopBuildDiagnostics,
  readDesktopBuildDiagnostics,
};

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(readDesktopBuildDiagnostics(), null, 2)}\n`);
}
