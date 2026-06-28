const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('maintenance baseline scripts are wired', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};

  assert.equal(
    scripts.check,
    'node --check server.js && node --check desktop/main.js && node --check desktop/preload.js && node --check desktop/overlay-preload.js && node --check dj-analyzer.js && node --check public/api-client.js && node --check public/storage.js && node --check public/actions.js && node --check public/performance.js'
  );
  assert.equal(scripts['audit:prod'], 'npm audit --omit=dev');
  assert.equal(scripts.test, 'node --test tests/*.test.js');
  assert.equal(
    scripts['verify:release'],
    'npm run check && npm run test && npm run audit:prod && npm run build:win:dir'
  );
});

test('development context document exists', () => {
  const docPath = path.join(repoRoot, 'docs', 'DEVELOPMENT_CONTEXT.md');
  const content = fs.readFileSync(docPath, 'utf8');

  assert.match(content, /develop\/mineradio-maintenance/);
  assert.match(content, /C:\\Users\\TomatoK\\Documents\\Playground\\Mineradio/);
});
