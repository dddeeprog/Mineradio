const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const sourceIdentity = require('../build/source-identity.js');

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const TREE = '89abcdef0123456789abcdef0123456789abcdef';
const BUILD_FILES = [
  'desktop/**/*',
  'public/**/*',
  'build/**/*',
  '!build/.generated/**/*',
  'server.js',
  'server/**/*',
  'dj-analyzer.js',
  'LICENSE',
  'NOTICE.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/VENDOR_MANIFEST.md',
  'package.json',
  '!public/index.*.html',
  'public/index.html',
];

function makeGitRunner(options = {}) {
  const calls = [];
  const runner = (command, args, runnerOptions) => {
    calls.push({ command, args, options: runnerOptions });
    if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') {
      return `${options.head || HEAD}\n`;
    }
    if (args.join(' ') === 'rev-parse --verify HEAD^{tree}') {
      return `${options.tree || TREE}\n`;
    }
    if (args.join(' ') === 'status --porcelain=v1 --untracked-files=all') {
      return options.status || '';
    }
    if (args.join(' ') === 'ls-files -v -z') {
      return options.indexEntries === undefined
        ? 'H package.json\0'
        : options.indexEntries;
    }
    if (args[0] === 'ls-files') {
      const ignoredPaths = options.ignoredPaths || [];
      return ignoredPaths.length === 0 ? '' : `${ignoredPaths.join('\0')}\0`;
    }
    throw new Error(`Unexpected git arguments: ${args.join(' ')}`);
  };
  runner.calls = calls;
  return runner;
}

function resolve(options = {}) {
  return sourceIdentity.resolveSourceIdentity({
    buildFiles: BUILD_FILES,
    ...options,
  });
}

test('source identity resolves full HEAD and tree from a clean worktree', () => {
  const gitRunner = makeGitRunner();

  assert.deepEqual(resolve({
    repoDir: 'C:\\repo',
    env: {},
    gitRunner,
  }), {
    commit: HEAD,
    sourceTree: TREE,
  });
  assert.deepEqual(
    gitRunner.calls.map((call) => call.args),
    [
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      ['rev-parse', '--verify', 'HEAD^{tree}'],
      ['status', '--porcelain=v1', '--untracked-files=all'],
      ['ls-files', '-v', '-z'],
      [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '-z',
        '--',
        'desktop',
        'public',
        'build',
        'server.js',
        'server',
        'dj-analyzer.js',
        'LICENSE',
        'NOTICE.md',
        'THIRD_PARTY_NOTICES.md',
        'docs/VENDOR_MANIFEST.md',
        'package.json',
      ],
    ],
  );
  assert.ok(gitRunner.calls.every((call) => call.command === 'git'));
  assert.ok(gitRunner.calls.every((call) => call.options.cwd === 'C:\\repo'));
});

test('source identity rejects tracked and untracked worktree changes', async (t) => {
  await t.test('tracked dirty file', () => {
    assert.throws(
      () => resolve({
        repoDir: 'C:\\repo',
        env: {},
        gitRunner: makeGitRunner({ status: ' M build/file.js\n' }),
      }),
      /dirty|tracked|worktree/i,
    );
  });

  await t.test('untracked file', () => {
    assert.throws(
      () => resolve({
        repoDir: 'C:\\repo',
        env: {},
        gitRunner: makeGitRunner({ status: '?? dist/foreign.exe\n' }),
      }),
      /dirty|untracked|worktree/i,
    );
  });
});

test('source identity rejects fictitious and abbreviated commit overrides', async (t) => {
  await t.test('different full commit', () => {
    assert.throws(
      () => resolve({
        repoDir: 'C:\\repo',
        env: { MINERADIO_BUILD_COMMIT: 'f'.repeat(40) },
        gitRunner: makeGitRunner(),
      }),
      /MINERADIO_BUILD_COMMIT|HEAD|mismatch/i,
    );
  });

  await t.test('abbreviated commit', () => {
    assert.throws(
      () => resolve({
        repoDir: 'C:\\repo',
        env: { MINERADIO_BUILD_COMMIT: HEAD.slice(0, 12) },
        gitRunner: makeGitRunner(),
      }),
      /MINERADIO_BUILD_COMMIT|full|40|64/i,
    );
  });
});

test('source identity rejects abbreviated git object output', () => {
  assert.throws(
    () => resolve({
      repoDir: 'C:\\repo',
      env: {},
      gitRunner: makeGitRunner({ head: HEAD.slice(0, 12) }),
    }),
    /HEAD|full|40|64/i,
  );
});

test('source identity rejects hidden tracked changes in real Git repositories', async (t) => {
  function makeFlaggedRepository(flag) {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-source-flags-'));
    const git = (...args) => execFileSync('git', args, {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    git('init', '--quiet');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Mineradio Test');
    fs.mkdirSync(path.join(repoDir, 'public'));
    fs.writeFileSync(path.join(repoDir, 'public', 'tracked.txt'), 'original\n');
    git('add', 'public/tracked.txt');
    git('commit', '--quiet', '-m', 'fixture');
    git('update-index', flag, 'public/tracked.txt');
    fs.writeFileSync(path.join(repoDir, 'public', 'tracked.txt'), 'tampered\n');
    assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
    return repoDir;
  }

  for (const [name, flag] of [
    ['assume-unchanged', '--assume-unchanged'],
    ['skip-worktree', '--skip-worktree'],
  ]) {
    await t.test(name, () => {
      assert.throws(
        () => sourceIdentity.resolveSourceIdentity({
          buildFiles: ['public/**/*'],
          repoDir: makeFlaggedRepository(flag),
          env: {},
        }),
        /assume|skip|index|hidden|flag/i,
      );
    });
  }
});

test('source identity rejects ignored paths selected by package.build.files', async (t) => {
  for (const ignoredPath of [
    'public/.env',
    'server/a.log',
    'build/a.tmp',
  ]) {
    await t.test(ignoredPath, () => {
      assert.throws(
        () => resolve({
          repoDir: 'C:\\repo',
          env: {},
          gitRunner: makeGitRunner({ ignoredPaths: [ignoredPath] }),
        }),
        /ignored|package|build\.files|source/i,
      );
    });
  }

  await t.test('ignored symlink under public', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-source-identity-'));
    const targetDir = path.join(repoDir, 'ignored-target');
    const linkPath = path.join(repoDir, 'public', 'ignored-link');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(targetDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);

    assert.throws(
      () => resolve({
        repoDir,
        env: {},
        gitRunner: makeGitRunner({ ignoredPaths: ['public/ignored-link'] }),
      }),
      /ignored|symlink|package|build\.files/i,
    );
  });

  await t.test('public/index.html remains re-included', () => {
    assert.throws(
      () => resolve({
        repoDir: 'C:\\repo',
        env: {},
        gitRunner: makeGitRunner({ ignoredPaths: ['public/index.html'] }),
      }),
      /ignored|package|build\.files/i,
    );
  });
});

test('source identity allows ignored paths outside or excluded from packaged inputs', () => {
  assert.doesNotThrow(() => resolve({
    repoDir: 'C:\\repo',
    env: {},
    gitRunner: makeGitRunner({
      ignoredPaths: [
        'node_modules/pkg/index.js',
        'dist/old-installer.exe',
        'build/.generated/installer-manifest.json',
        'public/index.experiment.html',
      ],
    }),
  }));
});

test('source identity mirrors electron-builder bare directory expansion', async (t) => {
  await t.test('positive bare directory includes descendants', () => {
    assert.throws(
      () => resolve({
        buildFiles: ['public'],
        repoDir: 'C:\\repo',
        env: {},
        gitRunner: makeGitRunner({ ignoredPaths: ['public/ignored.bin'] }),
      }),
      /ignored|package|build\.files|source/i,
    );
  });

  await t.test('negative bare directory excludes descendants in order', () => {
    assert.doesNotThrow(() => resolve({
      buildFiles: ['public', '!public/private'],
      repoDir: 'C:\\repo',
      env: {},
      gitRunner: makeGitRunner({ ignoredPaths: ['public/private/ignored.bin'] }),
    }));
  });
});

test('source identity fails closed for unsupported package.build.files rules', async (t) => {
  const scenarios = [
    ['missing files array', undefined],
    ['object form', [...BUILD_FILES, { from: 'public', to: '.' }]],
    ['macro', [...BUILD_FILES, 'public/${arch}/**/*']],
    ['wide glob', ['**/*']],
    ['node_modules input', [...BUILD_FILES, 'node_modules/**/*']],
    ['dist input', [...BUILD_FILES, 'dist/**/*']],
    ['unparsed glob', [...BUILD_FILES, 'public/**/secrets/*.json']],
  ];

  for (const [name, buildFiles] of scenarios) {
    await t.test(name, () => {
      assert.throws(
        () => resolve({
          buildFiles,
          repoDir: 'C:\\repo',
          env: {},
          gitRunner: makeGitRunner(),
        }),
        /build\.files|unsupported|glob|node_modules|dist/i,
      );
    });
  }
});
