const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  buildFoliaStageEnvironment,
  resolvePlatformCommand,
  resolveFoliaBuildPaths,
} = require('../build/folia-stage');

test('folia stage build paths stay inside the Mineradio workspace', () => {
  const root = path.resolve('C:/work/mineradio');
  const paths = resolveFoliaBuildPaths(root);

  assert.equal(paths.projectRoot, root);
  assert.equal(paths.foliaRoot, path.join(root, 'third_party', 'folia-major'));
  assert.equal(paths.foliaDist, path.join(root, 'third_party', 'folia-major', 'dist'));
  assert.equal(paths.outputDir, path.join(root, 'public', 'folia-stage'));
});

test('folia stage build environment uses relative Electron assets', () => {
  const env = buildFoliaStageEnvironment({ PATH: 'test-path' });

  assert.equal(env.PATH, 'test-path');
  assert.equal(env.ELECTRON, 'true');
  assert.equal(env.APP_VERSION_LABEL, 'mineradio-folia-stage');
});

test('folia stage build resolves npm executable without shell wrapping', () => {
  assert.deepEqual(resolvePlatformCommand('npm', ['run', 'build'], 'win32'), {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', 'npm run build'],
  });
  assert.deepEqual(resolvePlatformCommand('npm', ['run', 'build'], 'linux'), {
    command: 'npm',
    args: ['run', 'build'],
  });
});
