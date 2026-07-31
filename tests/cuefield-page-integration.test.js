'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(repoRoot, 'public', 'cuefield-runtime.js'), 'utf8');
const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const notice = fs.readFileSync(path.join(repoRoot, 'NOTICE.md'), 'utf8');
const vendorManifest = fs.readFileSync(path.join(repoRoot, 'docs', 'VENDOR_MANIFEST.md'), 'utf8');

test('loads the single Cuefield runtime and exposes the four settings levels', () => {
  assert.match(html, /<script src="cuefield-runtime\.js"><\/script>/);
  assert.match(html, /cuefieldAutoMixIntensity:\s*'off'/);
  for (const value of ['off', 'subtle', 'balanced', 'club']) {
    assert.match(html, new RegExp(`data-cuefield-intensity="${value}"`));
  }
  assert.match(html, /function setCuefieldAutoMixIntensity\(/);
  assert.match(html, /function updateCuefieldAutoMixControls\(/);
});

test('uses Task 7 shared preload ownership and transactional handoff', () => {
  assert.match(html, /function prepareSharedNextTrackPlayback\(/);
  assert.match(html, /owner:\s*'cuefield'/);
  assert.match(html, /cuefieldAutoMixHandoff:\s*true/);
  assert.match(html, /gaplessHandoff:\s*true/);
  assert.match(html, /crossfadeMs:\s*plan\.crossfadeMs/);
  assert.match(html, /claimSharedNextTrackPlayback\(/);
  assert.match(html, /tickCuefieldAutoMix\(now\);[\s\S]{0,180}shouldSkipAdaptiveRenderFrame\(now\)/);
  assert.match(html, /function cuefieldContextMatchesPlayback\(/);
  assert.match(html, /payload\.allowContextChange\s*===\s*true/);
  assert.match(html, /onCancel:\s*function\(reason\)[\s\S]{0,180}cancelNextTrackPreload\(reason/);
});

test('Cuefield owns no browser audio constructor, decoder, worker, or frame loop', () => {
  assert.doesNotMatch(runtime, /\bnew\s+Audio\b/);
  assert.doesNotMatch(runtime, /\b(?:AudioContext|OfflineAudioContext|webkitAudioContext)\b/);
  assert.doesNotMatch(runtime, /\bnew\s+Worker\b/);
  assert.doesNotMatch(runtime, /requestAnimationFrame|setInterval/);
  assert.doesNotMatch(html, /\/api\/cuefield/);
});

test('cancels on every playback lifecycle boundary and keeps ordinary fallback singular', () => {
  for (const reason of [
    'manual-skip',
    'seek',
    'pause',
    'source-failure',
    'track-replacement',
    'background-release',
    'feature-disabled',
  ]) {
    assert.match(html, new RegExp(`cancelCuefieldAutoMix\\('${reason}'`));
  }
  assert.match(html, /cuefieldAutoMixFallbackUsed/);
});

test('migrates user archives to schema 3 with old archives defaulting to off', () => {
  assert.match(html, /USER_FX_ARCHIVE_SCHEMA = 3/);
  assert.match(html, /cuefieldAutoMixIntensity:\s*normalizeCuefieldAutoMixIntensity\(/);
  assert.match(html, /Object\.prototype\.hasOwnProperty\.call\(raw, 'cuefieldAutoMixIntensity'\)/);
});

test('Cuefield runtime and controls honor the central feature snapshot', () => {
  assert.match(html, /cuefieldFeatureEnabled\s*=\s*false/);
  assert.match(html, /snapshot\.features\.cuefield\s*===\s*true/);
  assert.match(html, /if \(!cuefieldFeatureEnabled\) return/);
  assert.match(html, /aria-disabled/);
  assert.match(server, /cuefield:\s*true/);
});

test('syntax checks and attribution cover every adapted Cuefield file', () => {
  const check = packageJson.scripts.check;
  for (const file of [
    'cuefield/core.js',
    'cuefield/analysis-adapter.js',
    'cuefield/transition-planner.js',
    'cuefield/timeline-executor.js',
    'public/cuefield-runtime.js',
  ]) {
    assert.ok(check.includes(`node --check ${file}`), `missing syntax check for ${file}`);
  }
  assert.match(notice, /cuefield\/adapter-mineradio\.js/);
  assert.match(notice, /4abaa190de42c632365ae4244e041bad16443224/);
  assert.match(vendorManifest, /16-cuefield-automix-core\.js/);
  assert.match(vendorManifest, /17-cuefield-timeline-executor\.js/);
  assert.match(vendorManifest, /GPL-3\.0-only/);
});
