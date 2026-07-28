# Platform Contracts and Account Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有播放与界面的前提下，建立稳定数据目录、受保护凭证存储、平台能力声明和账号隔离缓存，作为五平台搜索及登录中心的共同底座。

**Architecture:** Electron 主进程先固定 Mineradio 拥有的数据根目录，并只迁移白名单文件；凭证存储独立于普通缓存并使用 Electron `safeStorage`。服务端通过纯 CommonJS 平台注册表生成能力快照，账号缓存以不可逆账号指纹隔离，新增路由只暴露脱敏后的能力信息。

**Tech Stack:** Electron、Node.js CommonJS、Node Test、`crypto`、`safeStorage`、现有本地 HTTP 路由与安全模块。

---

## 文件结构

- `desktop/app-paths.js`：稳定目录解析、白名单迁移计划和安全复制。
- `desktop/app-paths.test.js`：目录固定、未知文件忽略、较新有效文件选择测试。
- `desktop/credential-store.js`：受保护平台凭证的加密、原子写入、读取和删除。
- `desktop/credential-store.test.js`：密文落盘、不可用时失败关闭、登出删除测试。
- `server/platform/capabilities.js`：五个平台的静态支持矩阵和动态可用性快照。
- `tests/platform-capabilities.test.js`：能力边界和敏感字段过滤测试。
- `server/platform/account-cache.js`：账号指纹、命名空间、TTL 和 LRU 容量管理。
- `server/platform/account-context.js`：登录、退出和账号切换的原子作用域发布与清理钩子。
- `tests/platform-account-cache.test.js`：跨账号隔离、过期、容量和原始凭证不泄漏测试。
- `server/routes/platform.js`：`GET /api/platform/capabilities` 路由。
- `tests/platform-routes.test.js`：平台路由分发和错误回退测试。
- `desktop/main.js`：在首次读取 `userData` 前配置稳定目录，并把服务端文件路径指向新目录。
- `server.js`：注册平台路由。
- `server/security.js`：为后续平台写接口预留明确的 POST-only 清单，本批只验证能力查询保持只读。
- `package.json`：把新增模块加入语法检查。
- `NOTICE.md`、`docs/VENDOR_MANIFEST.md`：记录从 `XxHuberrr/Mineradio@4abaa19` 改编的目录与平台契约来源。

### Task 1: 固定应用数据目录并安全迁移白名单文件

**Files:**
- Create: `desktop/app-paths.js`
- Create: `desktop/app-paths.test.js`
- Modify: `desktop/main.js:1-95`
- Modify: `desktop/main.js:1678-1680`
- Modify: `package.json:8`

- [ ] **Step 1: 写稳定目录与迁移选择的失败测试**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  APP_OWNED_DATA_FILES,
  configureStableAppPaths,
  migrateOwnedDataFiles,
} = require('./app-paths');

test('configures one stable Mineradio root before persistent data is resolved', () => {
  const calls = [];
  const fakeApp = {
    setName(name) { calls.push(['name', name]); },
    getPath(name) {
      if (name === 'appData') return 'C:\\Users\\Tomato\\AppData\\Roaming';
      throw new Error('unexpected path');
    },
    setPath(name, value) { calls.push(['path', name, value]); },
  };

  const result = configureStableAppPaths(fakeApp, { createDirectory() {} });

  assert.equal(result.userData, path.win32.join('C:\\Users\\Tomato\\AppData\\Roaming', 'Mineradio'));
  assert.deepEqual(calls.slice(-1)[0], ['path', 'userData', result.userData]);
});

test('migration copies only approved files and never replaces a newer target', () => {
  const copied = [];
  migrateOwnedDataFiles({
    sourceRoots: ['legacy'],
    targetRoot: 'stable',
    statFile(file) {
      if (file === path.join('stable', '.cookie')) return { isFile: true, size: 5, mtimeMs: 20 };
      if (file === path.join('legacy', '.cookie')) return { isFile: true, size: 5, mtimeMs: 10 };
      return null;
    },
    validateFile: () => true,
    copyFileAtomic(source, target) { copied.push([source, target]); },
  });

  assert.equal(APP_OWNED_DATA_FILES.includes('unknown.txt'), false);
  assert.deepEqual(copied, []);
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test desktop/app-paths.test.js`

Expected: FAIL with `Cannot find module './app-paths'`.

- [ ] **Step 3: 实现最小稳定目录与白名单迁移 API**

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APP_OWNED_DATA_FILES = Object.freeze([
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
]);

function configureStableAppPaths(app, options) {
  options = options || {};
  const createDirectory = options.createDirectory || (dir => fs.mkdirSync(dir, { recursive: true }));
  const appName = options.appName || 'Mineradio';
  app.setName(appName);
  const userData = path.join(app.getPath('appData'), appName);
  createDirectory(userData);
  app.setPath('userData', userData);
  return {
    userData,
    credentials: path.join(userData, 'platform-credentials.bin'),
    platformCache: path.join(userData, 'platform-cache.json'),
    listenJournal: path.join(userData, 'listen-sync-journal.json'),
  };
}

function migrateOwnedDataFiles(options) {
  const copied = [];
  const targetRoot = path.resolve(options.targetRoot);
  const statFile = options.statFile;
  APP_OWNED_DATA_FILES.forEach(fileName => {
    const target = path.join(targetRoot, fileName);
    let selected = statFile(target);
    let selectedPath = selected ? target : '';
    (options.sourceRoots || []).forEach(root => {
      const sourceRoot = path.resolve(root);
      if (sourceRoot === targetRoot) return;
      const candidate = path.join(sourceRoot, fileName);
      if (path.dirname(path.resolve(candidate)) !== sourceRoot) return;
      const stat = statFile(candidate);
      if (!stat || !stat.isFile || stat.size <= 0 || stat.size > 16 * 1024 * 1024) return;
      if (!options.validateFile(fileName, candidate)) return;
      if (!selected || stat.mtimeMs > selected.mtimeMs) {
        selected = stat;
        selectedPath = candidate;
      }
    });
    if (!selectedPath || path.resolve(selectedPath) === path.resolve(target)) return;
    options.copyFileAtomic(selectedPath, target);
    copied.push(fileName);
  });
  return copied;
}

module.exports = {
  APP_OWNED_DATA_FILES,
  configureStableAppPaths,
  migrateOwnedDataFiles,
};
```

- [ ] **Step 4: 扩展测试覆盖无效文件、未知目录和复制较新白名单文件**

验证迁移器：

- 忽略目录、空文件和超过 16MB 的文件。
- 不枚举或复制白名单之外的名称。
- 目标不存在时复制有效源。
- 多个源存在时只复制最新有效项。
- 源目录等于目标目录时不复制。
- 源根、目标根和最终文件父目录必须经过 `path.resolve()` 校验。
- 复制使用同目录临时文件、`fsync`、`renameSync` 和复制后校验；失败时删除临时文件并保留原目标。
- Windows 上通过受控目录继承当前用户 ACL，不调用跨 shell 权限命令。

- [ ] **Step 5: 运行 Task 1 测试**

Run: `node --test desktop/app-paths.test.js`

Expected: PASS.

- [ ] **Step 6: 接入 `desktop/main.js`**

在 `desktop/main.js` 顶部常量建立后、任何 `app.getPath('userData')` 或 session 创建前调用 `configureStableAppPaths(app)`，保留返回值为 `APP_PATHS`。旧目录候选由 `appData` 下的固定历史名称生成，不能为了发现旧目录先读取 `userData`。服务端环境改用：

```js
process.env.COOKIE_FILE = path.join(APP_PATHS.userData, '.cookie');
process.env.QQ_COOKIE_FILE = path.join(APP_PATHS.userData, '.qq-cookie');
process.env.MINERADIO_PLATFORM_CACHE_FILE = APP_PATHS.platformCache;
process.env.MINERADIO_LISTEN_SYNC_FILE = APP_PATHS.listenJournal;
```

仅迁移 `APP_OWNED_DATA_FILES`，不能移动本地音乐文件、用户选择的缓存目录或未知文件。

- [ ] **Step 7: 运行桌面相关回归**

Run: `node --test desktop/app-paths.test.js desktop/shell-integration.test.js desktop/shell-state.test.js`

Expected: PASS.

- [ ] **Step 8: 提交**

```powershell
git add desktop/app-paths.js desktop/app-paths.test.js desktop/main.js package.json
git commit -m "feat: establish stable app data paths"
```

### Task 2: 建立加密凭证存储与内存降级

**Files:**
- Create: `desktop/credential-store.js`
- Create: `desktop/credential-store.test.js`
- Modify: `package.json:8`

- [ ] **Step 1: 写凭证加密、读取和删除的失败测试**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CREDENTIAL_SCHEMA,
  createCredentialStore,
} = require('./credential-store');

test('credential store persists ciphertext and returns one provider only', () => {
  let disk = Buffer.alloc(0);
  const store = createCredentialStore({
    filePath: 'credentials.bin',
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from('encrypted:' + value, 'utf8'),
      decryptString: value => value.toString('utf8').replace(/^encrypted:/, ''),
    },
    readFile: () => disk,
    writeFileAtomic: (_file, value) => { disk = Buffer.from(value); },
    removeFile: () => { disk = Buffer.alloc(0); },
  });

  store.set('spotify', { refreshToken: 'secret', accountId: 'tomato' });

  assert.equal(disk.includes(Buffer.from('secret')), false);
  assert.equal(store.get('spotify').refreshToken, 'secret');
  assert.equal(store.snapshot().schema, CREDENTIAL_SCHEMA);
  assert.equal(JSON.stringify(store.snapshot()).includes('secret'), false);
});

test('credential store degrades to memory only when encryption is unavailable', () => {
  const store = createCredentialStore({
    filePath: 'credentials.bin',
    safeStorage: { isEncryptionAvailable: () => false },
  });
  const result = store.set('netease', { cookie: 'MUSIC_U=x' });
  assert.equal(result.persisted, false);
  assert.equal(result.mode, 'memory-only');
  assert.equal(store.get('netease').cookie, 'MUSIC_U=x');
  assert.equal(store.snapshot().persistenceAvailable, false);
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test desktop/credential-store.test.js`

Expected: FAIL with `Cannot find module './credential-store'`.

- [ ] **Step 3: 实现最小凭证存储**

实现以下 API：

```js
createCredentialStore({
  filePath,
  safeStorage,
  readFile,
  writeFileAtomic,
  removeFile,
})
```

行为：

- 只接受 `netease | qq | kugou | qishui | spotify`。
- 文件内容为 `safeStorage.encryptString(JSON.stringify(envelope))` 的二进制结果。
- `set()` 写入 `{ schema, providers }`，采用同目录临时文件加 `renameSync`。
- `get()` 只返回请求平台的深拷贝。
- `delete()` 删除单个平台；最后一个平台删除后移除整个文件。
- `snapshot()` 只返回 schema、平台名、账号 ID、更新时间和加密可用状态，不返回凭证值。
- 解密或 JSON 校验失败返回稳定错误 `CREDENTIAL_STORE_CORRUPT`，不能输出原始密文。
- `safeStorage` 不可用时进入明确的 `memory-only` 模式：本次运行可以登录，但不写任何明文或可逆密文，重启后要求重新登录。
- 降级状态通过脱敏快照返回，不能静默伪装成持久化成功。

- [ ] **Step 4: 补齐降级和损坏数据测试**

覆盖：

- 损坏密文。
- 不支持的平台。
- 删除一个平台不影响其他平台。
- 删除最后一个平台移除文件。
- 错误对象、快照和序列化日志不包含 Cookie、Token 或 OAuth code。

- [ ] **Step 5: 运行凭证测试**

Run: `node --test desktop/credential-store.test.js`

Expected: PASS.

- [ ] **Step 6: 提交**

```powershell
git add desktop/credential-store.js desktop/credential-store.test.js package.json
git commit -m "feat: add protected provider credential store"
```

### Task 3: 固定五平台能力声明

**Files:**
- Create: `server/platform/capabilities.js`
- Create: `tests/platform-capabilities.test.js`
- Modify: `package.json:8`

- [ ] **Step 1: 写能力矩阵失败测试**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createCapabilitySnapshot,
  providerCapability,
} = require('../server/platform/capabilities');

test('metadata-only providers never advertise playback or writes', () => {
  const snapshot = createCapabilitySnapshot({
    kugou: { loggedIn: true },
    qishui: { loggedIn: true },
    spotify: { loggedIn: true },
  });

  ['kugou', 'qishui', 'spotify'].forEach(provider => {
    const item = providerCapability(snapshot, provider);
    assert.equal(item.capabilities.search, true);
    assert.equal(item.capabilities.playback, false);
    assert.equal(item.capabilities.playlistWrite, false);
    assert.equal(item.capabilities.commentsCreate, false);
  });
});

test('write availability requires both support and an authenticated account', () => {
  const loggedOut = providerCapability(createCapabilitySnapshot(), 'netease');
  const loggedIn = providerCapability(createCapabilitySnapshot({
    netease: { loggedIn: true, accountId: '1001', nickname: 'Tomato' },
  }), 'netease');

  assert.equal(loggedOut.capabilities.albumCollect, true);
  assert.equal(loggedOut.availability.albumCollect, false);
  assert.equal(loggedIn.availability.albumCollect, true);
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test tests/platform-capabilities.test.js`

Expected: FAIL with `Cannot find module '../server/platform/capabilities'`.

- [ ] **Step 3: 实现静态支持与动态可用性分离**

`createCapabilitySnapshot(statusByProvider)` 返回：

```js
{
  schema: 1,
  generatedAt: 0,
  providers: [{
    provider: 'netease',
    label: '网易云音乐',
    authMethods: ['qr', 'cookie', 'external-window'],
    account: { loggedIn: false, accountId: '', nickname: '' },
    capabilities: {
      search: true,
      playback: true,
      sourceMatch: true,
      albumDetail: true,
      albumCollect: true,
      playlistSubscribe: true,
      playlistWrite: true,
      commentsRead: true,
      commentsLike: true,
      commentsCreate: true,
      recentPlayReport: true,
      listenDurationReport: true
    },
    availability: {}
  }]
}
```

规则：

- `capabilities` 只表示产品是否实现，不能随登录状态变化。
- `availability` 表示当前是否可执行。
- 网易云和 QQ 保留当前播放能力。
- 酷狗、汽水、Spotify 的 `playback/sourceMatch/albumCollect/playlistWrite/commentsLike/commentsCreate/recentPlayReport/listenDurationReport` 固定为 `false`。
- 账号对象只保留 `loggedIn/accountId/nickname/avatar/membership`，丢弃所有未知字段。
- 写能力的可用性必须同时满足支持和登录；只读搜索不要求登录。

- [ ] **Step 4: 补齐能力快照测试**

覆盖：

- 固定五个平台且顺序稳定。
- 未知平台返回 `null`。
- 动态账号状态不能把静态 `false` 提升为 `true`。
- 原始 Cookie、Token 和 refresh token 不出现在快照。
- 返回值修改不会污染下一次快照。

- [ ] **Step 5: 运行能力测试**

Run: `node --test tests/platform-capabilities.test.js`

Expected: PASS.

- [ ] **Step 6: 提交**

```powershell
git add server/platform/capabilities.js tests/platform-capabilities.test.js package.json
git commit -m "feat: declare provider capability boundaries"
```

### Task 4: 建立账号作用域缓存和原子账号上下文

**Files:**
- Create: `server/platform/account-cache.js`
- Create: `server/platform/account-context.js`
- Create: `tests/platform-account-cache.test.js`
- Modify: `package.json:8`

- [ ] **Step 1: 写跨账号隔离失败测试**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAccountFingerprint,
  createAccountScopedCache,
} = require('../server/platform/account-cache');
const {
  createAccountContext,
} = require('../server/platform/account-context');

test('fingerprints are stable, account-specific and never expose credentials', () => {
  const a = createAccountFingerprint({
    provider: 'netease',
    accountId: '1001',
    credential: 'MUSIC_U=secret-a',
  });
  const b = createAccountFingerprint({
    provider: 'netease',
    accountId: '1002',
    credential: 'MUSIC_U=secret-b',
  });

  assert.equal(a, createAccountFingerprint({
    provider: 'netease',
    accountId: '1001',
    credential: 'MUSIC_U=secret-a',
  }));
  assert.notEqual(a, b);
  assert.equal(a.includes('secret-a'), false);
});

test('collection membership and source values cannot cross account scopes', () => {
  let now = 1000;
  const cache = createAccountScopedCache({ maxEntries: 4, now: () => now });
  cache.set('scope-a', 'collection', 'album:1', true, 100);

  assert.equal(cache.get('scope-a', 'collection', 'album:1'), true);
  assert.equal(cache.get('scope-b', 'collection', 'album:1'), undefined);

  now = 1101;
  assert.equal(cache.get('scope-a', 'collection', 'album:1'), undefined);
});

test('account switch clears the old scope before publishing the new account', async () => {
  const events = [];
  const context = createAccountContext({
    clearScope(scope) { events.push('cache:' + scope); },
    clearInflight(provider) { events.push('inflight:' + provider); },
    clearSession(provider) { events.push('session:' + provider); },
    publish(provider, account) { events.push('publish:' + provider + ':' + account.accountId); },
  });

  await context.switchAccount('netease', { accountId: '1001', credential: 'a' });
  events.length = 0;
  await context.switchAccount('netease', { accountId: '1002', credential: 'b' });

  assert.deepEqual(events.slice(0, 3), [
    'cache:' + createAccountFingerprint({ provider: 'netease', accountId: '1001', credential: 'a' }),
    'inflight:netease',
    'session:netease',
  ]);
  assert.equal(events[3], 'publish:netease:1002');
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test tests/platform-account-cache.test.js`

Expected: FAIL with `Cannot find module '../server/platform/account-cache'`.

- [ ] **Step 3: 实现最小账号缓存**

公开 API：

```js
createAccountFingerprint({ provider, accountId, credential })
createAccountScopedCache({ maxEntries, defaultTtlMs, now })
createAccountContext({ clearScope, clearInflight, clearSession, publish })
```

缓存实例提供：

```js
get(scope, namespace, key)
set(scope, namespace, key, value, ttlMs)
delete(scope, namespace, key)
clearScope(scope)
clear()
snapshot()
```

实现约束：

- 指纹为 `sha256(provider + "\0" + accountId + "\0" + sha256(credential))`，输出固定十六进制摘要。
- 命名空间只允许 `collection | membership | source`。
- 完整缓存键使用不可逆 scope，不保存 credential。
- `get()` 命中时更新 LRU；过期时立即删除。
- 超过 `maxEntries` 时淘汰最久未使用项。
- `snapshot()` 只包含数量、各 namespace 数量和淘汰/过期计数。
- 存入和取出普通对象时做结构化拷贝，防止调用方修改缓存内部值。
- `switchAccount()` 串行化同平台操作；先等待旧 scope、请求去重项和专用 session 清理完成，再发布新账号。
- `logout()` 使用同一清理顺序并发布未登录状态。
- 任一清理钩子失败时不发布新账号，返回脱敏错误并保持平台处于 `switching` 状态，交由登录中心重试或显式恢复。

- [ ] **Step 4: 补齐边界测试**

覆盖：

- 同账号换凭证产生新 scope。
- `clearScope()` 不影响其他账号。
- 非法 namespace 失败关闭。
- LRU 淘汰顺序。
- TTL 到期。
- 快照不包含 key、账号 ID、凭证或缓存值。
- 并发切换按调用顺序执行，不能让较早请求覆盖较新账号。
- session 清理、请求去重清理和缓存清理全部发生在发布之前。

- [ ] **Step 5: 运行账号缓存测试**

Run: `node --test tests/platform-account-cache.test.js`

Expected: PASS.

- [ ] **Step 6: 提交**

```powershell
git add server/platform/account-cache.js server/platform/account-context.js tests/platform-account-cache.test.js package.json
git commit -m "feat: isolate provider caches by account"
```

### Task 5: 暴露只读平台能力路由

**Files:**
- Create: `server/routes/platform.js`
- Create: `tests/platform-routes.test.js`
- Modify: `server.js:64-78`
- Modify: `server.js:2540-2670`
- Modify: `server/security.js:3-17`
- Modify: `package.json:8`

- [ ] **Step 1: 写平台路由失败测试**

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const { createPlatformRoutes } = require('../server/routes/platform');

test('platform route returns a sanitized capability snapshot', async () => {
  let response = null;
  const routes = createPlatformRoutes({
    sendJSON(_res, body, status) { response = { body, status: status || 200 }; },
    getAccountStatuses: async () => ({
      netease: { loggedIn: true, accountId: '1001', cookie: 'MUSIC_U=secret' },
    }),
  });

  assert.equal(await routes.handleRoute(
    '/api/platform/capabilities',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/platform/capabilities')
  ), true);
  assert.equal(response.status, 200);
  assert.equal(response.body.providers[0].account.loggedIn, true);
  assert.equal(JSON.stringify(response.body).includes('MUSIC_U'), false);
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test tests/platform-routes.test.js`

Expected: FAIL with `Cannot find module '../server/routes/platform'`.

- [ ] **Step 3: 实现只读路由**

```js
function createPlatformRoutes(deps) {
  async function handleCapabilities(_req, res) {
    try {
      const statuses = await deps.getAccountStatuses();
      deps.sendJSON(res, deps.createCapabilitySnapshot(statuses));
    } catch (error) {
      deps.sendJSON(res, deps.createCapabilitySnapshot(), 200);
    }
  }

  async function handleRoute(pathname, req, res) {
    if (pathname !== '/api/platform/capabilities') return false;
    if (String(req.method || '').toUpperCase() !== 'GET') {
      deps.sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return true;
    }
    await handleCapabilities(req, res);
    return true;
  }

  return { handleRoute };
}
```

默认依赖使用 `server/platform/capabilities.js`，测试可以注入。

- [ ] **Step 4: 在 `server.js` 注册路由**

新增账号状态聚合函数：

```js
async function getPlatformAccountStatuses() {
  const results = await Promise.allSettled([getLoginInfo(), getQQLoginInfo()]);
  return {
    netease: results[0].status === 'fulfilled' ? results[0].value : { loggedIn: false },
    qq: results[1].status === 'fulfilled' ? results[1].value : { loggedIn: false },
    kugou: { loggedIn: false },
    qishui: { loggedIn: false },
    spotify: { loggedIn: false },
  };
}
```

平台路由放在现有网易云/QQ 路由之前，避免后续统一搜索路径冲突。

- [ ] **Step 5: 补充安全和集成测试**

在 `tests/security.test.js` 验证：

```js
assert.equal(isMethodAllowedForRoute('/api/platform/capabilities', 'GET'), true);
assert.equal(isMethodAllowedForRoute('/api/platform/capabilities', 'POST'), false);
```

在 `server/security.js` 新增 `GET_ONLY_ROUTES`，能力查询只允许 GET。后续 `/api/platform/login/*`、`/api/platform/listen/report` 和网易云写接口必须显式加入 `POST_ONLY_ROUTES`。

在 `tests/smoke.test.js` 验证 `server.js` 已创建并调度 `platformRoutes`。

- [ ] **Step 6: 运行平台和服务端测试**

Run: `node --test tests/platform-capabilities.test.js tests/platform-account-cache.test.js tests/platform-routes.test.js tests/security.test.js tests/server-modules.test.js tests/smoke.test.js`

Expected: PASS.

- [ ] **Step 7: 将所有新增生产模块加入显式语法检查**

`package.json` 的 `check` 必须新增：

```text
node --check desktop/app-paths.js
node --check desktop/credential-store.js
node --check server/platform/capabilities.js
node --check server/platform/account-cache.js
node --check server/platform/account-context.js
node --check server/routes/platform.js
```

- [ ] **Step 8: 运行显式语法检查**

Run: `npm run check`

Expected: exit 0，且输出命令包含以上六个文件。

- [ ] **Step 9: 提交**

```powershell
git add server/routes/platform.js server.js server/security.js tests/platform-routes.test.js tests/security.test.js tests/smoke.test.js package.json
git commit -m "feat: expose sanitized platform capabilities"
```

### Task 6: 补齐来源记录并执行第一批验收

**Files:**
- Modify: `NOTICE.md`
- Modify: `docs/VENDOR_MANIFEST.md`
- Modify: `docs/superpowers/plans/2026-07-28-platform-contracts-account-isolation.md`

- [ ] **Step 1: 记录改编来源**

记录：

- 来源仓库：`https://github.com/XxHuberrr/Mineradio`
- 固定 commit：`4abaa19`
- 参考文件：`desktop/main.js`、`server.js`
- 本批改编范围：稳定用户目录、平台能力模型、账号隔离概念。
- 许可证：GPL-3.0-only。

不能覆盖现有 Folia、Pretext 或其它 vendor 条目。

- [ ] **Step 2: 运行语法检查**

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 3: 运行全量测试**

Run: `npm test`

Expected: all tests pass; baseline is 588 tests and the total increases by this batch's tests.

- [ ] **Step 4: 检查 diff**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: 检查安全边界**

Run:

```powershell
rg -n "MUSIC_U=|refreshToken|accessToken|clientSecret" desktop server tests
```

Expected: only fixtures, parser keys, or explicit redaction checks; no production logging of credential values.

- [ ] **Step 6: 提交文档和验收记录**

```powershell
git add NOTICE.md docs/VENDOR_MANIFEST.md docs/superpowers/plans/2026-07-28-platform-contracts-account-isolation.md
git commit -m "docs: record platform foundation provenance"
```

## 后续计划

本计划验收后依次编写并执行：

1. 五平台统一搜索适配器与前端增量结果计划。
2. 多平台登录中心与网易云写操作计划。
3. 首页、歌单和内容列表计划。
4. 播放事务、音频增强和收听统计计划。
5. Cuefield AutoMix 计划。
6. Sonic 与视觉增强计划。
7. 完整桌面与 Wallpaper Engine 计划。
8. 性能、内存和缓存收口计划。
9. 安装、发布和模块化收口计划。
