#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function resolveFoliaBuildPaths(projectRoot = path.resolve(__dirname, '..')) {
  const root = path.resolve(projectRoot);
  const foliaRoot = path.join(root, 'third_party', 'folia-major');

  return {
    projectRoot: root,
    foliaRoot,
    foliaDist: path.join(foliaRoot, 'dist'),
    outputDir: path.join(root, 'public', 'folia-stage'),
  };
}

function buildFoliaStageEnvironment(baseEnv = process.env) {
  return {
    ...baseEnv,
    ELECTRON: 'true',
    APP_VERSION_LABEL: 'mineradio-folia-stage',
  };
}

function assertInside(parent, target, label) {
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${parent}: ${target}`);
  }
}

function ensureFoliaSource(paths) {
  const packageJsonPath = path.join(paths.foliaRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Folia source is missing: ${packageJsonPath}`);
  }
}

function quoteCmdArg(value) {
  return /^[\w:./\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

function resolvePlatformCommand(command, args = [], platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')],
    };
  }

  return { command, args };
}

function runCommand(command, args, options) {
  const executable = resolvePlatformCommand(command, args);
  const result = spawnSync(executable.command, executable.args, {
    ...options,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function syncFoliaDist(paths) {
  assertInside(paths.projectRoot, paths.outputDir, 'Folia stage output directory');
  if (!fs.existsSync(paths.foliaDist)) {
    throw new Error(`Folia build output is missing: ${paths.foliaDist}`);
  }

  fs.rmSync(paths.outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(paths.outputDir), { recursive: true });
  fs.cpSync(paths.foliaDist, paths.outputDir, { recursive: true });
}

function buildFoliaStage(projectRoot = path.resolve(__dirname, '..')) {
  const paths = resolveFoliaBuildPaths(projectRoot);
  ensureFoliaSource(paths);

  runCommand('npm', ['run', 'build'], {
    cwd: paths.foliaRoot,
    env: buildFoliaStageEnvironment(process.env),
  });
  syncFoliaDist(paths);

  return paths;
}

if (require.main === module) {
  buildFoliaStage();
}

module.exports = {
  buildFoliaStage,
  buildFoliaStageEnvironment,
  resolvePlatformCommand,
  resolveFoliaBuildPaths,
  syncFoliaDist,
};
