'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const config = require('../playwright.folia.config');

test('visual test server keeps writable runtime state outside source data', () => {
  const env = config.webServer && config.webServer.env;
  assert.ok(env, 'Playwright web server environment is required');

  const outputRoot = path.resolve(__dirname, '..', 'output');
  const writablePaths = [
    'MINERADIO_LISTEN_SYNC_FILE',
    'MINERADIO_LISTEN_BINDING_SECRET_FILE',
    'MINERADIO_UPDATE_DIR',
    'MINERADIO_BEAT_CACHE_DIR',
  ];

  for (const name of writablePaths) {
    assert.ok(path.isAbsolute(env[name] || ''), `${name} must be absolute`);
    const relative = path.relative(outputRoot, env[name]);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${name} must stay under output`);
  }

  assert.notEqual(env.MINERADIO_LISTEN_SYNC_FILE, env.MINERADIO_LISTEN_BINDING_SECRET_FILE);
});
