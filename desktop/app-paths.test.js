'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  APP_OWNED_DATA_FILES,
  MAX_OWNED_DATA_FILE_SIZE,
  configureStableAppPaths,
  copyFileAtomic,
  migrateOwnedDataFiles,
  resolveOwnedDataFile,
} = require('./app-paths');

const REQUIRED_OWNED_FILES = [
  '.cookie',
  '.qq-cookie',
  '.kugou-cookie',
  '.qishui-cookie',
  '.qishui-token',
  '.spotify-token.json',
  'platform-credentials.bin',
  'platform-cache.json',
  'listen-sync-journal.json',
  'desktop-shell-settings.json',
  'desktop-ui-state.json',
];

function makeTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-app-paths-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fakeStat({ isFile = true, size = 1, mtimeMs = 1 } = {}) {
  return {
    isFile,
    size,
    mtimeMs,
  };
}

test('owned data whitelist contains only explicit flat file names', () => {
  for (const fileName of REQUIRED_OWNED_FILES) {
    assert.equal(APP_OWNED_DATA_FILES.includes(fileName), true, fileName);
  }
  assert.equal(APP_OWNED_DATA_FILES.includes('unknown.txt'), false);
  assert.equal(APP_OWNED_DATA_FILES.every(fileName => path.basename(fileName) === fileName), true);
  assert.equal(Object.isFrozen(APP_OWNED_DATA_FILES), true);
});

test('configures the stable Mineradio root before resolving persistent paths', () => {
  const calls = [];
  const appData = path.join('C:', 'Users', 'Tomato', 'AppData', 'Roaming');
  const fakeApp = {
    setName(name) {
      calls.push(['setName', name]);
    },
    getPath(name) {
      calls.push(['getPath', name]);
      if (name !== 'appData') throw new Error(`unexpected path read: ${name}`);
      return appData;
    },
    setPath(name, value) {
      calls.push(['setPath', name, value]);
    },
  };

  const result = configureStableAppPaths(fakeApp, {
    createDirectory(directory) {
      calls.push(['createDirectory', directory]);
    },
  });

  const userData = path.join(appData, 'Mineradio');
  assert.deepEqual(calls, [
    ['setName', 'Mineradio'],
    ['getPath', 'appData'],
    ['createDirectory', userData],
    ['setPath', 'userData', userData],
  ]);
  assert.deepEqual(result, {
    userData,
    credentials: path.join(userData, 'platform-credentials.bin'),
    platformCache: path.join(userData, 'platform-cache.json'),
    listenJournal: path.join(userData, 'listen-sync-journal.json'),
  });
});

test('migration copies approved files without enumerating unknown files', (t) => {
  const root = makeTempDirectory(t);
  const sourceRoot = path.join(root, 'legacy');
  const targetRoot = path.join(root, 'stable');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(sourceRoot, '.cookie'), 'owned');
  fs.writeFileSync(path.join(sourceRoot, 'unknown.txt'), 'leave me');

  const copied = migrateOwnedDataFiles({ sourceRoots: [sourceRoot], targetRoot });

  assert.deepEqual(copied, ['.cookie']);
  assert.equal(fs.readFileSync(path.join(targetRoot, '.cookie'), 'utf8'), 'owned');
  assert.equal(fs.existsSync(path.join(targetRoot, 'unknown.txt')), false);
  assert.equal(fs.readFileSync(path.join(sourceRoot, 'unknown.txt'), 'utf8'), 'leave me');
});

test('migration keeps a newer valid target', () => {
  const copied = [];
  migrateOwnedDataFiles({
    sourceRoots: ['legacy'],
    targetRoot: 'stable',
    statFile(file) {
      if (file === path.resolve('stable', '.cookie')) {
        return fakeStat({ size: 6, mtimeMs: 20 });
      }
      if (file === path.resolve('legacy', '.cookie')) {
        return fakeStat({ size: 6, mtimeMs: 10 });
      }
      return null;
    },
    validateFile: () => true,
    copyFileAtomic(source, target) {
      copied.push([source, target]);
    },
  });

  assert.deepEqual(copied, []);
});

test('migration copies the newest valid source through the injected atomic copier', () => {
  const copied = [];
  const sourceRoots = ['older-legacy', 'newer-legacy'];
  const sourceMtimes = new Map([
    [path.resolve(sourceRoots[0], '.qq-cookie'), 20],
    [path.resolve(sourceRoots[1], '.qq-cookie'), 30],
  ]);

  const migrated = migrateOwnedDataFiles({
    sourceRoots,
    targetRoot: 'stable',
    statFile(file) {
      if (file === path.resolve('stable', '.qq-cookie')) {
        return fakeStat({ size: 6, mtimeMs: 10 });
      }
      const mtimeMs = sourceMtimes.get(file);
      return mtimeMs == null ? null : fakeStat({ size: 6, mtimeMs });
    },
    validateFile: () => true,
    copyFileAtomic(source, target) {
      copied.push([source, target]);
    },
  });

  assert.deepEqual(migrated, ['.qq-cookie']);
  assert.deepEqual(copied, [[
    path.resolve(sourceRoots[1], '.qq-cookie'),
    path.resolve('stable', '.qq-cookie'),
  ]]);
});

test('migration ignores directories, empty, oversized, and invalid files', () => {
  const sourceRoot = path.resolve('legacy');
  const rejected = new Map([
    [path.resolve(sourceRoot, '.cookie'), fakeStat({ isFile: false, size: 5 })],
    [path.resolve(sourceRoot, '.qq-cookie'), fakeStat({ size: 0 })],
    [path.resolve(sourceRoot, '.kugou-cookie'), fakeStat({
      size: MAX_OWNED_DATA_FILE_SIZE + 1,
    })],
    [path.resolve(sourceRoot, '.qishui-cookie'), fakeStat({ size: 5 })],
  ]);
  const copied = [];

  const migrated = migrateOwnedDataFiles({
    sourceRoots: [sourceRoot],
    targetRoot: 'stable',
    statFile(file) {
      return rejected.get(file) || null;
    },
    validateFile(fileName) {
      return fileName !== '.qishui-cookie';
    },
    copyFileAtomic(source, target) {
      copied.push([source, target]);
    },
  });

  assert.deepEqual(migrated, []);
  assert.deepEqual(copied, []);
});

test('migration ignores a source root that resolves to the target root', () => {
  const root = path.resolve('same-root');
  const statCalls = [];
  const copied = [];

  migrateOwnedDataFiles({
    sourceRoots: [root, path.join(root, '.')],
    targetRoot: root,
    statFile(file) {
      statCalls.push(file);
      return null;
    },
    validateFile: () => true,
    copyFileAtomic(source, target) {
      copied.push([source, target]);
    },
  });

  assert.equal(statCalls.length, APP_OWNED_DATA_FILES.length);
  assert.deepEqual(copied, []);
});

test('owned file resolution requires the final parent to be the resolved root', (t) => {
  const root = makeTempDirectory(t);

  assert.equal(
    resolveOwnedDataFile(root, '.cookie'),
    path.resolve(root, '.cookie'),
  );
  assert.throws(
    () => resolveOwnedDataFile(root, path.join('nested', '.cookie')),
    /direct child/i,
  );
  assert.throws(
    () => resolveOwnedDataFile(root, path.join('..', '.cookie')),
    /direct child/i,
  );
});

test('atomic copy uses a same-directory temporary file, fsync, size check, and rename', (t) => {
  const root = makeTempDirectory(t);
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.writeFileSync(source, 'new contents');
  fs.writeFileSync(target, 'old contents');
  let temporaryFile = '';
  let fsyncCount = 0;
  let renameCount = 0;
  const fileSystem = Object.create(fs);
  fileSystem.copyFileSync = (from, to, flags) => {
    temporaryFile = to;
    fs.copyFileSync(from, to, flags);
  };
  fileSystem.fsyncSync = (descriptor) => {
    fsyncCount += 1;
    fs.fsyncSync(descriptor);
  };
  fileSystem.renameSync = (from, to) => {
    renameCount += 1;
    fs.renameSync(from, to);
  };

  copyFileAtomic(source, target, { fileSystem });

  assert.equal(path.dirname(temporaryFile), path.dirname(target));
  assert.equal(fsyncCount, 1);
  assert.equal(renameCount, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'new contents');
  assert.equal(fs.existsSync(temporaryFile), false);
});

test('atomic copy failure removes its temporary file without changing the target', (t) => {
  const root = makeTempDirectory(t);
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.writeFileSync(source, 'replacement');
  fs.writeFileSync(target, 'preserve me');
  let temporaryFile = '';
  const fileSystem = Object.create(fs);
  fileSystem.copyFileSync = (from, to, flags) => {
    temporaryFile = to;
    fs.copyFileSync(from, to, flags);
  };
  fileSystem.renameSync = () => {
    throw new Error('injected rename failure');
  };

  assert.throws(
    () => copyFileAtomic(source, target, { fileSystem }),
    /injected rename failure/,
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserve me');
  assert.equal(temporaryFile.length > 0, true);
  assert.equal(fs.existsSync(temporaryFile), false);
});

test('atomic copy rejects a copied size mismatch before replacing the target', (t) => {
  const root = makeTempDirectory(t);
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.writeFileSync(source, 'replacement');
  fs.writeFileSync(target, 'preserve me');
  let temporaryFile = '';
  let renameCount = 0;
  const fileSystem = Object.create(fs);
  fileSystem.copyFileSync = (from, to, flags) => {
    temporaryFile = to;
    fs.copyFileSync(from, to, flags);
  };
  fileSystem.statSync = (file) => {
    const stats = fs.statSync(file);
    if (file === temporaryFile) {
      return { ...stats, size: stats.size + 1 };
    }
    return stats;
  };
  fileSystem.renameSync = () => {
    renameCount += 1;
  };

  assert.throws(
    () => copyFileAtomic(source, target, { fileSystem }),
    /size mismatch/i,
  );
  assert.equal(renameCount, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserve me');
  assert.equal(fs.existsSync(temporaryFile), false);
});

test('desktop startup wires stable paths before persistent consumers', () => {
  const projectRoot = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(projectRoot, 'desktop', 'main.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const configureAt = main.indexOf('const APP_PATHS = configureStableAppPaths(app);');
  const migrateAt = main.indexOf('migrateOwnedDataFiles({');
  const sessionAt = main.indexOf('session.fromPartition(');

  assert.match(main, /require\('\.\/app-paths'\)/);
  assert.notEqual(configureAt, -1);
  assert.notEqual(migrateAt, -1);
  assert.notEqual(sessionAt, -1);
  assert.equal(configureAt < migrateAt, true);
  assert.equal(migrateAt < sessionAt, true);
  assert.doesNotMatch(main, /app\.getPath\('userData'\)/);
  assert.match(main, /path\.resolve\(__dirname, '\.\.'\)/);
  assert.match(main, /path\.join\(path\.dirname\(APP_PATHS\.userData\), 'mineradio'\)/);
  assert.doesNotMatch(main, /legacyQQCookie/);
  assert.doesNotMatch(main, /unlinkSync\([^)]*cookie/i);

  assert.match(main, /function configureLocalServerEnvironment\(port\)/);
  assert.match(main, /process\.env\.COOKIE_FILE = path\.join\(APP_PATHS\.userData, '\.cookie'\)/);
  assert.match(main, /process\.env\.QQ_COOKIE_FILE = path\.join\(APP_PATHS\.userData, '\.qq-cookie'\)/);
  assert.match(main, /process\.env\.MINERADIO_PLATFORM_CACHE_FILE = APP_PATHS\.platformCache/);
  assert.match(main, /process\.env\.MINERADIO_LISTEN_SYNC_FILE = APP_PATHS\.listenJournal/);
  assert.match(packageJson.scripts.check, /node --check desktop\/app-paths\.js/);
});
