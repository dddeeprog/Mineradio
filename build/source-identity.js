const { execFileSync } = require('node:child_process');
const { types } = require('node:util');

const FULL_GIT_OBJECT = /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
const UNSUPPORTED_INPUT_ROOTS = new Set(['dist', 'node_modules']);
const BASENAME_GLOB = /^[A-Za-z0-9._-]*\*[A-Za-z0-9._-]*$/;
const MAX_PACKAGED_FILE_RULES = 512;

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
  derivePathspecRoots,
  isPackagedPath,
  parsePackagedFileRules,
  resolveSourceIdentity,
};
