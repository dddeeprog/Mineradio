const assert = require('node:assert/strict');
const test = require('node:test');

const {
  effectiveWeatherAmbientVolume,
  normalizeWeatherSoundSettings,
  weatherAmbientPatchForProfile,
} = require('../public/weather-lively-visuals');

test('keeps weather ambient sound disabled by default', () => {
  const settings = normalizeWeatherSoundSettings();

  assert.equal(settings.enabled, false);
  assert.equal(settings.followWeather, true);
  assert.equal(settings.duckWhenMusicPlays, true);
  assert.equal(settings.volume, 0.24);
});

test('ducks synthetic weather ambience while music is playing', () => {
  const settings = normalizeWeatherSoundSettings({ enabled: true, volume: 0.5, duckWhenMusicPlays: true });

  assert.equal(effectiveWeatherAmbientVolume(settings, { musicPlaying: false }), 0.5);
  assert.equal(effectiveWeatherAmbientVolume(settings, { musicPlaying: true }), 0.16);
});

test('maps visual profiles to self-generated ambient patches without external assets', () => {
  assert.deepEqual(weatherAmbientPatchForProfile({ kind: 'rain' }), { kind: 'rain', frequency: 420, noise: 0.72 });
  assert.deepEqual(weatherAmbientPatchForProfile({ kind: 'snow' }), { kind: 'snow', frequency: 260, noise: 0.18 });
  assert.deepEqual(weatherAmbientPatchForProfile({ kind: 'storm' }), { kind: 'storm', frequency: 110, noise: 0.86 });
  assert.deepEqual(weatherAmbientPatchForProfile({ kind: 'clear' }), { kind: 'clear', frequency: 520, noise: 0.08 });
});
