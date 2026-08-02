'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { defineConfig, chromium } = require('./third_party/folia-major/node_modules/@playwright/test');

function resolveCachedChromium() {
  const preferred = chromium.executablePath();
  if (fs.existsSync(preferred)) return preferred;
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!cacheRoot || !fs.existsSync(cacheRoot)) return undefined;
  const candidates = fs.readdirSync(cacheRoot)
    .filter(name => /^chromium_headless_shell-\d+$/.test(name))
    .sort((left, right) => Number(right.split('-').at(-1)) - Number(left.split('-').at(-1)))
    .map(name => path.join(cacheRoot, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
  return candidates.find(candidate => fs.existsSync(candidate));
}

const executablePath = resolveCachedChromium();
const runtimeRoot = path.join(__dirname, 'output', 'folia-native-playwright-runtime');

module.exports = defineConfig({
  testDir: './tests/visual',
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: 'output/folia-native-playwright',
  use: {
    baseURL: 'http://127.0.0.1:3177',
    headless: true,
    viewport: null,
    launchOptions: Object.assign({ args: ['--js-flags=--expose-gc'] }, executablePath ? { executablePath } : {}),
  },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:3177',
    reuseExistingServer: true,
    timeout: 120000,
    env: Object.assign({}, process.env, {
      PORT: '3177',
      HOST: '127.0.0.1',
      MINERADIO_LISTEN_SYNC_FILE: path.join(runtimeRoot, 'listen-sync-journal.json'),
      MINERADIO_LISTEN_BINDING_SECRET_FILE: path.join(runtimeRoot, 'listen-sync.binding-secret'),
      MINERADIO_UPDATE_DIR: path.join(runtimeRoot, 'updates'),
      MINERADIO_BEAT_CACHE_DIR: path.join(runtimeRoot, 'beatmap'),
    }),
  },
});
