# Five-Platform Unified Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fail-soft, paginated search across NetEase, QQ, Kugou, Qishui, and Spotify while keeping metadata-only providers out of playback and write actions.

**Architecture:** Existing NetEase and QQ search functions are wrapped as adapters. New focused adapters query only Kugou and Qishui public catalogues plus Spotify's official Web API when credentials are available. A CommonJS aggregator owns validation, timeouts, pagination, and partial failures; an independent UMD frontend state module consumes only the standard response and drives incremental provider updates.

**Tech Stack:** Node.js CommonJS, native HTTP helpers, browser UMD JavaScript, CSS, Node Test, Electron Builder.

---

## File Map

- Create `server/platform/search-model.js`: standard result normalization and safe provider metadata.
- Create `server/platform/search-aggregator.js`: fixed provider registry, bounded pagination, timeout, and partial-failure response.
- Create `server/platform/providers/legacy-search.js`: wrappers for existing NetEase and QQ functions.
- Create `server/platform/providers/kugou-search.js`: Kugou public metadata search only.
- Create `server/platform/providers/qishui-search.js`: Qishui public metadata search and local ranking only.
- Create `server/platform/providers/spotify-search.js`: official Spotify metadata search using an access token or server-side client credentials.
- Create `server/routes/platform-search.js`: GET-only unified search endpoint.
- Create `public/platform-search-state.js`: capabilities, incremental provider pools, pagination, and action-state model.
- Modify `server.js`: assemble adapters and register unified search before legacy provider routes.
- Modify `server/platform/capabilities.js`: advertise the newly implemented search adapters.
- Modify `server/security.js`: make unified search GET-only.
- Modify `public/index.html`: add five platform tabs and wire incremental rendering without embedding provider request logic.
- Modify `public/styles/app.css`: platform labels, provider status row, metadata-only rows, and bounded tab overflow.
- Modify `package.json`: syntax-check all new modules.
- Add targeted tests under `tests/`.

### Task 1: Standard Search Model

**Files:**
- Create: `tests/platform-search-model.test.js`
- Create: `server/platform/search-model.js`

- [ ] **Step 1: Write failing tests**

Cover all five providers, normalized artists/albums/duration, safe provider data, metadata-only playback, invalid rows, and deep-copy behavior.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/platform-search-model.test.js`

Expected: FAIL because `server/platform/search-model.js` does not exist.

- [ ] **Step 3: Implement the minimal model**

Export `normalizeSearchRecord`, `normalizeSearchPage`, `searchRecordKey`, and the fixed provider order. Only NetEase and QQ may set `playable: true`; provider-specific data is copied through an explicit allowlist.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/platform-search-model.test.js`

Expected: PASS.

### Task 2: Provider Adapters

**Files:**
- Create: `tests/platform-search-providers.test.js`
- Create: `server/platform/providers/legacy-search.js`
- Create: `server/platform/providers/kugou-search.js`
- Create: `server/platform/providers/qishui-search.js`
- Create: `server/platform/providers/spotify-search.js`

- [ ] **Step 1: Write failing adapter tests**

Assert exact bounded query parameters, offsets, result mapping, Qishui relevance ordering, Spotify token caching, and a stable `SPOTIFY_AUTH_REQUIRED` failure with no credential leakage.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/platform-search-providers.test.js`

Expected: FAIL because the provider modules do not exist.

- [ ] **Step 3: Implement metadata-only adapters**

Adapt only search request and normalization logic from XxHuberrr/Mineradio `v2.0.2` at commit `4abaa190de42c632365ae4244e041bad16443224`. Do not import Kugou/Qishui/Spotify playback, Qishui decryptors, local-session discovery, or platform write APIs.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/platform-search-providers.test.js`

Expected: PASS.

### Task 3: Aggregator and Route

**Files:**
- Create: `tests/platform-search-aggregator.test.js`
- Create: `tests/platform-search-routes.test.js`
- Create: `server/platform/search-aggregator.js`
- Create: `server/routes/platform-search.js`
- Modify: `server/platform/capabilities.js`
- Modify: `server/security.js`
- Modify: `server.js`

- [ ] **Step 1: Write failing aggregator and route tests**

Cover fixed provider order, one-provider and all-provider requests, timeout isolation, error sanitization, per-provider page state, invalid input, GET-only behavior, and server-owned capabilities.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/platform-search-aggregator.test.js tests/platform-search-routes.test.js tests/platform-capabilities.test.js tests/security.test.js`

Expected: FAIL on missing modules and still-disabled provider search availability.

- [ ] **Step 3: Implement and assemble**

Expose `GET /api/platform/search?q=<query>&provider=<provider|all>&limit=<1..20>&offset=<bounded>`. Return:

```js
{
  schema: 1,
  query: '...',
  results: [],
  pages: {
    netease: { offset: 0, limit: 12, nextOffset: 12, hasMore: true, total: 0 }
  },
  errors: [{ provider: 'spotify', code: 'SPOTIFY_AUTH_REQUIRED', retryable: false }]
}
```

Never include upstream response bodies, cookies, tokens, client secrets, or raw error strings.

- [ ] **Step 4: Verify GREEN**

Run the same targeted command and expect PASS.

### Task 4: Incremental Frontend State

**Files:**
- Create: `tests/platform-search-ui.test.js`
- Create: `public/platform-search-state.js`

- [ ] **Step 1: Write failing state tests**

Cover capability-driven provider selection, request URLs, out-of-order provider completion, stale-session rejection keys, append pagination, partial failures, metadata-only actions, and bounded deduplication.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/platform-search-ui.test.js`

Expected: FAIL because `public/platform-search-state.js` does not exist.

- [ ] **Step 3: Implement the UMD state module**

Keep network and DOM access outside the module. Export pure helpers plus a mutable bounded session whose provider pools are rebuilt in fixed order after each settled request.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/platform-search-ui.test.js`

Expected: PASS.

### Task 5: Page Integration and Pagination

**Files:**
- Create: `tests/platform-search-page-integration.test.js`
- Modify: `public/index.html`
- Modify: `public/styles/app.css`
- Modify: `package.json`

- [ ] **Step 1: Write failing integration tests**

Assert module load order, all five tabs, unified endpoint usage, incremental settlement rendering, provider status output, remote load-more flow, capability-driven action markup, and absence of metadata-only playback handlers.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/platform-search-page-integration.test.js tests/smoke.test.js`

Expected: FAIL on missing script, tabs, and integration hooks.

- [ ] **Step 3: Wire the page**

Fetch the capability snapshot once with bounded reuse. Fan out one unified endpoint request per available provider so each result can render immediately. Preserve local result batching, then request the next remote pages when the local pool is exhausted. Show compact loading/success/failure provider states and keep metadata-only results visible but non-interactive.

- [ ] **Step 4: Verify GREEN**

Run the same targeted command and expect PASS.

### Task 6: Full Verification and Integration

**Files:**
- Modify: `docs/修改日志.md`

- [ ] **Step 1: Run static and automated checks**

Run:

```powershell
npm run check
npm test
git diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Exercise the live API**

Start the local server on an unused port. Verify one provider success, an all-provider partial response, empty-query rejection, and POST rejection. Confirm unavailable Spotify credentials produce only a Spotify error.

- [ ] **Step 3: Verify the UI**

Open Mineradio in the browser, search a fixed song, confirm incremental provider statuses, platform labels, metadata-only rows, tab overflow, and remote pagination at desktop and narrow viewports.

- [ ] **Step 4: Verify release packaging**

Run:

```powershell
npm run verify:artifacts
npm run build:win:dir
```

Expected: both commands pass.

- [ ] **Step 5: Record and merge**

Append the exact changed files and line ranges to `docs/修改日志.md`, commit the temporary branch, fast-forward `codex/unified-player`, remove the temporary worktree and branch, and verify the final branch is clean.
