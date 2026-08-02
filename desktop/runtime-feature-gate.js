'use strict';

const {
  isFeatureFlags,
} = require('../server/platform/feature-flags');

function createDesktopWallpaperFeatureGate(featureFlags) {
  if (!isFeatureFlags(featureFlags)) {
    throw new TypeError('Desktop runtime feature gate requires trusted feature flags');
  }

  let gate;
  gate = Object.freeze({
    isEnabled() {
      if (this !== gate) throw new TypeError('Feature gate method called with invalid receiver');
      return featureFlags.isEnabled('desktopWallpaper');
    },

    run(operation, disabledValue) {
      if (this !== gate) throw new TypeError('Feature gate method called with invalid receiver');
      if (typeof operation !== 'function') throw new TypeError('Feature gate operation must be a function');
      if (!featureFlags.isEnabled('desktopWallpaper')) return disabledValue;
      return operation();
    },

    register(registerOperation) {
      if (this !== gate) throw new TypeError('Feature gate method called with invalid receiver');
      if (typeof registerOperation !== 'function') {
        throw new TypeError('Feature gate registration must be a function');
      }
      if (!featureFlags.isEnabled('desktopWallpaper')) return false;
      registerOperation();
      return true;
    },
  });

  return gate;
}

module.exports = {
  createDesktopWallpaperFeatureGate,
};
