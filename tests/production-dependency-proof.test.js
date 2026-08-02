'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const sourceIdentity = require('../build/source-identity.js');

function integrity(value) {
  return `sha512-${crypto.createHash('sha512').update(value).digest('base64')}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writePackage(appDir, packagePath, name, version) {
  const packageDir = path.join(appDir, ...packagePath.split('/'));
  writeJson(path.join(packageDir, 'package.json'), { name, version });
  fs.writeFileSync(path.join(packageDir, 'index.js'), `module.exports = '${name}@${version}';\n`);
}

function makeDependencyFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-dependency-proof-'));
  const appDir = path.join(rootDir, 'app');
  const lockPath = path.join(rootDir, 'package-lock.json');
  const lock = {
    name: 'fixture-app',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'fixture-app',
        version: '1.0.0',
        dependencies: {
          alpha: '1.0.0',
          beta: '2.0.0',
        },
      },
      'node_modules/alpha': {
        version: '1.0.0',
        integrity: integrity('alpha-1.0.0'),
      },
      'node_modules/beta': {
        version: '2.0.0',
        integrity: integrity('beta-2.0.0'),
      },
      'node_modules/dev-only': {
        version: '9.0.0',
        integrity: integrity('dev-only-9.0.0'),
        dev: true,
      },
    },
  };

  writeJson(lockPath, lock);
  writePackage(appDir, 'node_modules/alpha', 'alpha', '1.0.0');
  writePackage(appDir, 'node_modules/beta', 'beta', '2.0.0');
  return { appDir, lock, lockPath };
}

function createProof(fixture) {
  assert.equal(typeof sourceIdentity.createProductionDependencyProof, 'function');
  return sourceIdentity.createProductionDependencyProof({
    appDir: fixture.appDir,
    packageLockPath: fixture.lockPath,
  });
}

test('matching packaged production dependencies produce a content-bound proof', () => {
  const fixture = makeDependencyFixture();
  const proof = createProof(fixture);

  assert.equal(proof.schemaVersion, 1);
  assert.match(proof.packageLockSha256, /^[A-F0-9]{64}$/);
  assert.match(proof.nodeModulesSha256, /^[A-F0-9]{64}$/);
  assert.deepEqual(
    proof.packages.map((entry) => ({
      path: entry.path,
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      hasDirectorySha256: /^[A-F0-9]{64}$/.test(entry.directorySha256),
    })),
    [
      {
        path: 'node_modules/alpha',
        name: 'alpha',
        version: '1.0.0',
        integrity: fixture.lock.packages['node_modules/alpha'].integrity,
        hasDirectorySha256: true,
      },
      {
        path: 'node_modules/beta',
        name: 'beta',
        version: '2.0.0',
        integrity: fixture.lock.packages['node_modules/beta'].integrity,
        hasDirectorySha256: true,
      },
    ],
  );
});

test('matching packaged production dependencies ignore npm hidden lock metadata', () => {
  const fixture = makeDependencyFixture();
  writeJson(path.join(fixture.appDir, 'node_modules', '.package-lock.json'), {
    lockfileVersion: 3,
    packages: {},
  });

  assert.doesNotThrow(() => createProof(fixture));
});

test('packaged production dependency proof rejects a missing package', () => {
  const fixture = makeDependencyFixture();
  fs.rmSync(path.join(fixture.appDir, 'node_modules', 'beta'), { recursive: true });

  assert.throws(() => createProof(fixture), /missing|beta|production dependency/i);
});

test('packaged production dependency proof rejects an extra package', () => {
  const fixture = makeDependencyFixture();
  writePackage(fixture.appDir, 'node_modules/rogue', 'rogue', '6.6.6');

  assert.throws(() => createProof(fixture), /extra|rogue|package-lock|production dependency/i);
});

test('packaged production dependency proof rejects a version mismatch', () => {
  const fixture = makeDependencyFixture();
  writePackage(fixture.appDir, 'node_modules/alpha', 'alpha', '1.0.1');

  assert.throws(() => createProof(fixture), /version|alpha|mismatch/i);
});

test('packaged production dependency proof rejects lock entries without integrity', () => {
  const fixture = makeDependencyFixture();
  delete fixture.lock.packages['node_modules/alpha'].integrity;
  writeJson(fixture.lockPath, fixture.lock);

  assert.throws(() => createProof(fixture), /integrity|alpha|package-lock/i);
});
