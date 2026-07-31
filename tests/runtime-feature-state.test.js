'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const featureFlags = require('../server/platform/feature-flags');

const modulePath = path.join(
  __dirname,
  '..',
  'public',
  'runtime-feature-state.js',
);
const runtimeFeatures = fs.existsSync(modulePath) ? require(modulePath) : null;

test('browser runtime features fail closed until an explicit snapshot enables them', () => {
  assert.ok(runtimeFeatures);
  const state = runtimeFeatures.createRuntimeFeatureState();

  for (const feature of runtimeFeatures.BROWSER_RUNTIME_FEATURES) {
    assert.equal(state.isEnabled(feature), false, feature);
  }

  assert.deepEqual(state.apply({
    features: {
      enhancedPlayback: true,
      sonicTopography: false,
      resourceGovernor: true,
    },
  }), {
    enhancedPlayback: true,
    sonicTopography: false,
    resourceGovernor: true,
  });
  assert.equal(state.isEnabled('enhancedPlayback'), true);
  assert.equal(state.isEnabled('sonicTopography'), false);
  assert.equal(state.isEnabled('resourceGovernor'), true);

  assert.deepEqual(state.apply(null), {
    enhancedPlayback: false,
    sonicTopography: false,
    resourceGovernor: false,
  });
});

test('release defaults keep the migrated browser runtimes enabled', () => {
  assert.equal(typeof featureFlags.createReleaseFeatureFlags, 'function');
  const snapshot = featureFlags.createReleaseFeatureFlags().snapshot();

  assert.equal(snapshot.enhancedPlayback, true);
  assert.equal(snapshot.sonicTopography, true);
  assert.equal(snapshot.resourceGovernor, true);
});
