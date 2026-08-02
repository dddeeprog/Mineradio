const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canRemoveInstallTree,
  classifyInstallPath,
  createOwnershipMarker,
  normalizeInstallPath,
  normalizeRelativeInstallEntry,
  partitionInstallEntries,
  validateOwnershipMarker,
} = require('../build/installer-safety.js');

const pathPolicy = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'],
  userProfile: 'C:\\Users\\Alice',
};

function marker(overrides) {
  return createOwnershipMarker({
    productName: 'Mineradio',
    appId: 'com.mineradio.desktop',
    channel: 'stable',
    version: '1.1.0',
    installPath: 'D:\\Mineradio',
    manifestSha256: 'A'.repeat(64),
    commit: 'd61cc2e',
    buildId: 'fixture-build',
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  });
}

function expectedMarker(overrides) {
  return {
    productName: 'Mineradio',
    appId: 'com.mineradio.desktop',
    channel: 'stable',
    version: '1.1.0',
    installPath: 'D:\\Mineradio',
    manifestSha256: 'A'.repeat(64),
    commit: 'd61cc2e',
    buildId: 'fixture-build',
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

test('normalizes absolute Windows install paths without accepting drive-relative paths', () => {
  assert.equal(
    normalizeInstallPath('D:/Apps/Mineradio/../Mineradio/'),
    'D:\\Apps\\Mineradio',
  );
  assert.throws(() => normalizeInstallPath('D:Mineradio'), /absolute/i);
  assert.throws(() => normalizeInstallPath('\\Mineradio'), /absolute/i);
  assert.throws(() => normalizeInstallPath('/Mineradio'), /absolute/i);
  assert.throws(() => normalizeInstallPath(''), /install path/i);
});

test('rejects drive roots, system roots, user roots, UNC paths, and reparse points', () => {
  const fixtures = [
    ['C:\\', 'drive-root'],
    ['C:\\Windows\\Temp\\Mineradio', 'system-directory'],
    ['C:\\Program Files\\Mineradio', 'system-directory'],
    ['C:\\Users\\Alice', 'user-root'],
    ['\\\\server\\share\\Mineradio', 'unc-path'],
  ];

  for (const [candidate, reason] of fixtures) {
    const result = classifyInstallPath(candidate, pathPolicy);
    assert.equal(result.safe, false, candidate);
    assert.equal(result.reason, reason, candidate);
  }

  const reparse = classifyInstallPath('D:\\Apps\\Mineradio', {
    ...pathPolicy,
    isReparsePoint(candidate) {
      return candidate.toLowerCase() === 'd:\\apps';
    },
  });
  assert.equal(reparse.safe, false);
  assert.equal(reparse.reason, 'reparse-point');
  assert.equal(reparse.reparsePath, 'D:\\Apps');

  assert.deepEqual(classifyInstallPath('D:\\Mineradio', pathPolicy), {
    safe: true,
    reason: null,
    normalizedPath: 'D:\\Mineradio',
  });
});

test('rejects ambiguous Windows path segments, device names, and alternate streams', () => {
  for (const candidate of [
    'C:\\Windows.\\Temp\\Mineradio',
    'C:\\Users\\Alice. ',
    'D:\\Apps\\CON',
    'D:\\Apps\\file.txt:stream',
  ]) {
    const result = classifyInstallPath(candidate, pathPolicy);
    assert.equal(result.safe, false, candidate);
    assert.equal(result.reason, 'invalid-path', candidate);
  }

  for (const entry of [
    '.mineradio-install-owner.json.',
    'name ',
    'CON',
    'dir\\AUX.txt',
    'COM¹',
    'dir\\LPT².log',
    'file.txt:stream',
    'wild*.txt',
    'wild?.txt',
    'bad<name.txt',
    'bad|name.txt',
    'folder\\',
  ]) {
    assert.throws(
      () => normalizeRelativeInstallEntry(entry),
      /windows path/i,
      entry,
    );
  }
});

test('creates and validates a channel-bound ownership marker', () => {
  const value = marker();

  assert.deepEqual(
    validateOwnershipMarker(value, expectedMarker({
      installPath: 'd:\\MINERADIO',
    })),
    { valid: true, reasons: [] },
  );

  const mismatch = validateOwnershipMarker(value, expectedMarker({
    channel: 'beta',
  }));
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.reasons.includes('channel-mismatch'));

  const moved = validateOwnershipMarker(value, expectedMarker({
    installPath: 'E:\\Mineradio',
  }));
  assert.equal(moved.valid, false);
  assert.ok(moved.reasons.includes('install-path-mismatch'));
});

test('rejects malformed, incomplete, or unbound ownership markers', () => {
  assert.throws(
    () => marker({ manifestSha256: 'not-a-sha256' }),
    /manifest sha256/i,
  );

  for (const value of [
    null,
    {},
    marker({ installPath: 'D:\\Other' }),
  ]) {
    const result = validateOwnershipMarker(value, expectedMarker());
    assert.equal(result.valid, false);
    assert.ok(result.reasons.length > 0);
  }
});

test('ownership validation binds version, commit, build identity, and creation time', () => {
  for (const [field, value, reason] of [
    ['version', '1.1.1', 'version-mismatch'],
    ['commit', 'cafebabe', 'commit-mismatch'],
    ['buildId', 'other-build', 'build-id-mismatch'],
    ['createdAt', '2026-07-30T00:00:00.000Z', 'created-at-mismatch'],
  ]) {
    const expected = expectedMarker({
      [field]: value,
    });
    const result = validateOwnershipMarker(marker(), expected);
    assert.equal(result.valid, false, field);
    assert.ok(result.reasons.includes(reason), field);
  }
});

test('ownership validation attributes an invalid marker timestamp to the marker only', () => {
  const invalidMarker = {
    ...marker(),
    createdAt: 'not-a-timestamp',
  };
  const result = validateOwnershipMarker(invalidMarker, expectedMarker());

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('invalid-created-at'));
  assert.ok(!result.reasons.includes('expected-created-at-invalid'));
});

test('partitions known files across current and interrupted-upgrade manifests', () => {
  const result = partitionInstallEntries({
    entries: [
      { path: 'Mineradio.exe', type: 'file' },
      { path: 'resources\\app\\server.js', type: 'file' },
      { path: 'resources\\app\\new-runtime.js', type: 'file' },
      { path: 'user-notes.txt', type: 'file' },
    ],
    manifests: [
      {
        files: [
          { path: 'Mineradio.exe' },
          { path: 'resources/app/server.js' },
        ],
        directories: ['resources', 'resources/app'],
      },
      {
        files: [{ path: 'resources/app/new-runtime.js' }],
        directories: ['resources', 'resources/app'],
      },
    ],
  });

  assert.deepEqual(result.knownFiles, [
    'Mineradio.exe',
    'resources\\app\\new-runtime.js',
    'resources\\app\\server.js',
  ]);
  assert.deepEqual(result.unknownEntries, ['user-notes.txt']);
  assert.deepEqual(result.missingFiles, []);
});

test('unknown files prevent whole-tree removal while known cleanup remains partitioned', () => {
  const ownership = marker();
  const expected = expectedMarker();
  const manifest = {
    files: [{ path: 'Mineradio.exe' }],
    directories: [],
  };

  const blocked = canRemoveInstallTree({
    installPath: 'D:\\Mineradio',
    pathPolicy,
    marker: ownership,
    expectedMarker: expected,
    manifests: [manifest],
    entries: [
      { path: 'Mineradio.exe', type: 'file' },
      { path: 'sentinel.keep', type: 'file' },
    ],
  });
  assert.equal(blocked.canRemove, false);
  assert.deepEqual(blocked.partition.unknownEntries, ['sentinel.keep']);
  assert.ok(blocked.reasons.includes('unknown-entries'));

  const clean = canRemoveInstallTree({
    installPath: 'D:\\Mineradio',
    pathPolicy,
    marker: ownership,
    expectedMarker: expected,
    manifests: [manifest],
    entries: [{ path: 'Mineradio.exe', type: 'file' }],
  });
  assert.equal(clean.canRemove, true);
  assert.deepEqual(clean.reasons, []);
});

test('whole-tree removal binds the actual path to both ownership records', () => {
  const ownership = marker({ installPath: 'D:\\Owner' });
  const result = canRemoveInstallTree({
    installPath: 'D:\\Victim',
    pathPolicy,
    marker: ownership,
    expectedMarker: expectedMarker({
      installPath: 'D:\\Owner',
    }),
    manifests: [{ files: [{ path: 'Mineradio.exe' }], directories: [] }],
    entries: [{ path: 'Mineradio.exe', type: 'file' }],
  });

  assert.equal(result.canRemove, false);
  assert.ok(result.reasons.includes('install-path-binding-mismatch'));
});

test('entry enumeration accepts only explicit files and directories', () => {
  const manifest = {
    files: [{ path: 'Mineradio.exe' }],
    directories: ['resources'],
  };
  for (const entries of [
    [{ path: 'Mineradio.exe' }],
    [{ path: 'Mineradio.exe', type: 'junction' }],
    [{ path: 'Mineradio.exe', type: 'special' }],
  ]) {
    assert.throws(
      () => partitionInstallEntries({ entries, manifests: [manifest] }),
      /entry type/i,
    );
  }
});

test('missing entry enumeration or manifests fail closed', () => {
  const input = {
    installPath: 'D:\\Mineradio',
    pathPolicy,
    marker: marker(),
    expectedMarker: expectedMarker(),
  };

  for (const partial of [
    { entries: [], manifests: undefined },
    { entries: undefined, manifests: [{ files: [], directories: [] }] },
    { entries: [], manifests: [] },
    { entries: [], manifests: [{ files: null, directories: [] }] },
  ]) {
    const result = canRemoveInstallTree({ ...input, ...partial });
    assert.equal(result.canRemove, false);
    assert.ok(result.reasons.includes('invalid-install-entry'));
  }
});

test('checks the root and every ancestor for reparse points and fails closed on inspection errors', () => {
  const visited = [];
  const rootReparse = classifyInstallPath('D:\\Apps\\Mineradio', {
    ...pathPolicy,
    isReparsePoint(candidate) {
      visited.push(candidate);
      return candidate === 'D:\\';
    },
  });
  assert.equal(rootReparse.safe, false);
  assert.equal(rootReparse.reason, 'reparse-point');
  assert.equal(rootReparse.reparsePath, 'D:\\');
  assert.equal(visited[0], 'D:\\');

  const inspectionFailure = classifyInstallPath('D:\\Apps\\Mineradio', {
    ...pathPolicy,
    isReparsePoint() {
      throw new Error('attribute query failed');
    },
  });
  assert.equal(inspectionFailure.safe, false);
  assert.equal(inspectionFailure.reason, 'path-inspection-failed');
});

test('invalid policy roots return a structured fail-closed decision', () => {
  const result = classifyInstallPath('D:\\Mineradio', {
    ...pathPolicy,
    systemRoot: 'relative-windows-root',
  });
  assert.equal(result.safe, false);
  assert.equal(result.reason, 'invalid-policy');

  const removal = canRemoveInstallTree({
    installPath: 'D:\\Mineradio',
    pathPolicy: {
      ...pathPolicy,
      userProfile: 'relative-user-root',
    },
    marker: marker(),
    expectedMarker: expectedMarker(),
    manifests: [{ files: [{ path: 'Mineradio.exe' }], directories: [] }],
    entries: [{ path: 'Mineradio.exe', type: 'file' }],
  });
  assert.equal(removal.canRemove, false);
  assert.ok(removal.reasons.includes('unsafe-install-path:invalid-policy'));
});
