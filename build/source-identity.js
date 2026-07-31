const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types } = require('node:util');

const FULL_GIT_OBJECT = /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
const UNSUPPORTED_INPUT_ROOTS = new Set(['dist', 'node_modules']);
const BASENAME_GLOB = /^[A-Za-z0-9._-]*\*[A-Za-z0-9._-]*$/;
const MAX_PACKAGED_FILE_RULES = 512;
const MAX_PACKAGE_LOCK_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const PACKAGE_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function sha256File(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(256 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex').toUpperCase();
}

function readRegularFile(filePath, label, maxBytes) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} is missing or unreadable: ${filePath}.`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}.`);
  }
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maxBytes) {
    throw new Error(`${label} exceeds its ${maxBytes}-byte read limit.`);
  }
  return fs.readFileSync(filePath);
}

function readJsonBuffer(buffer, label) {
  let value;
  try {
    value = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} contains malformed JSON.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value;
}

function packageNameFromLockPath(packagePath) {
  const segments = packagePath.split('/');
  const markerIndex = segments.lastIndexOf('node_modules');
  const tail = segments.slice(markerIndex + 1);
  if (markerIndex < 0 || tail.length < 1 || tail.length > 2) {
    throw new Error(`package-lock production dependency path is malformed: ${packagePath}.`);
  }
  const name = tail[0].startsWith('@') ? tail.slice(0, 2).join('/') : tail[0];
  if (!name || (tail[0].startsWith('@') && tail.length !== 2)) {
    throw new Error(`package-lock production dependency path is malformed: ${packagePath}.`);
  }
  return name;
}

function collectLockedProductionPackages(lock) {
  if (lock.lockfileVersion !== 3) {
    throw new Error('package-lock.json must use lockfileVersion 3.');
  }
  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
    throw new Error('package-lock.json packages map is missing or malformed.');
  }

  const packages = [];
  for (const [packagePath, metadata] of Object.entries(lock.packages)) {
    if (!packagePath.startsWith('node_modules/')) continue;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error(`package-lock entry is malformed: ${packagePath}.`);
    }
    if (metadata.dev === true || metadata.link === true) continue;
    if (packagePath.includes('\\') || packagePath.split('/').some((segment) => !segment || segment === '..')) {
      throw new Error(`package-lock production dependency path is malformed: ${packagePath}.`);
    }
    const name = metadata.name === undefined
      ? packageNameFromLockPath(packagePath)
      : String(metadata.name);
    const version = String(metadata.version || '');
    const integrity = String(metadata.integrity || '');
    if (!name || !version) {
      throw new Error(`package-lock production dependency name or version is missing: ${packagePath}.`);
    }
    if (!PACKAGE_INTEGRITY.test(integrity)) {
      throw new Error(`package-lock production dependency integrity is missing or unsupported: ${packagePath}.`);
    }
    packages.push({
      path: packagePath,
      name,
      version,
      integrity,
    });
  }
  packages.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return packages;
}

function digestPackageDirectory(packageDir) {
  const files = [];

  function walk(directory, relativeRoot) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = relativeRoot
        ? `${relativeRoot}/${entry.name}`
        : entry.name;
      const stat = fs.lstatSync(absolutePath);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        throw new Error(`Packaged production dependency contains a symlink: ${relativePath}.`);
      }
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || !stat.isFile()) {
        throw new Error(`Packaged production dependency contains an unsupported entry: ${relativePath}.`);
      }
      files.push({
        path: relativePath.replace(/\\/g, '/'),
        size: stat.size,
        sha256: sha256File(absolutePath),
      });
    }
  }

  walk(packageDir, '');
  return sha256Buffer(Buffer.from(JSON.stringify(files), 'utf8'));
}

function collectPackagedProductionPackages(appDir) {
  const packages = [];
  const seenPaths = new Set();

  function collectPackage(packageDir, packagePath) {
    if (seenPaths.has(packagePath)) {
      throw new Error(`Packaged production dependency path is duplicated: ${packagePath}.`);
    }
    seenPaths.add(packagePath);
    const packageJsonPath = path.join(packageDir, 'package.json');
    const metadata = readJsonBuffer(
      readRegularFile(packageJsonPath, `Packaged ${packagePath} package.json`, MAX_PACKAGE_JSON_BYTES),
      `Packaged ${packagePath} package.json`,
    );
    const name = String(metadata.name || '');
    const version = String(metadata.version || '');
    if (!name || !version) {
      throw new Error(`Packaged production dependency name or version is missing: ${packagePath}.`);
    }
    packages.push({
      path: packagePath,
      name,
      version,
      directorySha256: digestPackageDirectory(packageDir),
    });
    visitNodeModules(path.join(packageDir, 'node_modules'), packagePath);
  }

  function visitNodeModules(nodeModulesDir, ownerPath) {
    if (!fs.existsSync(nodeModulesDir)) return;
    const nodeModulesStat = fs.lstatSync(nodeModulesDir);
    if (nodeModulesStat.isSymbolicLink() || !nodeModulesStat.isDirectory()) {
      throw new Error(`Packaged node_modules must be a regular directory: ${nodeModulesDir}.`);
    }
    const entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (entry.name === '.bin' || entry.name === '.package-lock.json') continue;
      const entryPath = path.join(nodeModulesDir, entry.name);
      const entryStat = fs.lstatSync(entryPath);
      if (entry.isSymbolicLink() || entryStat.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`Packaged node_modules contains an unsupported entry: ${entryPath}.`);
      }
      if (entry.name.startsWith('@')) {
        for (const scopedEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
          const scopedPath = path.join(entryPath, scopedEntry.name);
          const scopedStat = fs.lstatSync(scopedPath);
          if (scopedEntry.isSymbolicLink() || scopedStat.isSymbolicLink() || !scopedEntry.isDirectory()) {
            throw new Error(`Packaged node_modules scope contains an unsupported entry: ${scopedPath}.`);
          }
          const packagePath = ownerPath
            ? `${ownerPath}/node_modules/${entry.name}/${scopedEntry.name}`
            : `node_modules/${entry.name}/${scopedEntry.name}`;
          collectPackage(scopedPath, packagePath);
        }
        continue;
      }
      const packagePath = ownerPath
        ? `${ownerPath}/node_modules/${entry.name}`
        : `node_modules/${entry.name}`;
      collectPackage(entryPath, packagePath);
    }
  }

  visitNodeModules(path.join(appDir, 'node_modules'), '');
  packages.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return packages;
}

function createProductionDependencyProof(options) {
  const input = options || {};
  const appDir = path.resolve(String(input.appDir || ''));
  const packageLockPath = path.resolve(String(input.packageLockPath || ''));
  if (!input.appDir) throw new Error('Packaged app directory is required.');
  if (!input.packageLockPath) throw new Error('package-lock.json path is required.');

  const packageLockBuffer = readRegularFile(
    packageLockPath,
    'package-lock.json',
    MAX_PACKAGE_LOCK_BYTES,
  );
  const lockedPackages = collectLockedProductionPackages(
    readJsonBuffer(packageLockBuffer, 'package-lock.json'),
  );
  const packagedPackages = collectPackagedProductionPackages(appDir);
  const lockedByPath = new Map(lockedPackages.map((entry) => [entry.path, entry]));
  const packagedByPath = new Map(packagedPackages.map((entry) => [entry.path, entry]));

  for (const locked of lockedPackages) {
    const packaged = packagedByPath.get(locked.path);
    if (!packaged) {
      throw new Error(`Packaged production dependency is missing: ${locked.path}.`);
    }
    if (packaged.name !== locked.name) {
      throw new Error(
        `Packaged production dependency name mismatch for ${locked.path}: `
        + `expected ${locked.name}, received ${packaged.name}.`,
      );
    }
    if (packaged.version !== locked.version) {
      throw new Error(
        `Packaged production dependency version mismatch for ${locked.path}: `
        + `expected ${locked.version}, received ${packaged.version}.`,
      );
    }
  }
  for (const packaged of packagedPackages) {
    if (!lockedByPath.has(packaged.path)) {
      throw new Error(`Packaged production dependency is extra or absent from package-lock: ${packaged.path}.`);
    }
  }

  const packages = lockedPackages.map((locked) => ({
    ...locked,
    directorySha256: packagedByPath.get(locked.path).directorySha256,
  }));
  return {
    schemaVersion: 1,
    packageLockSha256: sha256Buffer(packageLockBuffer),
    nodeModulesSha256: sha256Buffer(Buffer.from(JSON.stringify(packages), 'utf8')),
    packages,
  };
}

function commandErrorText(error) {
  const output = [];
  if (error && error.stderr) output.push(String(error.stderr));
  if (error && error.stdout) output.push(String(error.stdout));
  if (output.length === 0 && error && error.message) output.push(error.message);
  return output.join('\n').trim() || 'unknown git error';
}

function runGit(repoDir, args, gitRunner) {
  try {
    return String((gitRunner || execFileSync)('git', args, {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (error) {
    throw new Error(`Git source identity command failed (${args.join(' ')}): ${commandErrorText(error)}`);
  }
}

function requireFullObjectId(value, label) {
  const normalized = String(value || '').trim();
  if (!FULL_GIT_OBJECT.test(normalized)) {
    throw new Error(`${label} must be a full 40- or 64-character hexadecimal Git object ID.`);
  }
  return normalized.toLowerCase();
}

function requireSafeRelativePath(value, label) {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${label} must be a forward-slash relative path.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => (
    !SAFE_PATH_SEGMENT.test(segment) || segment === '.' || segment === '..'
  ))) {
    throw new Error(`${label} contains an unsupported path segment.`);
  }
  return segments.join('/');
}

function snapshotDenseDataArray(value, label) {
  if (!Array.isArray(value) || types.isProxy(value)
      || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`${label} must be a supported plain data array.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor && lengthDescriptor.value;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
      || !Number.isSafeInteger(length) || length <= 0 || length > MAX_PACKAGED_FILE_RULES) {
    throw new Error(
      `${label} must contain between 1 and ${MAX_PACKAGED_FILE_RULES} data entries.`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1
      || ownKeys.some((key) => (
        key !== 'length'
        && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key)
          || Number(key) >= length)
      ))) {
    throw new Error(`${label} must be dense and cannot contain extra properties.`);
  }

  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label} entries must be enumerable data properties.`);
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function expandPackagedFileRules(buildFiles) {
  const inputRules = snapshotDenseDataArray(buildFiles, 'package.build.files');
  const expanded = [];
  for (let index = 0; index < inputRules.length; index += 1) {
    const rawRule = inputRules[index];
    if (typeof rawRule === 'string') {
      if (expanded.length >= MAX_PACKAGED_FILE_RULES) {
        throw new Error(
          `package.build.files cannot exceed ${MAX_PACKAGED_FILE_RULES} expanded rules.`,
        );
      }
      expanded.push(rawRule);
      continue;
    }

    const label = `package.build.files rule ${index + 1}`;
    if (!rawRule || typeof rawRule !== 'object' || types.isProxy(rawRule)
        || Array.isArray(rawRule)
        || Object.getPrototypeOf(rawRule) !== Object.prototype) {
      throw new Error(`${label} must be a supported string or normalized file set.`);
    }
    const properties = Object.create(null);
    for (const key of Reflect.ownKeys(rawRule)) {
      if (typeof key !== 'string' || !['filter', 'from', 'to'].includes(key)) {
        throw new Error(`${label} contains unsupported file set properties.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(rawRule, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`${label} properties must be enumerable data properties.`);
      }
      properties[key] = descriptor.value;
    }
    const hasDefaultPath = (value) => value === undefined || value === null || value === '.';
    if (!hasDefaultPath(properties.from) || !hasDefaultPath(properties.to)) {
      throw new Error(`${label} contains unsupported custom file set paths.`);
    }
    const filterRules = snapshotDenseDataArray(properties.filter, `${label} filter`);
    if (expanded.length + filterRules.length > MAX_PACKAGED_FILE_RULES) {
      throw new Error(
        `package.build.files cannot exceed ${MAX_PACKAGED_FILE_RULES} expanded rules.`,
      );
    }
    expanded.push(...filterRules);
  }
  return expanded;
}

function parsePackagedFileRules(buildFiles) {
  const expandedRules = expandPackagedFileRules(buildFiles);
  const rules = expandedRules.map((rawRule, index) => {
    const label = `package.build.files rule ${index + 1}`;
    if (typeof rawRule !== 'string' || rawRule.trim() !== rawRule || !rawRule) {
      throw new Error(`${label} must be a non-empty supported string rule.`);
    }
    const negative = rawRule.startsWith('!');
    const pattern = negative ? rawRule.slice(1) : rawRule;
    if (!pattern || pattern.includes('${') || pattern.includes('{') || pattern.includes('}')) {
      throw new Error(`${label} contains an unsupported macro or glob.`);
    }
    if (pattern === '**/*') {
      throw new Error(`${label} is too broad; package.build.files cannot include **/*.`);
    }

    let rule;
    const recursiveMatch = pattern.match(/^(.+)\/\*\*\/\*$/);
    if (recursiveMatch) {
      const root = requireSafeRelativePath(recursiveMatch[1], label);
      rule = { negative, pattern, root, type: 'subtree' };
    } else if (pattern.includes('*')) {
      if ((pattern.match(/\*/g) || []).length !== 1) {
        throw new Error(`${label} contains an unsupported glob.`);
      }
      const separator = pattern.lastIndexOf('/');
      if (separator <= 0) {
        throw new Error(`${label} contains an unsupported broad glob.`);
      }
      const root = requireSafeRelativePath(pattern.slice(0, separator), label);
      const basenamePattern = pattern.slice(separator + 1);
      if (!BASENAME_GLOB.test(basenamePattern)) {
        throw new Error(`${label} contains an unsupported glob.`);
      }
      const starIndex = basenamePattern.indexOf('*');
      rule = {
        negative,
        pattern,
        prefix: basenamePattern.slice(0, starIndex),
        root,
        suffix: basenamePattern.slice(starIndex + 1),
        type: 'basename-glob',
      };
    } else {
      const normalizedPattern = requireSafeRelativePath(pattern, label);
      rule = {
        negative,
        pattern: normalizedPattern,
        root: normalizedPattern,
        type: normalizedPattern.includes('.') ? 'exact' : 'path-or-subtree',
      };
    }

    const topLevelRoot = rule.root.split('/')[0].toLowerCase();
    if (!negative && UNSUPPORTED_INPUT_ROOTS.has(topLevelRoot)) {
      throw new Error(`${label} explicitly includes unsupported ${topLevelRoot} input.`);
    }
    return rule;
  });

  if (!rules.some((rule) => !rule.negative)) {
    throw new Error('package.build.files must include at least one positive input rule.');
  }
  return rules;
}

function ruleMatchesPath(rule, candidatePath) {
  if (rule.type === 'exact') return candidatePath === rule.pattern;
  if (rule.type === 'path-or-subtree') {
    return candidatePath === rule.pattern || candidatePath.startsWith(`${rule.root}/`);
  }
  if (rule.type === 'subtree') return candidatePath.startsWith(`${rule.root}/`);

  const separator = candidatePath.lastIndexOf('/');
  if (separator <= 0 || candidatePath.slice(0, separator) !== rule.root) return false;
  const basename = candidatePath.slice(separator + 1);
  return basename.startsWith(rule.prefix) && basename.endsWith(rule.suffix);
}

function isPackagedPath(rules, candidatePath) {
  let included = false;
  for (const rule of rules) {
    if (ruleMatchesPath(rule, candidatePath)) included = !rule.negative;
  }
  return included;
}

function derivePathspecRoots(rules) {
  const roots = [];
  const directoryRoots = [];
  for (const rule of rules) {
    if (rule.negative) continue;
    const isDirectoryRoot = rule.type !== 'exact';
    if (directoryRoots.some((root) => rule.root === root || rule.root.startsWith(`${root}/`))) {
      continue;
    }
    if (roots.some((entry) => entry.path === rule.root)) continue;
    roots.push({ path: rule.root, isDirectoryRoot });
    if (isDirectoryRoot) directoryRoots.push(rule.root);
  }
  return roots.map((entry) => entry.path);
}

function normalizeGitPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return requireSafeRelativePath(normalized, 'Ignored Git path');
}

function assertNoIgnoredPackagedInputs(repoDir, rules, gitRunner) {
  const roots = derivePathspecRoots(rules);
  const output = runGit(repoDir, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '-z',
    '--',
    ...roots,
  ], gitRunner);
  if (!output) return;
  if (!output.endsWith('\0')) {
    throw new Error('Git ignored source input listing was malformed.');
  }
  for (const value of output.slice(0, -1).split('\0')) {
    const ignoredPath = normalizeGitPath(value);
    if (isPackagedPath(rules, ignoredPath)) {
      throw new Error(
        `Ignored source input selected by package.build.files cannot be packaged: ${ignoredPath}.`,
      );
    }
  }
}

function assertNoHiddenIndexFlags(repoDir, gitRunner) {
  const output = runGit(repoDir, ['ls-files', '-v', '-z'], gitRunner);
  if (!output) return;
  if (!output.endsWith('\0')) {
    throw new Error('Git index flag listing was malformed.');
  }
  for (const entry of output.slice(0, -1).split('\0')) {
    if (!entry.startsWith('H ')) {
      const status = entry.slice(0, 1) || '?';
      throw new Error(
        `Git index contains a hidden or non-normal tracked entry flag (${status}); `
        + 'assume-unchanged and skip-worktree entries are not allowed for release builds.',
      );
    }
  }
}

function resolveSourceIdentity(options) {
  const input = options || {};
  const repoDir = String(input.repoDir || '').trim();
  if (!repoDir) throw new Error('Source repository directory is required.');
  const packagedFileRules = parsePackagedFileRules(input.buildFiles);
  const env = input.env || process.env;
  const head = requireFullObjectId(
    runGit(repoDir, ['rev-parse', '--verify', 'HEAD^{commit}'], input.gitRunner),
    'Git HEAD',
  );
  const sourceTree = requireFullObjectId(
    runGit(repoDir, ['rev-parse', '--verify', 'HEAD^{tree}'], input.gitRunner),
    'Git source tree',
  );
  const worktreeStatus = runGit(
    repoDir,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    input.gitRunner,
  );
  if (worktreeStatus.trim()) {
    const firstChange = worktreeStatus.trim().split(/\r?\n/, 1)[0];
    throw new Error(`Source worktree is dirty (tracked or untracked change): ${firstChange}`);
  }
  assertNoHiddenIndexFlags(repoDir, input.gitRunner);
  assertNoIgnoredPackagedInputs(repoDir, packagedFileRules, input.gitRunner);

  if (env.MINERADIO_BUILD_COMMIT !== undefined) {
    const declaredCommit = requireFullObjectId(
      env.MINERADIO_BUILD_COMMIT,
      'Build commit MINERADIO_BUILD_COMMIT',
    );
    if (declaredCommit !== head) {
      throw new Error('Build commit MINERADIO_BUILD_COMMIT does not match the real Git HEAD.');
    }
  }

  return { commit: head, sourceTree };
}

module.exports = {
  FULL_GIT_OBJECT,
  createProductionDependencyProof,
  derivePathspecRoots,
  isPackagedPath,
  parsePackagedFileRules,
  resolveSourceIdentity,
};
