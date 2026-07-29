'use strict';

const { types: utilTypes } = require('node:util');

const FEATURE_FLAG_KEYS = Object.freeze([
  'platformWrites',
  'spotifyPkce',
  'enhancedPlayback',
  'listenReporting',
  'cuefield',
  'sonicTopography',
  'desktopWallpaper',
  'resourceGovernor',
]);

const DEFAULT_FEATURE_FLAG_VALUES = Object.freeze({
  platformWrites: true,
  spotifyPkce: false,
  enhancedPlayback: false,
  listenReporting: false,
  cuefield: false,
  sonicTopography: false,
  desktopWallpaper: false,
  resourceGovernor: false,
});

const featureFlagIdentities = new WeakSet();

function isPlainConfiguration(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readOverrides(overrides) {
  if (overrides === undefined) return {};
  if (!isPlainConfiguration(overrides)) {
    throw new TypeError('Feature flags must be configured with a plain object');
  }

  const values = {};
  for (const key of Reflect.ownKeys(overrides)) {
    if (typeof key !== 'string' || !FEATURE_FLAG_KEYS.includes(key)) {
      throw new RangeError(`Unknown feature flag: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(overrides, key);
    if (
      !descriptor
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || descriptor.enumerable !== true
    ) {
      throw new TypeError(`Feature flag ${key} must be an enumerable data property`);
    }
    if (typeof descriptor.value !== 'boolean') {
      throw new TypeError(`Feature flag ${key} must be boolean`);
    }
    values[key] = descriptor.value;
  }
  return values;
}

function createFeatureFlags(overrides) {
  const values = Object.freeze({
    ...DEFAULT_FEATURE_FLAG_VALUES,
    ...readOverrides(overrides),
  });
  let flags;

  flags = Object.freeze({
    isEnabled(name) {
      if (this !== flags) {
        throw new TypeError('Feature flag method called with invalid receiver');
      }
      return FEATURE_FLAG_KEYS.includes(name) && values[name] === true;
    },

    snapshot() {
      if (this !== flags) {
        throw new TypeError('Feature flag method called with invalid receiver');
      }
      return Object.freeze({ ...values });
    },
  });

  featureFlagIdentities.add(flags);
  return flags;
}

function isFeatureFlags(value) {
  return (
    (typeof value === 'object' || typeof value === 'function')
    && value !== null
    && featureFlagIdentities.has(value)
  );
}

module.exports = {
  DEFAULT_FEATURE_FLAG_VALUES,
  FEATURE_FLAG_KEYS,
  createFeatureFlags,
  isFeatureFlags,
};
