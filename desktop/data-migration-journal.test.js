'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DATA_MIGRATION_SCHEMA,
  MAX_MIGRATION_FILE_SIZE,
  createDataMigrationJournal,
  createDefaultMigrationManifest,
} = require('./data-migration-journal');

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'legacy');
  const stable = path.join(root, 'stable');
  const journalDirectory = path.join(stable, 'journal');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(journalDirectory, { recursive: true });
  const paths = {
    userData: stable,
    credentials: path.join(stable, 'credentials', 'platform-credentials.bin'),
    platformCache: path.join(stable, 'platform-cache', 'platform-cache.json'),
    listenJournal: path.join(journalDirectory, 'listen-sync-journal.json'),
  };
  fs.mkdirSync(path.dirname(paths.credentials), { recursive: true });
  fs.mkdirSync(path.dirname(paths.platformCache), { recursive: true });
  return {
    root,
    source,
    stable,
    paths,
    journalFile: path.join(journalDirectory, 'data-migration-v1.json'),
  };
}

function createJournal(fixture, options = {}) {
  return createDataMigrationJournal({
    filePath: fixture.journalFile,
    sourceRoots: options.sourceRoots || [fixture.source],
    manifest: options.manifest || createDefaultMigrationManifest(fixture.paths),
    fileSystem: options.fileSystem,
    now: options.now || (() => '2026-07-30T02:30:00.000Z'),
  });
}

function isPlatformCacheStagingPayload(file, fixture) {
  const retirement = path.dirname(file);
  return path.basename(file) === 'payload'
    && path.basename(retirement)
      === '.platform-cache.json.mineradio-migration.pending.deleting'
    && path.resolve(path.dirname(retirement))
      === path.resolve(path.dirname(fixture.paths.platformCache));
}

function createCredentialImportSink(importCredential) {
  let importer = importCredential;
  const verified = new Set();
  const options = {
    async verifyCredentialImport(provider, migrationId) {
      return verified.has(`${provider}:${migrationId}`);
    },
    async importCredential(provider, credential, metadata) {
      const result = await importer(provider, credential, metadata);
      if (result && result.persisted === true && result.verified === true) {
        verified.add(`${provider}:${metadata.migrationId}`);
      }
      return result;
    },
  };
  return {
    options,
    setImporter(nextImporter) {
      importer = nextImporter;
    },
  };
}
test('default manifest is fixed and treats legacy cookies as import-only', (t) => {
  const fixture = makeFixture(t);
  const manifest = createDefaultMigrationManifest(fixture.paths);

  assert.deepEqual(manifest.map(entry => entry.id), [
    'encrypted-credentials',
    'platform-cache',
    'listen-sync-journal',
    'desktop-shell-settings',
    'desktop-ui-state',
    'netease-cookie',
    'qq-cookie',
  ]);
  for (const entry of manifest) assert.equal(Object.isFrozen(entry), true);
  for (const entry of manifest.filter(item => item.kind === 'credential-import')) {
    assert.equal(Object.hasOwn(entry, 'targetPath'), false);
    assert.equal(['.cookie', '.qq-cookie'].includes(entry.sourceName), true);
  }
  assert.equal(
    manifest.some(entry => entry.kind === 'file'
      && ['.cookie', '.qq-cookie'].includes(entry.sourceName)),
    false,
  );
});

test('copies only fixed file entries without enumerating or moving unknown files', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), '{"ok":true}');
  fs.writeFileSync(path.join(fixture.source, 'unknown.txt'), 'preserve');
  const fileSystem = Object.create(fs);
  fileSystem.readdirSync = () => { throw new Error('directory enumeration is forbidden'); };

  const journal = createJournal(fixture, { fileSystem });
  await journal.resumeFiles();

  assert.equal(fs.readFileSync(fixture.paths.platformCache, 'utf8'), '{"ok":true}');
  assert.equal(fs.readFileSync(path.join(fixture.source, 'unknown.txt'), 'utf8'), 'preserve');
  assert.equal(fs.existsSync(path.join(fixture.stable, 'unknown.txt')), false);
  assert.equal(journal.status().complete, 1);
});

test('stable target wins and is never overwritten by legacy mtime', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'legacy');
  fs.writeFileSync(fixture.paths.platformCache, 'stable');
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(fixture.source, 'platform-cache.json'), future, future);

  await createJournal(fixture).resumeFiles();

  assert.equal(fs.readFileSync(fixture.paths.platformCache, 'utf8'), 'stable');
});

test('copy recovers when journal commit fails after the target rename', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), '{"cache":"value"}');
  let failJournalRename = true;
  const fileSystem = Object.create(fs);
  fileSystem.renameSync = (from, to) => {
    fs.renameSync(from, to);
    if (path.resolve(to) === path.resolve(fixture.journalFile) && failJournalRename) {
      failJournalRename = false;
      const error = new Error('simulated journal crash');
      error.code = 'EIO';
      throw error;
    }
  };

  await assert.rejects(createJournal(fixture, { fileSystem }).resumeFiles(), /journal/i);
  assert.equal(fs.readFileSync(fixture.paths.platformCache, 'utf8'), '{"cache":"value"}');

  const resumed = createJournal(fixture);
  await resumed.resumeFiles();
  assert.equal(resumed.status().complete, 1);
});

test('corrupt journal JSON, schema and states fail closed without leaking contents', (t) => {
  const fixture = makeFixture(t);
  const corruptValues = [
    '{"schema":',
    JSON.stringify({ schema: 'wrong', entries: {} }),
    JSON.stringify({
      schema: DATA_MIGRATION_SCHEMA,
      entries: { 'platform-cache': { status: 'invented', secret: 'token-secret' } },
    }),
  ];

  for (const value of corruptValues) {
    fs.writeFileSync(fixture.journalFile, value);
    assert.throws(() => createJournal(fixture), error => {
      assert.equal(error.code, 'DATA_MIGRATION_JOURNAL_CORRUPT');
      assert.equal(JSON.stringify(error).includes('token-secret'), false);
      assert.equal(error.message.includes(fixture.root), false);
      return true;
    });
  }
});

test('skips symlinks, directories, empty files and oversized files', async (t) => {
  const fixture = makeFixture(t);
  const sourceFile = path.join(fixture.source, 'platform-cache.json');
  fs.writeFileSync(sourceFile, 'not-followed');
  const fileSystem = Object.create(fs);
  fileSystem.lstatSync = (file) => {
    if (path.resolve(file) === path.resolve(sourceFile)) {
      return { isFile: () => true, isSymbolicLink: () => true, size: 12 };
    }
    return fs.lstatSync(file);
  };
  await createJournal(fixture, { fileSystem }).resumeFiles();
  assert.equal(fs.existsSync(fixture.paths.platformCache), false);

  fs.writeFileSync(sourceFile, '');
  await createJournal(fixture).resumeFiles();
  assert.equal(fs.existsSync(fixture.paths.platformCache), false);

  fs.truncateSync(sourceFile, MAX_MIGRATION_FILE_SIZE + 1);
  await createJournal(fixture).resumeFiles();
  assert.equal(fs.existsSync(fixture.paths.platformCache), false);

  fs.rmSync(sourceFile);
  fs.mkdirSync(sourceFile);
  await createJournal(fixture).resumeFiles();
  assert.equal(fs.existsSync(fixture.paths.platformCache), false);
});

test('verified encrypted credential import deletes plaintext after pending state is durable', async (t) => {
  const fixture = makeFixture(t);
  const sourceFile = path.join(fixture.source, '.cookie');
  fs.writeFileSync(sourceFile, 'MUSIC_U=credential-secret');
  const seen = [];
  const journal = createJournal(fixture);
  const sink = createCredentialImportSink(async (provider, credential) => {
    seen.push({ provider, credential });
    return { persisted: true, verified: true };
  });

  await journal.resumeCredentialImports(sink.options);

  assert.deepEqual(seen, [{
    provider: 'netease',
    credential: { cookie: 'MUSIC_U=credential-secret' },
  }]);
  assert.equal(fs.existsSync(sourceFile), false);
  assert.equal(journal.status().complete, 1);
  const serialized = fs.readFileSync(fixture.journalFile, 'utf8');
  assert.equal(serialized.includes('credential-secret'), false);
  assert.equal(serialized.includes(fixture.root), false);
});
test('memory-only and unverified imports retain plaintext for a secure retry', async (t) => {
  const fixture = makeFixture(t);
  const sourceFile = path.join(fixture.source, '.qq-cookie');
  fs.writeFileSync(sourceFile, 'uin=1; qm_keyst=credential-secret');
  const journal = createJournal(fixture);
  const sink = createCredentialImportSink(
    async () => ({ persisted: false, verified: true }),
  );

  await journal.resumeCredentialImports(sink.options);
  assert.equal(fs.existsSync(sourceFile), true);
  assert.equal(journal.status().pending, 1);

  sink.setImporter(async () => ({ persisted: true, verified: false }));
  await journal.resumeCredentialImports(sink.options);
  assert.equal(fs.existsSync(sourceFile), true);
  assert.equal(journal.status().pending, 1);
});
test('source removal failure resumes without importing twice', async (t) => {
  const fixture = makeFixture(t);
  const sourceFile = path.join(fixture.source, '.cookie');
  fs.writeFileSync(sourceFile, 'MUSIC_U=credential-secret');
  let imports = 0;
  let failRemoval = true;
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (path.dirname(file) === fixture.source
      && path.basename(file).includes('.mineradio-removal-')
      && failRemoval) {
      failRemoval = false;
      const error = new Error('locked source');
      error.code = 'EPERM';
      throw error;
    }
    return fs.unlinkSync(file);
  };
  const first = createJournal(fixture, { fileSystem });
  const sink = createCredentialImportSink(async () => {
    imports += 1;
    return { persisted: true, verified: true };
  });

  await first.resumeCredentialImports(sink.options);
  assert.equal(fs.existsSync(sourceFile), false);
  assert.equal(
    fs.readdirSync(fixture.source).some(name => name.includes('.mineradio-removal-')),
    true,
  );
  assert.equal(first.status().sourceRemovalPending, 1);

  const second = createJournal(fixture);
  await second.resumeCredentialImports(sink.options);
  assert.equal(imports, 1);
  assert.equal(fs.existsSync(sourceFile), false);
  assert.equal(second.status().complete, 1);
});
test('status and journal expose counts without paths or secrets', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'cache-secret');
  const journal = createJournal(fixture);
  await journal.resumeFiles();

  const status = journal.status();
  assert.deepEqual(Object.keys(status), [
    'schema',
    'total',
    'pending',
    'sourceRemovalPending',
    'complete',
    'degraded',
  ]);
  const serialized = JSON.stringify({
    status,
    journal: JSON.parse(fs.readFileSync(fixture.journalFile, 'utf8')),
  });
  for (const secret of ['cache-secret', fixture.root, fixture.source, fixture.stable]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test('invalid existing targets block migration without being overwritten', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'legacy');
  fs.mkdirSync(fixture.paths.platformCache);
  const journal = createJournal(fixture);

  await journal.resumeFiles();

  assert.equal(fs.lstatSync(fixture.paths.platformCache).isDirectory(), true);
  assert.equal(journal.status().complete, 0);
  assert.equal(journal.status().pending, 1);
});

test('copy and credential import failures redact source paths and secrets', async (t) => {
  const fixture = makeFixture(t);
  const cacheSource = path.join(fixture.source, 'platform-cache.json');
  fs.writeFileSync(cacheSource, 'cache-secret');
  const fileSystem = Object.create(fs);
  fileSystem.openSync = (file, ...args) => {
    if (path.resolve(file) === path.resolve(cacheSource)) {
      throw new Error(`read failed for ${file} cache-secret`);
    }
    return fs.openSync(file, ...args);
  };

  await assert.rejects(createJournal(fixture, { fileSystem }).resumeFiles(), error => {
    assert.equal(error.code, 'DATA_MIGRATION_COPY_FAILED');
    assert.equal(error.message.includes(fixture.root), false);
    assert.equal(error.message.includes('cache-secret'), false);
    return true;
  });

  fs.writeFileSync(path.join(fixture.source, '.cookie'), 'MUSIC_U=credential-secret');
  const sink = createCredentialImportSink(async () => {
    throw new Error(`provider failed ${fixture.root} credential-secret`);
  });
  await assert.rejects(
    createJournal(fixture).resumeCredentialImports(sink.options),
    error => {
      assert.equal(error.code, 'DATA_MIGRATION_CREDENTIAL_IMPORT_FAILED');
      assert.equal(error.message.includes(fixture.root), false);
      assert.equal(error.message.includes('credential-secret'), false);
      return true;
    },
  );
  assert.equal(fs.existsSync(path.join(fixture.source, '.cookie')), true);
});
test('fixed manifest identity and stable layout reject caller-defined copies', (t) => {
  const fixture = makeFixture(t);
  const manifest = createDefaultMigrationManifest(fixture.paths);
  const target = path.join(fixture.stable, 'unlisted-secret.txt');

  assert.throws(() => createJournal(fixture, {
    manifest: [...manifest, {
      id: 'unlisted-secret',
      kind: 'file',
      sourceName: 'unlisted-secret.txt',
      targetPath: target,
    }],
  }), /fixed allowlist/i);
  assert.throws(() => createJournal(fixture, { manifest: [...manifest] }), /fixed allowlist/i);
  assert.throws(() => createJournal(fixture, {
    sourceRoots: [fixture.source, path.join(fixture.source, '.')],
  }), /duplicate source root/i);
  assert.throws(() => createDefaultMigrationManifest({
    ...fixture.paths,
    platformCache: 'relative.json',
  }), /absolute/i);
  assert.throws(() => createDefaultMigrationManifest({
    ...fixture.paths,
    platformCache: path.join(fixture.root, 'outside', 'platform-cache.json'),
  }), /stable layout/i);
  assert.equal(fs.existsSync(target), false);
});

test('journal schema rejects unknown fields and credential-only states on files', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'cache');
  await createJournal(fixture).resumeFiles();
  const value = JSON.parse(fs.readFileSync(fixture.journalFile, 'utf8'));

  value.secret = 'token-secret';
  fs.writeFileSync(fixture.journalFile, JSON.stringify(value));
  assert.throws(() => createJournal(fixture), error => {
    assert.equal(error.code, 'DATA_MIGRATION_JOURNAL_CORRUPT');
    assert.equal(error.message.includes('token-secret'), false);
    return true;
  });

  delete value.secret;
  value.entries['platform-cache'].status = 'source-removal-pending';
  fs.writeFileSync(fixture.journalFile, JSON.stringify(value));
  assert.throws(() => createJournal(fixture), error => {
    assert.equal(error.code, 'DATA_MIGRATION_JOURNAL_CORRUPT');
    return true;
  });
});

test('concurrent stable target publication cannot be overwritten', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'legacy');
  let injected = false;
  const fileSystem = Object.create(fs);
  fileSystem.linkSync = (from, to) => {
    if (path.resolve(to) === path.resolve(fixture.paths.platformCache) && !injected) {
      injected = true;
      fs.writeFileSync(to, 'concurrent-stable');
    }
    return fs.linkSync(from, to);
  };

  await createJournal(fixture, { fileSystem }).resumeFiles();

  assert.equal(injected, true);
  assert.equal(fs.readFileSync(fixture.paths.platformCache, 'utf8'), 'concurrent-stable');
  assert.equal(createJournal(fixture).status().complete, 1);
});

test('credential removal remains bound to the source root that was imported', async (t) => {
  const fixture = makeFixture(t);
  const earlierRoot = path.join(fixture.root, 'legacy-earlier');
  fs.mkdirSync(earlierRoot);
  const importedSource = path.join(fixture.source, '.cookie');
  const newlyAppearedSource = path.join(earlierRoot, '.cookie');
  fs.writeFileSync(importedSource, 'MUSIC_U=imported-secret');
  let imports = 0;
  const journal = createJournal(fixture, {
    sourceRoots: [earlierRoot, fixture.source],
  });
  const sink = createCredentialImportSink(async () => {
    imports += 1;
    fs.writeFileSync(newlyAppearedSource, 'MUSIC_U=new-secret');
    return { persisted: true, verified: true };
  });

  await journal.resumeCredentialImports(sink.options);

  assert.equal(imports, 1);
  assert.equal(fs.existsSync(importedSource), false);
  assert.equal(fs.readFileSync(newlyAppearedSource, 'utf8'), 'MUSIC_U=new-secret');
  assert.equal(journal.status().complete, 0);
  assert.equal(journal.status().degraded, 1);
  assert.equal(journal.status().pending, 0);
});
test('credential reads are descriptor-bound and reject a post-check oversized file', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=small');
  let replaced = false;
  let imports = 0;
  const fileSystem = Object.create(fs);
  fileSystem.openSync = (file, ...args) => {
    if (path.resolve(file) === path.resolve(source) && !replaced) {
      replaced = true;
      fs.truncateSync(source, MAX_MIGRATION_FILE_SIZE + 1);
    }
    return fs.openSync(file, ...args);
  };
  const sink = createCredentialImportSink(async () => {
    imports += 1;
    return { persisted: true, verified: true };
  });

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeCredentialImports(sink.options),
    error => {
      assert.equal(error.code, 'DATA_MIGRATION_CREDENTIAL_SOURCE_INVALID');
      assert.equal(error.message.includes(fixture.root), false);
      return true;
    },
  );
  assert.equal(replaced, true);
  assert.equal(imports, 0);
  assert.equal(fs.existsSync(source), true);
});
test('credential replacement during import is retained and scheduled as new work', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=old-secret');
  const journal = createJournal(fixture);
  const sink = createCredentialImportSink(async () => {
    const replacement = path.join(fixture.source, '.cookie.replacement');
    fs.writeFileSync(replacement, 'MUSIC_U=new-secret');
    fs.rmSync(source);
    fs.renameSync(replacement, source);
    return { persisted: true, verified: true };
  });

  await journal.resumeCredentialImports(sink.options);

  assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=new-secret');
  assert.equal(journal.status().pending, 1);
  assert.equal(journal.status().sourceRemovalPending, 0);
  assert.equal(journal.status().complete, 0);

  const imported = [];
  sink.setImporter(async (_provider, credential) => {
    imported.push(credential.cookie);
    return { persisted: true, verified: true };
  });
  await journal.resumeCredentialImports(sink.options);
  assert.deepEqual(imported, ['MUSIC_U=new-secret']);
  assert.equal(fs.existsSync(source), false);
  assert.equal(journal.status().complete, 1);
});
test('credential deletion identity survives source root reordering', async (t) => {
  const fixture = makeFixture(t);
  const otherRoot = path.join(fixture.root, 'legacy-other');
  fs.mkdirSync(otherRoot);
  const importedSource = path.join(fixture.source, '.cookie');
  const unimportedSource = path.join(otherRoot, '.cookie');
  fs.writeFileSync(importedSource, 'MUSIC_U=imported-secret');
  fs.writeFileSync(unimportedSource, 'MUSIC_U=unimported-secret');
  const importedTime = new Date('2026-07-30T00:00:00.000Z');
  const unimportedTime = new Date('2026-07-29T00:00:00.000Z');
  fs.utimesSync(importedSource, importedTime, importedTime);
  fs.utimesSync(unimportedSource, unimportedTime, unimportedTime);
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (path.dirname(file) === fixture.source
      && path.basename(file).includes('.mineradio-removal-')) {
      const error = new Error('locked imported source');
      error.code = 'EPERM';
      throw error;
    }
    return fs.unlinkSync(file);
  };
  const first = createJournal(fixture, {
    sourceRoots: [fixture.source, otherRoot],
    fileSystem,
  });
  const sink = createCredentialImportSink(
    async () => ({ persisted: true, verified: true }),
  );

  await first.resumeCredentialImports(sink.options);
  assert.equal(first.status().sourceRemovalPending, 1);

  const second = createJournal(fixture, {
    sourceRoots: [otherRoot, fixture.source],
  });
  await second.resumeCredentialImports(sink.options);

  assert.equal(fs.existsSync(importedSource), false);
  assert.equal(fs.readFileSync(unimportedSource, 'utf8'), 'MUSIC_U=unimported-secret');
  assert.equal(second.status().pending, 0);
  assert.equal(second.status().sourceRemovalPending, 0);
  assert.equal(second.status().complete, 0);
  assert.equal(second.status().degraded, 1);
});
test('completed file state is repaired when the durable target disappears', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  fs.writeFileSync(source, '{"cache":"durable"}');
  await createJournal(fixture).resumeFiles();
  fs.rmSync(fixture.paths.platformCache);

  const resumed = createJournal(fixture);
  await resumed.resumeFiles();

  assert.equal(
    fs.readFileSync(fixture.paths.platformCache, 'utf8'),
    '{"cache":"durable"}',
  );
  assert.equal(resumed.status().complete, 1);
});

test('published target must retain the verified temporary file identity', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  const replacement = path.join(fixture.root, 'replacement-cache.json');
  fs.writeFileSync(source, 'verified-cache');
  fs.writeFileSync(replacement, 'swapped-cache');
  const fileSystem = Object.create(fs);
  fileSystem.linkSync = (_from, to) => fs.linkSync(replacement, to);

  await assert.rejects(createJournal(fixture, { fileSystem }).resumeFiles(), error => {
    assert.equal(error.code, 'DATA_MIGRATION_COPY_FAILED');
    return true;
  });
  assert.equal(fs.readFileSync(fixture.paths.platformCache, 'utf8'), 'swapped-cache');
  assert.equal(fs.readFileSync(source, 'utf8'), 'verified-cache');
});
test('credential atomic removal restores a replacement moved after identity binding', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  const replacement = path.join(fixture.source, '.cookie.concurrent');
  fs.writeFileSync(source, 'MUSIC_U=imported-secret');
  let injected = false;
  const fileSystem = Object.create(fs);
  fileSystem.linkSync = (from, to) => {
    if (path.resolve(from) === path.resolve(source)
      && path.basename(to).includes('.mineradio-removal-')
      && !injected) {
      injected = true;
      fs.writeFileSync(replacement, 'MUSIC_U=concurrent-secret');
      fs.rmSync(source);
      fs.renameSync(replacement, source);
    }
    return fs.linkSync(from, to);
  };
  const journal = createJournal(fixture, { fileSystem });
  const sink = createCredentialImportSink(
    async () => ({ persisted: true, verified: true }),
  );

  await journal.resumeCredentialImports(sink.options);

  assert.equal(injected, true);
  assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=concurrent-secret');
  assert.equal(journal.status().pending, 1);
  assert.equal(journal.status().sourceRemovalPending, 0);
  assert.equal(journal.status().complete, 0);
});
test('linked target and source root ancestors are rejected before migration', (t) => {
  const fixture = makeFixture(t);
  const targetParent = path.dirname(fixture.paths.platformCache);
  const targetFileSystem = Object.create(fs);
  targetFileSystem.lstatSync = (file) => {
    if (path.resolve(file) === path.resolve(targetParent)) {
      return {
        isDirectory: () => true,
        isSymbolicLink: () => true,
      };
    }
    return fs.lstatSync(file);
  };
  assert.throws(() => createJournal(fixture, {
    fileSystem: targetFileSystem,
  }), error => {
    assert.equal(error.code, 'DATA_MIGRATION_PATH_UNSAFE');
    assert.equal(error.message.includes(fixture.root), false);
    return true;
  });

  const sourceFileSystem = Object.create(fs);
  sourceFileSystem.lstatSync = (file) => {
    if (path.resolve(file) === path.resolve(fixture.source)) {
      return {
        isDirectory: () => true,
        isSymbolicLink: () => true,
      };
    }
    return fs.lstatSync(file);
  };
  assert.throws(() => createJournal(fixture, {
    fileSystem: sourceFileSystem,
  }), error => {
    assert.equal(error.code, 'DATA_MIGRATION_PATH_UNSAFE');
    return true;
  });
});

test('same-inode temporary content mutation after verification is rejected', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  fs.writeFileSync(source, 'verified-cache');
  const fileSystem = Object.create(fs);
  fileSystem.linkSync = (from, to) => {
    fs.writeFileSync(from, 'tampered-cache');
    return fs.linkSync(from, to);
  };
  const journal = createJournal(fixture, { fileSystem });

  await assert.rejects(journal.resumeFiles(), error => {
    assert.equal(error.code, 'DATA_MIGRATION_COPY_FAILED');
    return true;
  });
  assert.equal(fs.statSync(fixture.paths.platformCache).nlink, 2);
  assert.equal(journal.status().complete, 0);
  assert.equal(journal.status().pending, 1);
});
test('credential content replacement is detected even when inode size and mtime match', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=old-secret');
  const before = fs.statSync(source);
  const journal = createJournal(fixture);
  const sink = createCredentialImportSink(async () => {
    fs.writeFileSync(source, 'MUSIC_U=new-secret');
    fs.utimesSync(source, before.atime, before.mtime);
    return { persisted: true, verified: true };
  });

  await journal.resumeCredentialImports(sink.options);

  assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=new-secret');
  assert.equal(journal.status().pending, 1);
  assert.equal(journal.status().complete, 0);
});
test('directory links introduced by mkdir are rejected before any target write', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  const targetDirectory = path.dirname(fixture.paths.platformCache);
  fs.writeFileSync(source, 'cache');
  let linked = false;
  const fileSystem = Object.create(fs);
  fileSystem.mkdirSync = (directory, options) => {
    const result = fs.mkdirSync(directory, options);
    if (path.resolve(directory) === path.resolve(targetDirectory)) linked = true;
    return result;
  };
  fileSystem.lstatSync = (file) => {
    if (linked && path.resolve(file) === path.resolve(targetDirectory)) {
      return {
        isDirectory: () => true,
        isSymbolicLink: () => true,
      };
    }
    return fs.lstatSync(file);
  };
  const journal = createJournal(fixture, { fileSystem });

  await assert.rejects(journal.resumeFiles(), error => {
    assert.equal(error.code, 'DATA_MIGRATION_PATH_UNSAFE');
    return true;
  });
  assert.equal(linked, true);
  assert.equal(fs.existsSync(fixture.paths.platformCache), false);
});

test('migration journal rejects hard links and file symlinks', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'cache');
  await createJournal(fixture).resumeFiles();
  const alias = path.join(path.dirname(fixture.journalFile), 'journal-alias.json');
  fs.linkSync(fixture.journalFile, alias);

  assert.throws(() => createJournal(fixture), error => {
    assert.equal(error.code, 'DATA_MIGRATION_PATH_UNSAFE');
    return true;
  });
  fs.unlinkSync(alias);

  const fileSystem = Object.create(fs);
  fileSystem.lstatSync = (file) => {
    if (path.resolve(file) === path.resolve(fixture.journalFile)) {
      return {
        isFile: () => true,
        isSymbolicLink: () => true,
        size: 20,
        nlink: 1,
      };
    }
    return fs.lstatSync(file);
  };
  assert.throws(() => createJournal(fixture, { fileSystem }), error => {
    assert.equal(error.code, 'DATA_MIGRATION_PATH_UNSAFE');
    return true;
  });
});
test('imports only one deterministic legacy credential candidate per provider', async (t) => {
  const fixture = makeFixture(t);
  const otherRoot = path.join(fixture.root, 'legacy-newer');
  fs.mkdirSync(otherRoot);
  const older = path.join(fixture.source, '.cookie');
  const newer = path.join(otherRoot, '.cookie');
  fs.writeFileSync(older, 'MUSIC_U=older-secret');
  fs.writeFileSync(newer, 'MUSIC_U=newer-secret');
  const oldTime = new Date('2026-07-29T00:00:00.000Z');
  const newTime = new Date('2026-07-30T00:00:00.000Z');
  fs.utimesSync(older, oldTime, oldTime);
  fs.utimesSync(newer, newTime, newTime);
  const imports = [];
  const sink = createCredentialImportSink(async (_provider, credential) => {
    imports.push(credential.cookie);
    return { persisted: true, verified: true };
  });

  await createJournal(fixture, {
    sourceRoots: [fixture.source, otherRoot],
  }).resumeCredentialImports(sink.options);

  assert.deepEqual(imports, ['MUSIC_U=newer-secret']);
  assert.equal(fs.readFileSync(older, 'utf8'), 'MUSIC_U=older-secret');
  assert.equal(fs.existsSync(newer), false);
});
test('stable migration id prevents a duplicate import after journal commit failure', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, '.cookie'), 'MUSIC_U=credential-secret');
  const persisted = new Set();
  let importCalls = 0;
  const sink = {
    async verifyCredentialImport(provider, migrationId) {
      return persisted.has(`${provider}:${migrationId}`);
    },
    async importCredential(provider, _credential, metadata = {}) {
      importCalls += 1;
      assert.match(metadata.migrationId || '', /^[a-f0-9]{64}$/);
      persisted.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, verified: true };
    },
  };
  const fileSystem = Object.create(fs);
  fileSystem.renameSync = (from, to) => {
    if (path.resolve(to) === path.resolve(fixture.journalFile)) {
      const nextState = JSON.parse(fs.readFileSync(from, 'utf8'));
      if (Object.values(nextState.entries)
        .some(entry => entry.status === 'source-removal-pending')) {
        const error = new Error('simulated journal commit failure');
        error.code = 'EIO';
        throw error;
      }
    }
    return fs.renameSync(from, to);
  };

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeCredentialImports(sink),
    /journal/i,
  );
  assert.equal(importCalls, 1);

  await createJournal(fixture).resumeCredentialImports(sink);

  assert.equal(importCalls, 1);
  assert.equal(fs.existsSync(path.join(fixture.source, '.cookie')), false);
});

test('credential quarantine rename crash resumes removal without reimporting', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=credential-secret');
  const persisted = new Set();
  let importCalls = 0;
  const sink = {
    async verifyCredentialImport(provider, migrationId) {
      return persisted.has(`${provider}:${migrationId}`);
    },
    async importCredential(provider, _credential, metadata = {}) {
      importCalls += 1;
      persisted.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, verified: true };
    },
  };
  const fileSystem = Object.create(fs);
  let crashed = false;
  fileSystem.linkSync = (from, to) => {
    const result = fs.linkSync(from, to);
    if (!crashed
      && path.resolve(from) === path.resolve(source)
      && path.basename(to).includes('.mineradio-removal-')) {
      crashed = true;
      const error = new Error('simulated crash after quarantine link');
      error.code = 'EIO';
      throw error;
    }
    return result;
  };

  await createJournal(fixture, { fileSystem }).resumeCredentialImports(sink);
  assert.equal(crashed, true);
  assert.equal(importCalls, 1);

  const resumed = createJournal(fixture);
  await resumed.resumeCredentialImports(sink);

  assert.equal(importCalls, 1);
  assert.equal(fs.existsSync(source), false);
  assert.equal(resumed.status().complete, 1);
});

test('temporary hard-link cleanup is required before a target can complete', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'cache');
  let cleanupFailed = false;
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (!cleanupFailed && isPlatformCacheStagingPayload(file, fixture)) {
      cleanupFailed = true;
      const error = new Error('simulated temporary link lock');
      error.code = 'EPERM';
      throw error;
    }
    return fs.unlinkSync(file);
  };

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeFiles(),
    error => error.code === 'DATA_MIGRATION_COPY_FAILED',
  );
  assert.equal(cleanupFailed, true);
  assert.equal(fs.statSync(fixture.paths.platformCache).nlink, 2);

  const resumed = createJournal(fixture);
  await resumed.resumeFiles();
  assert.equal(fs.statSync(fixture.paths.platformCache).nlink, 1);
  assert.equal(resumed.status().complete, 1);
});

test('completed target loss remains visible when the legacy source is also gone', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  fs.writeFileSync(source, 'cache');
  const journal = createJournal(fixture);
  await journal.resumeFiles();
  fs.rmSync(fixture.paths.platformCache);
  fs.rmSync(source);

  assert.deepEqual(journal.status(), {
    schema: DATA_MIGRATION_SCHEMA,
    total: 1,
    pending: 0,
    sourceRemovalPending: 0,
    complete: 0,
    degraded: 1,
  });
});
test('deterministic staging recovers a crash between target link and staging cleanup', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  fs.writeFileSync(source, 'cache');
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (isPlatformCacheStagingPayload(file, fixture)) {
      const error = new Error('simulated process termination before staging cleanup');
      error.code = 'EPERM';
      throw error;
    }
    if (path.resolve(file) === path.resolve(fixture.paths.platformCache)) {
      const error = new Error('simulated process termination during rollback');
      error.code = 'EPERM';
      throw error;
    }
    return fs.unlinkSync(file);
  };

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeFiles(),
    error => error.code === 'DATA_MIGRATION_COPY_FAILED',
  );
  assert.equal(fs.statSync(fixture.paths.platformCache).nlink, 2);

  const resumed = createJournal(fixture);
  await resumed.resumeFiles();

  assert.equal(fs.statSync(fixture.paths.platformCache).nlink, 1);
  assert.equal(resumed.status().complete, 1);
});

test('failed staging cleanup never rolls back a target by path', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'cache');
  let targetUnlinkCalls = 0;
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (path.resolve(file) === path.resolve(fixture.paths.platformCache)) {
      targetUnlinkCalls += 1;
      const error = new Error('target path changed concurrently');
      error.code = 'EPERM';
      throw error;
    }
    if (isPlatformCacheStagingPayload(file, fixture)) {
      const error = new Error('staging cleanup failed');
      error.code = 'EPERM';
      throw error;
    }
    return fs.unlinkSync(file);
  };

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeFiles(),
    error => error.code === 'DATA_MIGRATION_COPY_FAILED',
  );

  assert.equal(targetUnlinkCalls, 0);
});

test('quarantine replacement during asynchronous verification is preserved', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=imported-secret');
  const persisted = new Set();
  let replaced = false;
  const sink = {
    async verifyCredentialImport(provider, migrationId) {
      const verified = persisted.has(`${provider}:${migrationId}`);
      const quarantine = fs.readdirSync(fixture.source)
        .find(name => name.includes('.mineradio-removal-'));
      if (verified && quarantine && !replaced) {
        replaced = true;
        const quarantinePath = path.join(fixture.source, quarantine);
        fs.rmSync(quarantinePath);
        fs.writeFileSync(quarantinePath, 'MUSIC_U=concurrent-secret');
        await Promise.resolve();
      }
      return verified;
    },
    async importCredential(provider, _credential, metadata) {
      persisted.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, verified: true };
    },
  };
  const journal = createJournal(fixture);

  await journal.resumeCredentialImports(sink);

  assert.equal(replaced, true);
  assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=concurrent-secret');
  assert.equal(journal.status().pending, 1);
  assert.equal(journal.status().complete, 0);
});

test('hard-linked legacy credentials are rejected and never reported complete', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  const alias = path.join(fixture.source, 'cookie-alias.txt');
  fs.writeFileSync(source, 'MUSIC_U=plaintext-secret');
  fs.linkSync(source, alias);
  let imports = 0;
  const sink = createCredentialImportSink(async () => {
    imports += 1;
    return { persisted: true, verified: true };
  });
  const journal = createJournal(fixture);

  await assert.rejects(journal.resumeCredentialImports(sink.options), error => {
    assert.equal(error.code, 'DATA_MIGRATION_CREDENTIAL_SOURCE_INVALID');
    assert.equal(error.message.includes(fixture.root), false);
    return true;
  });

  assert.equal(imports, 0);
  assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=plaintext-secret');
  assert.equal(fs.readFileSync(alias, 'utf8'), 'MUSIC_U=plaintext-secret');
  assert.equal(journal.status().pending, 1);
  assert.equal(journal.status().complete, 0);
});

test('concurrent resume calls serialize credential verification and import', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, '.cookie'), 'MUSIC_U=credential-secret');
  const persisted = new Set();
  let importCalls = 0;
  const sink = {
    async verifyCredentialImport(provider, migrationId) {
      return persisted.has(`${provider}:${migrationId}`);
    },
    async importCredential(provider, _credential, metadata) {
      importCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      persisted.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, verified: true };
    },
  };
  const journal = createJournal(fixture);

  await Promise.all([
    journal.resumeCredentialImports(sink),
    journal.resumeCredentialImports(sink),
  ]);

  assert.equal(importCalls, 1);
  assert.equal(journal.status().complete, 1);
});

test('a stale journal instance refreshes state before writing another migration', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, '.cookie'), 'MUSIC_U=credential-secret');
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'cache');
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (path.dirname(file) === fixture.source
      && path.basename(file).includes('.mineradio-removal-')) {
      const error = new Error('locked quarantine');
      error.code = 'EPERM';
      throw error;
    }
    return fs.unlinkSync(file);
  };
  const credentialJournal = createJournal(fixture, { fileSystem });
  const staleFileJournal = createJournal(fixture);
  let importCalls = 0;
  const sink = createCredentialImportSink(async () => {
    importCalls += 1;
    return { persisted: true, verified: true };
  });

  await credentialJournal.resumeCredentialImports(sink.options);
  assert.equal(credentialJournal.status().sourceRemovalPending, 1);
  await staleFileJournal.resumeFiles();

  const resumed = createJournal(fixture);
  await resumed.resumeCredentialImports(sink.options);

  assert.equal(importCalls, 1);
  assert.equal(
    fs.readdirSync(fixture.source).some(name => name.includes('.mineradio-removal-')),
    false,
  );
  assert.equal(resumed.status().complete, 2);
});
test('a compromised cross-process lock fences credential deletion', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=credential-secret');
  const persisted = new Set();
  let compromised = false;
  const sink = {
    async verifyCredentialImport(provider, migrationId) {
      const verified = persisted.has(`${provider}:${migrationId}`);
      if (verified && !compromised) {
        compromised = true;
        fs.rmSync(`${fixture.journalFile}.lock`, { recursive: true, force: true });
        await new Promise(resolve => setTimeout(resolve, 10_500));
      }
      return verified;
    },
    async importCredential(provider, _credential, metadata) {
      persisted.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, verified: true };
    },
  };
  const journal = createJournal(fixture);

  await assert.rejects(journal.resumeCredentialImports(sink), error => {
    assert.equal(error.code, 'DATA_MIGRATION_LOCK_FAILED');
    return true;
  });

  assert.equal(compromised, true);
  assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=credential-secret');
  assert.equal(journal.status().complete, 0);
});

test('tombstone rotation is no-replace when a concurrent destination appears', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=imported-secret');
  let injected = false;
  const fileSystem = Object.create(fs);
  fileSystem.linkSync = (from, to) => {
    if (!injected && String(to).endsWith('.pending.deleting')) {
      injected = true;
      fs.writeFileSync(to, 'MUSIC_U=concurrent-secret');
    }
    return fs.linkSync(from, to);
  };
  const sink = createCredentialImportSink(
    async () => ({ persisted: true, verified: true }),
  );
  const journal = createJournal(fixture, { fileSystem });

  await journal.resumeCredentialImports(sink.options);

  const removalFiles = fs.readdirSync(fixture.source)
    .filter(name => name.includes('.mineradio-removal-'));
  assert.equal(injected, true);
  assert.equal(removalFiles.length, 2);
  const concurrent = removalFiles.find(name => name.endsWith('.deleting'));
  assert.equal(
    fs.readFileSync(path.join(fixture.source, concurrent), 'utf8'),
    'MUSIC_U=concurrent-secret',
  );
  assert.equal(journal.status().sourceRemovalPending, 1);
  assert.equal(journal.status().complete, 0);
});

test('failed exclusive staging creation never cleans another writer staging file', async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(path.join(fixture.source, 'platform-cache.json'), 'legacy-cache');
  const staging = path.join(
    path.dirname(fixture.paths.platformCache),
    '.platform-cache.json.mineradio-migration.pending',
  );
  let injected = false;
  const fileSystem = Object.create(fs);
  fileSystem.openSync = (file, ...args) => {
    if (!injected && path.resolve(file) === path.resolve(staging)) {
      injected = true;
      fs.writeFileSync(staging, 'concurrent-cache');
    }
    return fs.openSync(file, ...args);
  };

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeFiles(),
    error => error.code === 'DATA_MIGRATION_COPY_FAILED',
  );

  assert.equal(injected, true);
  assert.equal(fs.readFileSync(staging, 'utf8'), 'concurrent-cache');
  assert.equal(fs.existsSync(fixture.paths.platformCache), false);
});
test('lock directory identity change fences immediately and preserves the new lock', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  const lockPath = `${fixture.journalFile}.lock`;
  fs.writeFileSync(source, 'MUSIC_U=credential-secret');
  const persisted = new Set();
  let replacementLockStats = null;
  const sink = {
    async verifyCredentialImport(provider, migrationId) {
      const verified = persisted.has(`${provider}:${migrationId}`);
      if (verified && !replacementLockStats) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        fs.mkdirSync(lockPath);
        replacementLockStats = fs.statSync(lockPath);
      }
      return verified;
    },
    async importCredential(provider, _credential, metadata) {
      persisted.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, verified: true };
    },
  };

  await assert.rejects(
    createJournal(fixture).resumeCredentialImports(sink),
    error => error.code === 'DATA_MIGRATION_LOCK_FAILED',
  );

  assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=credential-secret');
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.statSync(lockPath).ino, replacementLockStats.ino);
});

test('credential migration id uses the same trimmed bytes that are imported', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=credential-secret\r\n');
  const persisted = new Set();
  let importCalls = 0;
  const sink = {
    async verifyCredentialImport(provider, migrationId) {
      return persisted.has(`${provider}:${migrationId}`);
    },
    async importCredential(provider, credential, metadata) {
      importCalls += 1;
      assert.equal(credential.cookie, 'MUSIC_U=credential-secret');
      persisted.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, verified: true };
    },
  };
  const fileSystem = Object.create(fs);
  fileSystem.renameSync = (from, to) => {
    if (path.resolve(to) === path.resolve(fixture.journalFile)) {
      const nextState = JSON.parse(fs.readFileSync(from, 'utf8'));
      if (Object.values(nextState.entries)
        .some(entry => entry.status === 'source-removal-pending')) {
        const error = new Error('simulated journal commit failure');
        error.code = 'EIO';
        throw error;
      }
    }
    return fs.renameSync(from, to);
  };

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeCredentialImports(sink),
    /journal/i,
  );
  fs.writeFileSync(source, 'MUSIC_U=credential-secret');
  await createJournal(fixture).resumeCredentialImports(sink);

  assert.equal(importCalls, 1);
  assert.equal(fs.existsSync(source), false);
});

test('linked target publication finalizes even when the legacy source changes', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  fs.writeFileSync(source, 'published-cache');
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (isPlatformCacheStagingPayload(file, fixture)) {
      const error = new Error('simulated crash before staging cleanup');
      error.code = 'EPERM';
      throw error;
    }
    return fs.unlinkSync(file);
  };

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeFiles(),
    error => error.code === 'DATA_MIGRATION_COPY_FAILED',
  );
  fs.writeFileSync(source, 'newer-legacy-cache');

  const resumed = createJournal(fixture);
  await resumed.resumeFiles();

  assert.equal(fs.readFileSync(fixture.paths.platformCache, 'utf8'), 'published-cache');
  assert.equal(fs.statSync(fixture.paths.platformCache).nlink, 1);
  assert.equal(resumed.status().complete, 1);
});

test('selected credential disappearance remains visible as degraded', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=credential-secret');
  const sink = createCredentialImportSink(
    async () => ({ persisted: false, verified: true }),
  );
  const journal = createJournal(fixture);

  await journal.resumeCredentialImports(sink.options);
  fs.rmSync(source);

  assert.deepEqual(journal.status(), {
    schema: DATA_MIGRATION_SCHEMA,
    total: 1,
    pending: 0,
    sourceRemovalPending: 0,
    complete: 0,
    degraded: 1,
  });
});

test('unselected plaintext credential sources keep a completed provider degraded', async (t) => {
  const fixture = makeFixture(t);
  const otherRoot = path.join(fixture.root, 'legacy-older');
  fs.mkdirSync(otherRoot);
  const selected = path.join(fixture.source, '.cookie');
  const preserved = path.join(otherRoot, '.cookie');
  fs.writeFileSync(selected, 'MUSIC_U=selected-secret');
  fs.writeFileSync(preserved, 'MUSIC_U=preserved-secret');
  const selectedTime = new Date('2026-07-30T00:00:00.000Z');
  const preservedTime = new Date('2026-07-29T00:00:00.000Z');
  fs.utimesSync(selected, selectedTime, selectedTime);
  fs.utimesSync(preserved, preservedTime, preservedTime);
  const sink = createCredentialImportSink(
    async () => ({ persisted: true, verified: true }),
  );
  const journal = createJournal(fixture, {
    sourceRoots: [otherRoot, fixture.source],
  });

  await journal.resumeCredentialImports(sink.options);

  assert.equal(fs.existsSync(selected), false);
  assert.equal(fs.readFileSync(preserved, 'utf8'), 'MUSIC_U=preserved-secret');
  assert.equal(journal.status().complete, 0);
  assert.equal(journal.status().degraded, 1);
});

test('credential removal never unlinks the public legacy source path', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=credential-secret');
  let publicUnlinks = 0;
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (path.resolve(file) === path.resolve(source)) publicUnlinks += 1;
    return fs.unlinkSync(file);
  };
  const sink = createCredentialImportSink(
    async () => ({ persisted: true, verified: true }),
  );

  await createJournal(fixture, { fileSystem })
    .resumeCredentialImports(sink.options);

  assert.equal(publicUnlinks, 0);
  assert.equal(fs.existsSync(source), false);
});

test('compromised lock ownership survives the old process exit hook', (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  const lockPath = `${fixture.journalFile}.lock`;
  fs.writeFileSync(source, 'MUSIC_U=credential-secret');
  const modulePath = path.join(__dirname, 'data-migration-journal.js');
  const childScript = `
    const fs = require('node:fs');
    const migration = require(${JSON.stringify(modulePath)});
    const filePath = ${JSON.stringify(fixture.journalFile)};
    const sourceRoot = ${JSON.stringify(fixture.source)};
    const paths = ${JSON.stringify(fixture.paths)};
    let persisted = false;
    const journal = migration.createDataMigrationJournal({
      filePath,
      sourceRoots: [sourceRoot],
      manifest: migration.createDefaultMigrationManifest(paths),
      now: () => '2026-07-30T02:30:00.000Z',
    });
    (async () => {
      try {
        await journal.resumeCredentialImports({
          async verifyCredentialImport() {
            if (!persisted) return false;
            fs.rmSync(filePath + '.lock', { recursive: true, force: true });
            fs.mkdirSync(filePath + '.lock');
            return true;
          },
          async importCredential() {
            persisted = true;
            return { persisted: true, verified: true };
          },
        });
        process.exitCode = 11;
      } catch (error) {
        if (!error || error.code !== 'DATA_MIGRATION_LOCK_FAILED') {
          console.error(error && error.stack ? error.stack : error);
          process.exitCode = 12;
        }
      }
    })();
  `;

  const child = spawnSync(process.execPath, ['-e', childScript], {
    encoding: 'utf8',
    timeout: 20_000,
  });

  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=credential-secret');
});

test('journal commit cannot overwrite a new owner after the lock changes', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  const lockPath = `${fixture.journalFile}.lock`;
  fs.writeFileSync(source, 'legacy-cache');
  const manifest = createDefaultMigrationManifest(fixture.paths);
  const foreignState = {
    schema: DATA_MIGRATION_SCHEMA,
    entries: Object.fromEntries(manifest.map(entry => [
      entry.id,
      { status: 'pending' },
    ])),
    updatedAt: '2026-07-30T09:45:00.000Z',
  };
  const descriptors = new Map();
  let injected = false;
  const fileSystem = Object.create(fs);
  fileSystem.openSync = (file, ...args) => {
    const descriptor = fs.openSync(file, ...args);
    descriptors.set(descriptor, path.resolve(file));
    return descriptor;
  };
  fileSystem.closeSync = (descriptor) => {
    descriptors.delete(descriptor);
    return fs.closeSync(descriptor);
  };
  fileSystem.fsyncSync = (descriptor) => {
    fs.fsyncSync(descriptor);
    const openedPath = descriptors.get(descriptor) || '';
    if (!injected
      && path.dirname(openedPath) === path.dirname(fixture.journalFile)
      && path.basename(openedPath).endsWith('.tmp')) {
      injected = true;
      fs.rmSync(lockPath, { recursive: true, force: true });
      fs.mkdirSync(lockPath);
      fs.writeFileSync(fixture.journalFile, JSON.stringify(foreignState));
    }
  };

  await assert.rejects(
    createJournal(fixture, { fileSystem }).resumeFiles(),
    error => error.code === 'DATA_MIGRATION_LOCK_FAILED',
  );

  assert.equal(injected, true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(fixture.journalFile, 'utf8')),
    foreignState,
  );
});

test('public credential move never overwrites a concurrent tombstone', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=imported-secret');
  let concurrentPath = null;
  let collisionInserted = false;
  const fileSystem = Object.create(fs);
  fileSystem.renameSync = (from, to) => {
    if (path.resolve(from) === path.resolve(source)
      && String(to).endsWith('.pending.deleting')
      && !fs.existsSync(to)) {
      concurrentPath = to;
      collisionInserted = true;
      fs.writeFileSync(to, 'MUSIC_U=concurrent-secret');
    }
    return fs.renameSync(from, to);
  };
  const sink = createCredentialImportSink(
    async () => ({ persisted: true, verified: true }),
  );
  const journal = createJournal(fixture, { fileSystem });

  await journal.resumeCredentialImports(sink.options);

  if (collisionInserted) {
    assert.equal(fs.readFileSync(concurrentPath, 'utf8'), 'MUSIC_U=concurrent-secret');
    assert.equal(fs.readFileSync(source, 'utf8'), 'MUSIC_U=imported-secret');
    assert.equal(journal.status().sourceRemovalPending, 1);
  } else {
    assert.equal(fs.existsSync(source), false);
    assert.equal(journal.status().complete, 1);
  }
});

test('published staging cleanup never unlinks the fixed staging path', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, 'platform-cache.json');
  const staging = path.join(
    path.dirname(fixture.paths.platformCache),
    '.platform-cache.json.mineradio-migration.pending',
  );
  fs.writeFileSync(source, 'legacy-cache');
  let stagingUnlinks = 0;
  const fileSystem = Object.create(fs);
  fileSystem.unlinkSync = (file) => {
    if (path.resolve(file) === path.resolve(staging)) {
      stagingUnlinks += 1;
      fs.unlinkSync(file);
      fs.writeFileSync(staging, 'concurrent-cache');
    }
    return fs.unlinkSync(file);
  };

  await createJournal(fixture, { fileSystem }).resumeFiles();

  assert.equal(stagingUnlinks, 0);
  assert.equal(fs.readFileSync(fixture.paths.platformCache, 'utf8'), 'legacy-cache');
});

test('different removal snapshots recover without losing either credential', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=imported-secret');
  let injected = false;
  let importCalls = 0;
  const fileSystem = Object.create(fs);
  fileSystem.renameSync = (from, to) => {
    if (!injected
      && path.resolve(from) === path.resolve(source)
      && String(to).endsWith('.pending.deleting')) {
      injected = true;
      fs.unlinkSync(source);
      fs.writeFileSync(source, 'MUSIC_U=replacement-secret');
      fs.renameSync(source, to);
      const error = new Error('simulated crash after moving replacement');
      error.code = 'EIO';
      throw error;
    }
    return fs.renameSync(from, to);
  };
  const sink = createCredentialImportSink(async () => {
    importCalls += 1;
    return { persisted: true, verified: true };
  });

  await createJournal(fixture, { fileSystem })
    .resumeCredentialImports(sink.options);
  const resumed = createJournal(fixture);
  await resumed.resumeCredentialImports(sink.options);
  await resumed.resumeCredentialImports(sink.options);

  assert.equal(injected, true);
  assert.equal(importCalls, 2);
  assert.equal(fs.existsSync(source), false);
  assert.equal(
    fs.readdirSync(fixture.source)
      .some(name => name.includes('.mineradio-removal-')),
    false,
  );
  assert.equal(resumed.status().complete, 1);
});

test('missing removal source requires persisted import verification before complete', async (t) => {
  const fixture = makeFixture(t);
  const source = path.join(fixture.source, '.cookie');
  fs.writeFileSync(source, 'MUSIC_U=credential-secret');
  const persisted = new Set();
  let blockRemoval = true;
  const fileSystem = Object.create(fs);
  fileSystem.linkSync = (from, to) => {
    if (blockRemoval && path.resolve(from) === path.resolve(source)) {
      const error = new Error('simulated removal interruption');
      error.code = 'EPERM';
      throw error;
    }
    return fs.linkSync(from, to);
  };
  const sink = {
    verifyCalls: 0,
    async verifyCredentialImport(provider, migrationId) {
      this.verifyCalls += 1;
      return persisted.has(`${provider}:${migrationId}`);
    },
    async importCredential(provider, _credential, metadata) {
      persisted.add(`${provider}:${metadata.migrationId}`);
      return { persisted: true, verified: true };
    },
  };
  const journal = createJournal(fixture, { fileSystem });
  await journal.resumeCredentialImports(sink);
  assert.equal(journal.status().sourceRemovalPending, 1);
  fs.unlinkSync(source);
  persisted.clear();
  blockRemoval = false;
  sink.verifyCalls = 0;

  await journal.resumeCredentialImports(sink);

  assert.equal(sink.verifyCalls, 1);
  assert.equal(journal.status().complete, 0);
  assert.equal(journal.status().degraded, 1);
});

test('package check validates the data migration journal module', () => {
  const packageJson = require('../package.json');
  assert.match(
    packageJson.scripts.check,
    /node --check desktop\/data-migration-journal\.js/,
  );
});
