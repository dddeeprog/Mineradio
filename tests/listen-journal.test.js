'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const {
  LISTEN_JOURNAL_SCHEMA,
  createListenJournal,
} = require('../server/platform/listen-journal');

const execFileAsync = promisify(execFile);

function tempJournal(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-listen-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'listen-journal.json');
  return {
    directory,
    filePath,
    journal: createListenJournal({ filePath, ...options }),
  };
}

function entry(sessionId, overrides) {
  return {
    key: `netease:scope:${sessionId}`,
    provider: 'netease',
    accountScope: 'scope',
    sessionId,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastErrorCode: '',
    createdAt: 1_000,
    updatedAt: 1_000,
    event: {
      sessionId,
      catalogProvider: 'netease',
      playbackProvider: 'netease',
      resolutionMode: 'direct',
      completeness: 'partial',
      sourceIds: { netease: '101' },
      catalogSourceId: '101',
      playbackSourceId: '101',
      listenMs: 45_000,
      durationMs: 100_000,
      completion: { completed: false, ratio: 0.45 },
      playedAt: 1_000,
      context: null,
    },
    ...overrides,
  };
}

test('migrates legacy v1 entries and persists the current schema', async t => {
  const { filePath, journal } = tempJournal(t);
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    entries: {
      legacy: entry('legacy', { key: undefined }),
    },
  }));

  const loaded = await journal.load();
  assert.equal(loaded.version, LISTEN_JOURNAL_SCHEMA);
  assert.equal(Object.keys(loaded.entries).length, 1);
  assert.equal((await journal.get('netease:scope:legacy')).sessionId, 'legacy');
  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).version, LISTEN_JOURNAL_SCHEMA);
});

test('migrates the upstream v1 submitted shape without credentials or raw fingerprints', async t => {
  const { filePath, journal } = tempJournal(t, {
    clock: () => 13_000,
  });
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    entries: {
      'netease:0123456789abcdef:legacy-session': {
        provider: 'netease',
        songId: '9988',
        submittedAt: 12_345,
        accountDurationSync: 'submitted_unverified',
        historySynced: false,
        cookie: 'SECRET_SENTINEL',
      },
    },
  }));

  const loaded = await journal.load();
  const migrated = loaded.entries['netease:0123456789abcdef:legacy-session'];
  assert.equal(migrated.status, 'submitted');
  assert.equal(migrated.sessionId, 'legacy-session');
  assert.equal(migrated.event.playbackSourceId, '9988');
  assert.equal(migrated.event.completeness, 'complete');
  assert.doesNotMatch(JSON.stringify(loaded), /SECRET_SENTINEL/);
});

test('uses same-directory atomic temp writes and preserves the old main on rename failure', async t => {
  const { filePath, journal } = tempJournal(t);
  await journal.put(entry('old'));
  const oldMain = fs.readFileSync(filePath, 'utf8');
  const failingFs = {
    ...fs,
    promises: {
      ...fs.promises,
      rename: async () => {
        const error = new Error('rename failed SECRET_SENTINEL');
        error.code = 'EACCES';
        throw error;
      },
    },
  };
  const failing = createListenJournal({ filePath, fs: failingFs });

  await assert.rejects(() => failing.put(entry('new')), /JOURNAL_WRITE_FAILED/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), oldMain);
  assert.equal(fs.readdirSync(path.dirname(filePath)).some(name => name.includes('.tmp-')), false);
});

test('main file wins over temps and one valid orphan temp recovers only when main is absent', async t => {
  const { directory, filePath, journal } = tempJournal(t);
  await journal.put(entry('main'));
  fs.writeFileSync(`${filePath}.tmp-stale`, JSON.stringify({
    version: LISTEN_JOURNAL_SCHEMA,
    entries: { stale: entry('stale') },
  }));
  const loaded = await createListenJournal({ filePath }).load();
  assert.equal(Object.keys(loaded.entries).length, 1);
  assert.ok(loaded.entries['netease:scope:main']);
  assert.equal(fs.existsSync(`${filePath}.tmp-stale`), false);

  fs.rmSync(filePath);
  fs.writeFileSync(`${filePath}.tmp-recover`, JSON.stringify({
    version: LISTEN_JOURNAL_SCHEMA,
    entries: { recover: entry('recover') },
  }));
  const recovered = await createListenJournal({ filePath }).load();
  assert.ok(recovered.entries['netease:scope:recover']);
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.readdirSync(directory).some(name => name.includes('.tmp-')), false);

  fs.rmSync(filePath);
  fs.writeFileSync(`${filePath}.tmp-a`, '{"version":2');
  fs.writeFileSync(`${filePath}.tmp-b`, JSON.stringify({
    version: LISTEN_JOURNAL_SCHEMA,
    entries: { untrusted: entry('untrusted') },
  }));
  const closed = await createListenJournal({ filePath }).load();
  assert.equal(closed.entries['netease:scope:untrusted'].sessionId, 'untrusted');
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.readdirSync(directory).some(name => name.includes('.tmp-')), false);
});

test('enforces count and UTF-8 byte budgets without evicting existing entries', async t => {
  const { filePath, journal } = tempJournal(t, {
    clock: () => 5_000,
    maxEntries: 3,
    maxBytes: 3_600,
  });
  await journal.put(entry('pending', { updatedAt: 1_000 }));
  await journal.put(entry('old-complete', {
    status: 'submitted',
    updatedAt: 2_000,
  }));
  await journal.put(entry('new-complete', {
    status: 'submitted',
    updatedAt: 4_000,
  }));
  await assert.rejects(
    () => journal.put(entry('unsupported', {
      status: 'unsupported',
      updatedAt: 3_000,
    })),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY',
  );

  const loaded = await createListenJournal({
    filePath,
    clock: () => 5_000,
    maxEntries: 3,
    maxBytes: 3_600,
  }).load();
  assert.deepEqual(Object.keys(loaded.entries).sort(), [
    'netease:scope:new-complete',
    'netease:scope:old-complete',
    'netease:scope:pending',
  ]);
  assert.ok(Buffer.byteLength(fs.readFileSync(filePath, 'utf8'), 'utf8') <= 3_600);
  await assert.rejects(
    () => journal.put(entry('oversize', {
      event: { ...entry('oversize').event, context: { type: 'x'.repeat(5_000) } },
    })),
    /JOURNAL_ENTRY_INVALID|JOURNAL_BUDGET_EXCEEDED/,
  );
});

test('persists bounded exponential retry state across restart', async t => {
  let now = 10_000;
  const { filePath, journal } = tempJournal(t, {
    clock: () => now,
    baseRetryMs: 1_000,
    maxRetryMs: 4_000,
  });
  await journal.put(entry('retry', { createdAt: now, updatedAt: now }));
  await journal.markFailure('netease:scope:retry', 'PROVIDER_FAILED');
  let saved = await journal.get('netease:scope:retry');
  assert.equal(saved.attempts, 1);
  assert.equal(saved.nextAttemptAt, 11_000);
  now = 11_000;
  await journal.markFailure('netease:scope:retry', 'UNKNOWN_SECRET_SENTINEL');
  now = 13_000;
  await journal.markFailure('netease:scope:retry', 'PROVIDER_FAILED');
  now = 17_000;
  await journal.markFailure('netease:scope:retry', 'PROVIDER_FAILED');

  const restarted = createListenJournal({
    filePath,
    clock: () => now,
    baseRetryMs: 1_000,
    maxRetryMs: 4_000,
  });
  saved = await restarted.get('netease:scope:retry');
  assert.equal(saved.attempts, 4);
  assert.equal(saved.nextAttemptAt, 21_000);
  assert.equal(saved.lastErrorCode, 'PROVIDER_FAILED');
  assert.deepEqual((await restarted.due()).map(item => item.sessionId), []);
  now = 21_000;
  assert.deepEqual((await restarted.due()).map(item => item.sessionId), ['retry']);
  assert.doesNotMatch(JSON.stringify(await restarted.snapshot()), /SECRET_SENTINEL/);
});

test('serializes concurrent duplicate updates without corrupting the journal', async t => {
  const { filePath, journal } = tempJournal(t);
  await Promise.all(Array.from({ length: 12 }, () => journal.put(entry('same'))));
  await Promise.all(Array.from({ length: 6 }, () => (
    journal.markSubmitted('netease:scope:same')
  )));
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.equal(Object.keys(saved.entries).length, 1);
  assert.equal(saved.entries['netease:scope:same'].status, 'submitted');
});

test('put atomically rejects a different digest for an existing session key', async t => {
  const { filePath } = tempJournal(t);
  const first = createListenJournal({ filePath });
  const second = createListenJournal({ filePath });
  const left = entry('atomic-digest');
  const right = entry('atomic-digest', {
    event: {
      ...left.event,
      listenMs: left.event.listenMs + 1,
    },
  });

  const results = await Promise.allSettled([
    first.put(left),
    second.put(right),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejection = results.find(result => result.status === 'rejected');
  assert.equal(rejection.reason.code, 'LISTEN_SESSION_CONFLICT');
  assert.equal(rejection.reason.status, 409);
  assert.equal(Object.keys((await first.snapshot()).entries).length, 1);
});

test('atomically claims one provider execution across journal instances and rejects digest conflicts', async t => {
  const { filePath, journal: first } = tempJournal(t);
  const second = createListenJournal({ filePath });
  const stored = await first.put(entry('claimed-once'));

  const [left, right] = await Promise.all([
    first.claim(stored.key, stored.eventDigest, 'reporter-left'),
    second.claim(stored.key, stored.eventDigest, 'reporter-right'),
  ]);
  assert.equal([left, right].filter(result => result.acquired).length, 1);
  assert.equal([left, right].filter(result => !result.acquired).length, 1);
  assert.equal((await first.get(stored.key)).status, 'claimed');

  await assert.rejects(
    () => second.claim(stored.key, 'f'.repeat(64), 'reporter-conflict'),
    error => error && error.code === 'LISTEN_SESSION_CONFLICT' && error.status === 409,
  );
});

test('recovers only reserved claims while started provider calls become terminal uncertain', async t => {
  let now = 10_000;
  const { filePath, journal } = tempJournal(t, {
    clock: () => now,
    claimLeaseMs: 1_000,
  });
  const reservedEntry = await journal.put(entry('reserved-recovery'));
  const reserved = await journal.claim(
    reservedEntry.key,
    reservedEntry.eventDigest,
    'reserved-owner',
  );
  assert.equal(reserved.acquired, true);

  now = 11_001;
  assert.deepEqual(
    (await createListenJournal({
      filePath,
      clock: () => now,
      claimLeaseMs: 1_000,
    }).due()).map(item => item.sessionId),
    ['reserved-recovery'],
  );

  const reclaimed = await journal.claim(
    reservedEntry.key,
    reservedEntry.eventDigest,
    'started-owner',
  );
  assert.equal(reclaimed.acquired, true);
  await journal.markClaimStarted(reservedEntry.key, reclaimed.token);

  now = 20_000;
  const restarted = createListenJournal({
    filePath,
    clock: () => now,
    claimLeaseMs: 1_000,
  });
  assert.deepEqual(await restarted.due(), []);
  const uncertain = await restarted.get(reservedEntry.key);
  assert.equal(uncertain.status, 'uncertain');
  assert.equal(uncertain.lastErrorCode, 'PROVIDER_UNCERTAIN');
});

test('rejects a new pending entry at count capacity without deleting durable pending work', async t => {
  const { filePath, journal } = tempJournal(t, { maxEntries: 2 });
  await journal.put(entry('p1'));
  await journal.put(entry('p2'));
  const oldMain = fs.readFileSync(filePath, 'utf8');

  await assert.rejects(
    () => journal.put(entry('p3')),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY' && error.status === 503,
  );
  assert.equal(fs.readFileSync(filePath, 'utf8'), oldMain);

  const restarted = createListenJournal({ filePath, maxEntries: 2 });
  assert.deepEqual(
    Object.values((await restarted.snapshot()).entries).map(item => item.sessionId).sort(),
    ['p1', 'p2'],
  );
});

test('terminal tombstones consume bounded capacity and are never evicted for a new session', async t => {
  const { filePath, journal } = tempJournal(t, { maxEntries: 1 });
  await journal.put(entry('terminal-one'));
  await journal.markSubmitted('netease:scope:terminal-one');
  const original = fs.readFileSync(filePath);

  await assert.rejects(
    () => journal.put(entry('must-be-rejected')),
    error => (
      error
      && error.code === 'LISTEN_JOURNAL_CAPACITY'
      && error.status === 503
    ),
  );
  assert.deepEqual(fs.readFileSync(filePath), original);

  const restarted = createListenJournal({ filePath, maxEntries: 1 });
  const terminal = await restarted.get('netease:scope:terminal-one');
  assert.equal(terminal.status, 'submitted');
  assert.equal(await restarted.get('netease:scope:must-be-rejected'), null);
});

test('terminal tombstones expire only after the configured idempotency window', async t => {
  let now = 1_000;
  const { filePath, journal } = tempJournal(t, {
    maxEntries: 1,
    clock: () => now,
    terminalRetentionMs: 1_000,
  });
  await journal.put(entry('window-one', {
    createdAt: now,
    updatedAt: now,
  }));
  await journal.markSubmitted('netease:scope:window-one');
  const protectedMain = fs.readFileSync(filePath);

  now = 1_999;
  await assert.rejects(
    () => journal.put(entry('window-two', {
      createdAt: now,
      updatedAt: now,
    })),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY',
  );
  assert.deepEqual(fs.readFileSync(filePath), protectedMain);
  assert.equal((await journal.get('netease:scope:window-one')).status, 'submitted');

  now = 500;
  await assert.rejects(
    () => journal.put(entry('clock-rollback', {
      createdAt: now,
      updatedAt: now,
    })),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY',
  );

  now = 2_000;
  await journal.put(entry('window-two', {
    createdAt: now,
    updatedAt: now,
  }));
  assert.equal(await journal.get('netease:scope:window-one'), null);
  assert.equal((await journal.get('netease:scope:window-two')).status, 'pending');

  const restarted = createListenJournal({
    filePath,
    maxEntries: 1,
    clock: () => now,
    terminalRetentionMs: 1_000,
  });
  assert.deepEqual(
    Object.values((await restarted.snapshot()).entries).map(item => item.sessionId),
    ['window-two'],
  );
});

test('uncertain tombstones expire atomically after the idempotency window', async t => {
  let now = 1_000;
  const { filePath, journal } = tempJournal(t, {
    maxEntries: 1,
    clock: () => now,
    terminalRetentionMs: 1_000,
  });
  const pending = await journal.put(entry('uncertain-window', {
    createdAt: now,
    updatedAt: now,
  }));
  const claim = await journal.claim(
    pending.key,
    pending.eventDigest,
    'uncertain-owner',
  );
  await journal.markClaimStarted(pending.key, claim.token, 100);
  await journal.markUncertain(pending.key, claim.token, 'PROVIDER_UNCERTAIN');

  now = 1_999;
  await assert.rejects(
    () => journal.put(entry('uncertain-blocked', {
      createdAt: now,
      updatedAt: now,
    })),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY',
  );
  assert.equal((await journal.get(pending.key)).status, 'uncertain');

  now = 2_000;
  await journal.put(entry('uncertain-replacement', {
    createdAt: now,
    updatedAt: now,
  }));
  assert.equal(await journal.get(pending.key), null);
  assert.equal(
    (await createListenJournal({
      filePath,
      maxEntries: 1,
      clock: () => now,
      terminalRetentionMs: 1_000,
    }).get('netease:scope:uncertain-replacement')).status,
    'pending',
  );
});

test('terminal age uses a persisted monotonic clock across rollback and huge forward jumps', async t => {
  let now = 5_000;
  const { filePath, journal } = tempJournal(t, {
    maxEntries: 1,
    clock: () => now,
    terminalRetentionMs: 1_000,
    maxClockAdvanceMs: 100,
  });
  await journal.put(entry('monotonic-terminal', {
    createdAt: now,
    updatedAt: now,
  }));

  now = 0;
  await journal.markSubmitted('netease:scope:monotonic-terminal');
  now = 5_001;
  assert.equal(
    (await journal.snapshot()).entries['netease:scope:monotonic-terminal'].status,
    'submitted',
  );
  let persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.ok(persisted.highWaterAt >= 5_001);
  assert.ok(persisted.acceptedObservedAt >= 5_001);

  const restarted = createListenJournal({
    filePath,
    maxEntries: 1,
    clock: () => now,
    terminalRetentionMs: 1_000,
    maxClockAdvanceMs: 100,
  });
  assert.equal(
    (await restarted.snapshot()).entries['netease:scope:monotonic-terminal'].status,
    'submitted',
  );

  now = 9_000_000_000_000;
  assert.equal(
    (await restarted.snapshot()).entries['netease:scope:monotonic-terminal'].status,
    'submitted',
  );
  persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.ok(persisted.highWaterAt <= 5_101);
  assert.equal(persisted.acceptedObservedAt, 5_001);
  assert.equal(persisted.suspectObservedAt, now);

  const futureRestart = createListenJournal({
    filePath,
    maxEntries: 1,
    clock: () => now,
    terminalRetentionMs: 1_000,
    maxClockAdvanceMs: 100,
  });
  assert.equal(
    (await futureRestart.snapshot()).entries['netease:scope:monotonic-terminal'].status,
    'submitted',
  );
});

test('future event timestamps never raise the trusted journal clock', async t => {
  const future = 9_000_000_000_000;
  const { filePath, journal } = tempJournal(t, {
    clock: () => 5_000,
    terminalRetentionMs: 1_000,
    maxClockAdvanceMs: 100,
  });
  const stored = await journal.put(entry('future-event-time', {
    createdAt: future,
    updatedAt: future,
    event: {
      ...entry('future-event-time').event,
      playedAt: future,
    },
  }));

  assert.equal(stored.createdAt, 5_000);
  assert.equal(stored.updatedAt, 5_000);
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.highWaterAt, 5_000);
  assert.equal(persisted.acceptedObservedAt, 5_000);
  assert.equal(persisted.entries[stored.key].event.playedAt, future);
});

test('loaded future entry timestamps are clamped without rewriting event playback time', async t => {
  const future = 9_000_000_000_000;
  const { filePath, journal } = tempJournal(t, {
    clock: () => 5_000,
    terminalRetentionMs: 1_000,
    maxClockAdvanceMs: 100,
  });
  const futureEntry = entry('loaded-future-time', {
    status: 'submitted',
    createdAt: future,
    updatedAt: future,
    event: {
      ...entry('loaded-future-time').event,
      completeness: 'complete',
      playedAt: future,
    },
  });
  fs.writeFileSync(filePath, JSON.stringify({
    version: LISTEN_JOURNAL_SCHEMA,
    highWaterAt: 5_000,
    acceptedObservedAt: 5_000,
    suspectObservedAt: 0,
    recoveryObservedAt: 0,
    entries: { [futureEntry.key]: futureEntry },
  }));

  const loaded = await journal.snapshot();
  assert.equal(loaded.highWaterAt, 5_000);
  assert.equal(loaded.entries[futureEntry.key].createdAt, 5_000);
  assert.equal(loaded.entries[futureEntry.key].updatedAt, 5_000);
  assert.equal(loaded.entries[futureEntry.key].event.playedAt, future);
});

test('a future spike converges from the stable baseline after rollback and restart', async t => {
  let now = 5_000;
  const options = {
    maxEntries: 1,
    clock: () => now,
    terminalRetentionMs: 1_000,
    maxClockAdvanceMs: 100,
    trustedOfflineWindowMs: 2_000,
  };
  const { filePath, journal } = tempJournal(t, options);
  const pending = await journal.put(entry('future-spike', {
    createdAt: now,
    updatedAt: now,
  }));

  now = 9_000_000_000_000;
  await journal.snapshot();
  let persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.acceptedObservedAt, 5_000);
  assert.ok(persisted.highWaterAt <= 5_100);
  await journal.markSubmitted(pending.key);
  const submitted = await journal.get(pending.key);
  assert.equal(submitted.status, 'submitted');
  assert.ok(submitted.updatedAt <= persisted.highWaterAt);

  now = 10_000;
  const firstRestart = createListenJournal({ filePath, ...options });
  assert.equal((await firstRestart.snapshot()).entries[pending.key].status, 'submitted');

  let converged = false;
  for (let index = 0; index < 60; index += 1) {
    const restarted = createListenJournal({ filePath, ...options });
    await restarted.snapshot();
    persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (persisted.acceptedObservedAt === now) {
      converged = true;
      break;
    }
  }
  assert.equal(converged, true);
  assert.equal(persisted.highWaterAt >= now, true);
  assert.equal(persisted.suspectObservedAt, 0);
});

test('repeated suspect clock spikes never consume terminal retention time', async t => {
  const initial = 5_000;
  let now = initial;
  const options = {
    maxEntries: 1,
    clock: () => now,
    terminalRetentionMs: 1_000,
    maxClockAdvanceMs: 100,
    trustedOfflineWindowMs: 2_000,
  };
  const { filePath, journal } = tempJournal(t, options);
  const pending = await journal.put(entry('repeated-clock-spike', {
    createdAt: now,
    updatedAt: now,
  }));
  await journal.markSubmitted(pending.key);

  for (let index = 1; index <= 30; index += 1) {
    now = 9_000_000_000_000;
    await journal.snapshot();
    now = initial + index;
    await journal.snapshot();
  }

  const snapshot = await journal.snapshot();
  assert.equal(snapshot.entries[pending.key].status, 'submitted');
  const duplicate = await journal.put(entry('repeated-clock-spike', {
    createdAt: now,
    updatedAt: now,
  }));
  assert.equal(duplicate.key, pending.key);
  const claim = await journal.claim(pending.key, pending.eventDigest, 'repeat-owner');
  assert.equal(claim.acquired, false);

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.highWaterAt, initial + 30);
  assert.equal(persisted.acceptedObservedAt, initial + 30);
});

test('trusted offline time expires terminal work once while a 365-day spike stays suspect', async t => {
  const day = 24 * 60 * 60 * 1_000;
  const retention = 30 * day;
  let now = 10_000;
  const { filePath, journal } = tempJournal(t, {
    clock: () => now,
    terminalRetentionMs: retention,
    maxClockAdvanceMs: day,
  });
  const pending = await journal.put(entry('offline-uncertain', {
    createdAt: now,
    updatedAt: now,
  }));
  const claim = await journal.claim(pending.key, pending.eventDigest, 'offline-owner');
  await journal.markClaimStarted(pending.key, claim.token);
  await journal.markUncertain(pending.key, claim.token, 'PROVIDER_UNCERTAIN');

  now += retention;
  const offlineRestart = createListenJournal({
    filePath,
    clock: () => now,
    terminalRetentionMs: retention,
    maxClockAdvanceMs: day,
  });
  assert.equal((await offlineRestart.snapshot()).entries[pending.key], undefined);

  now = 20_000;
  const spike = tempJournal(t, {
    clock: () => now,
    terminalRetentionMs: retention,
    maxClockAdvanceMs: day,
  });
  await spike.journal.put(entry('year-spike', {
    createdAt: now,
    updatedAt: now,
  }));
  await spike.journal.markSubmitted('netease:scope:year-spike');
  now += 365 * day;
  const spikeRestart = createListenJournal({
    filePath: spike.filePath,
    clock: () => now,
    terminalRetentionMs: retention,
    maxClockAdvanceMs: day,
  });
  const snapshot = await spikeRestart.snapshot();
  assert.equal(snapshot.entries['netease:scope:year-spike'].status, 'submitted');
  const spikeState = JSON.parse(fs.readFileSync(spike.filePath, 'utf8'));
  assert.ok(spikeState.highWaterAt <= 20_000 + day);
  assert.equal(spikeState.acceptedObservedAt, 20_000);
  assert.equal(spikeState.suspectObservedAt, now);
});

test('retains terminal entries and rejects count or byte overflow atomically across restart', async t => {
  const count = tempJournal(t, { maxEntries: 2 });
  await count.journal.put(entry('required'));
  await count.journal.put(entry('terminal'));
  await count.journal.markSubmitted('netease:scope:terminal');
  await assert.rejects(
    () => count.journal.put(entry('new-required')),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY',
  );
  assert.deepEqual(
    Object.values((await count.journal.snapshot()).entries).map(item => item.sessionId).sort(),
    ['required', 'terminal'],
  );

  const bytes = tempJournal(t, { maxBytes: 1_200 });
  await bytes.journal.put(entry('byte-p1', {
    event: {
      ...entry('byte-p1').event,
      catalogSourceId: 'a'.repeat(128),
      playbackSourceId: '101',
      sourceIds: { netease: '101' },
      context: { playlistId: 'b'.repeat(128) },
    },
  }));
  const oldMain = fs.readFileSync(bytes.filePath, 'utf8');
  await assert.rejects(
    () => bytes.journal.put(entry('byte-p2', {
      event: {
        ...entry('byte-p2').event,
        catalogSourceId: 'c'.repeat(128),
        playbackSourceId: '102',
        sourceIds: { netease: '102' },
        context: { playlistId: 'd'.repeat(128) },
      },
    })),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY',
  );
  assert.equal(fs.readFileSync(bytes.filePath, 'utf8'), oldMain);
  const restarted = createListenJournal({ filePath: bytes.filePath, maxBytes: 1_200 });
  assert.equal((await restarted.snapshot()).entries['netease:scope:byte-p1'].sessionId, 'byte-p1');
});

test('fails closed when a valid pending main exceeds a smaller restart byte budget', async t => {
  const { filePath, journal } = tempJournal(t, { maxBytes: 4_096 });
  await journal.put(entry('large-pending', {
    event: {
      ...entry('large-pending').event,
      catalogSourceId: '1'.repeat(128),
      playbackSourceId: '2'.repeat(128),
      sourceIds: { netease: '2'.repeat(128) },
      context: {
        type: 'playlist',
        source: 'home',
        playlistId: 'p'.repeat(128),
        radioId: 'r'.repeat(128),
        position: 1,
      },
    },
  }));
  const original = fs.readFileSync(filePath);
  const originalHash = crypto.createHash('sha256').update(original).digest('hex');
  assert.ok(original.length > 512);

  const constrained = createListenJournal({ filePath, maxBytes: 512 });
  for (const operation of [
    () => constrained.load(),
    () => constrained.put(entry('must-not-overwrite')),
    () => constrained.due(),
  ]) {
    await assert.rejects(
      operation,
      error => (
        error
        && error.code === 'LISTEN_JOURNAL_CAPACITY_EXCEEDED'
        && error.status === 503
      ),
    );
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
      originalHash,
    );
  }
});

test('fails closed when pending or terminal count exceeds a smaller restart limit', async t => {
  const blocked = tempJournal(t, { maxEntries: 3 });
  await blocked.journal.put(entry('count-p1'));
  await blocked.journal.put(entry('count-p2'));
  const blockedMain = fs.readFileSync(blocked.filePath);
  const blockedHash = crypto.createHash('sha256').update(blockedMain).digest('hex');
  const constrained = createListenJournal({
    filePath: blocked.filePath,
    maxEntries: 1,
  });
  await assert.rejects(
    () => constrained.load(),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY_EXCEEDED',
  );
  await assert.rejects(
    () => constrained.markSubmitted('netease:scope:count-p1'),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY_EXCEEDED',
  );
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(blocked.filePath)).digest('hex'),
    blockedHash,
  );

  const compactable = tempJournal(t, { maxEntries: 2 });
  await compactable.journal.put(entry('required-pending'));
  await compactable.journal.put(entry('old-terminal'));
  await compactable.journal.markSubmitted('netease:scope:old-terminal');
  const compactableMain = fs.readFileSync(compactable.filePath);
  const compactableHash = crypto.createHash('sha256').update(compactableMain).digest('hex');
  await assert.rejects(
    () => createListenJournal({
    filePath: compactable.filePath,
    maxEntries: 1,
    }).load(),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY_EXCEEDED',
  );
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(compactable.filePath)).digest('hex'),
    compactableHash,
  );
});

test('reloads and merges under a cross-process lock before writing stale state', async t => {
  const { filePath, journal } = tempJournal(t);
  await journal.load();
  const modulePath = path.join(__dirname, '..', 'server', 'platform', 'listen-journal.js');
  const childEntry = entry('child-pending');
  await execFileAsync(process.execPath, [
    '-e',
    [
      "const { createListenJournal } = require(process.argv[1]);",
      'const value = JSON.parse(process.argv[3]);',
      'createListenJournal({ filePath: process.argv[2] }).put(value)',
      '  .then(() => process.exit(0), error => { console.error(error.code); process.exit(1); });',
    ].join(''),
    modulePath,
    filePath,
    JSON.stringify(childEntry),
  ], { windowsHide: true });

  await journal.put(entry('parent-pending'));
  const restarted = await createListenJournal({ filePath }).snapshot();
  assert.deepEqual(
    Object.values(restarted.entries).map(value => value.sessionId).sort(),
    ['child-pending', 'parent-pending'],
  );
});

test('uses unique temps for same-process instances sharing one clock tick', async t => {
  const { directory, filePath } = tempJournal(t);
  const options = { filePath, clock: () => 1_000 };
  const first = createListenJournal(options);
  const second = createListenJournal(options);

  await Promise.all([
    first.put(entry('same-tick-a')),
    second.put(entry('same-tick-b')),
  ]);
  const restarted = await createListenJournal({ filePath }).snapshot();
  assert.deepEqual(
    Object.values(restarted.entries).map(value => value.sessionId).sort(),
    ['same-tick-a', 'same-tick-b'],
  );
  assert.equal(
    fs.readdirSync(directory).some(name => name.includes('.tmp-')),
    false,
  );
});

test('times out on a live lock without overwriting and safely reclaims a stale lock', async t => {
  const { filePath, journal } = tempJournal(t);
  await journal.put(entry('durable-before-lock'));
  const original = fs.readFileSync(filePath);
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
    token: 'other-live-owner',
    pid: process.pid,
    createdAt: Date.now(),
  }));

  const blocked = createListenJournal({
    filePath,
    lockTimeoutMs: 30,
    lockRetryMs: 5,
    staleLockMs: 10_000,
  });
  await assert.rejects(
    () => blocked.put(entry('must-not-write')),
    error => error && error.code === 'LISTEN_JOURNAL_LOCK_TIMEOUT',
  );
  assert.deepEqual(fs.readFileSync(filePath), original);

  const staleAt = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, staleAt, staleAt);
  fs.utimesSync(path.join(lockPath, 'owner.json'), staleAt, staleAt);
  const staleButLive = createListenJournal({
    filePath,
    lockTimeoutMs: 30,
    lockRetryMs: 5,
    staleLockMs: 50,
  });
  await assert.rejects(
    () => staleButLive.put(entry('must-not-steal-live-lock')),
    error => error && error.code === 'LISTEN_JOURNAL_LOCK_TIMEOUT',
  );
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
    token: 'dead-stale-owner',
    pid: 99_999_999,
    createdAt: Date.now() - 60_000,
  }));
  fs.utimesSync(lockPath, staleAt, staleAt);
  fs.utimesSync(path.join(lockPath, 'owner.json'), staleAt, staleAt);
  const recovered = createListenJournal({
    filePath,
    lockTimeoutMs: 200,
    lockRetryMs: 5,
    staleLockMs: 50,
  });
  await recovered.put(entry('after-stale-lock'));
  assert.deepEqual(
    Object.values((await recovered.snapshot()).entries).map(value => value.sessionId).sort(),
    ['after-stale-lock', 'durable-before-lock'],
  );
});

test('recovers one valid temp when main is corrupt and preserves the recovery copy', async t => {
  const { directory, filePath, journal } = tempJournal(t);
  await journal.put(entry('recover-from-temp'));
  const valid = fs.readFileSync(filePath);
  const tempPath = `${filePath}.tmp-orphan-valid`;
  fs.writeFileSync(tempPath, valid);
  fs.writeFileSync(filePath, '{"version":2,"entries":');

  const recovered = await createListenJournal({ filePath }).snapshot();
  assert.equal(
    recovered.entries['netease:scope:recover-from-temp'].sessionId,
    'recover-from-temp',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(filePath, 'utf8')).version,
    LISTEN_JOURNAL_SCHEMA,
  );
  assert.equal(
    fs.readdirSync(directory).some(name => name.includes('.tmp-orphan-valid')),
    false,
  );
});

test('rechecks a capacity-degraded main after an external bounded repair', async t => {
  const { filePath, journal } = tempJournal(t, { maxBytes: 4_096 });
  await journal.put(entry('oversized-restart', {
    event: {
      ...entry('oversized-restart').event,
      catalogSourceId: '1'.repeat(128),
      playbackSourceId: '2'.repeat(128),
      sourceIds: { netease: '2'.repeat(128) },
      context: {
        playlistId: 'p'.repeat(128),
        radioId: 'r'.repeat(128),
      },
    },
  }));
  const constrained = createListenJournal({ filePath, maxBytes: 1_000 });
  await assert.rejects(
    () => constrained.load(),
    error => error && error.code === 'LISTEN_JOURNAL_CAPACITY_EXCEEDED',
  );

  fs.writeFileSync(filePath, JSON.stringify({
    version: LISTEN_JOURNAL_SCHEMA,
    entries: {},
  }));
  await constrained.put(entry('after-external-repair'));
  assert.equal(
    (await constrained.get('netease:scope:after-external-repair')).sessionId,
    'after-external-repair',
  );
});

test('deterministically recovers identical modern temps and cleans every recovery copy', async t => {
  const { directory, filePath, journal } = tempJournal(t);
  await journal.put(entry('identical-modern-temp'));
  const valid = fs.readFileSync(filePath);
  fs.rmSync(filePath);
  const firstTemp = `${filePath}.tmp-v2-100-instance-1-aaaaaaaaaaaaaaaa`;
  const secondTemp = `${filePath}.tmp-v2-200-instance-2-bbbbbbbbbbbbbbbb`;
  fs.writeFileSync(firstTemp, valid);
  fs.writeFileSync(secondTemp, valid);

  const recovered = await createListenJournal({ filePath }).load();

  assert.equal(
    recovered.entries['netease:scope:identical-modern-temp'].sessionId,
    'identical-modern-temp',
  );
  assert.equal(fs.existsSync(filePath), true);
  assert.deepEqual(
    fs.readdirSync(directory).filter(name => name.includes('.tmp-')),
    [],
  );
});

test('fails closed and preserves conflicting modern temps when main is missing', async t => {
  const { directory, filePath } = tempJournal(t);
  const firstTemp = `${filePath}.tmp-v2-100-instance-1-aaaaaaaaaaaaaaaa`;
  const secondTemp = `${filePath}.tmp-v2-200-instance-2-bbbbbbbbbbbbbbbb`;
  fs.writeFileSync(firstTemp, JSON.stringify({
    version: LISTEN_JOURNAL_SCHEMA,
    entries: { first: entry('conflict-a') },
  }));
  fs.writeFileSync(secondTemp, JSON.stringify({
    version: LISTEN_JOURNAL_SCHEMA,
    entries: { second: entry('conflict-b') },
  }));

  await assert.rejects(
    () => createListenJournal({ filePath }).load(),
    error => error && error.code === 'LISTEN_JOURNAL_CORRUPT',
  );
  assert.equal(fs.existsSync(filePath), false);
  assert.deepEqual(
    fs.readdirSync(directory)
      .filter(name => name.includes('.tmp-v2-'))
      .sort(),
    [
      path.basename(firstTemp),
      path.basename(secondTemp),
    ].sort(),
  );
});

test('valid main wins and removes validated stale modern temps on Windows-safe paths', async t => {
  const { directory, filePath, journal } = tempJournal(t);
  await journal.put(entry('authoritative-main'));
  const staleTemp = `${filePath}.tmp-v2-300-instance-3-cccccccccccccccc`;
  fs.writeFileSync(staleTemp, JSON.stringify({
    version: LISTEN_JOURNAL_SCHEMA,
    entries: { stale: entry('stale-modern-temp') },
  }));

  const loaded = await createListenJournal({ filePath }).snapshot();

  assert.deepEqual(
    Object.values(loaded.entries).map(value => value.sessionId),
    ['authoritative-main'],
  );
  assert.equal(fs.existsSync(staleTemp), false);
  assert.equal(
    fs.readdirSync(directory).some(name => name.includes('.tmp-v2-')),
    false,
  );
});

test('cleans truncated modern temps with a valid main and after successful recovery', async t => {
  const { directory, filePath, journal } = tempJournal(t);
  await journal.put(entry('main-for-truncated-temp'));
  const truncatedWithMain = `${filePath}.tmp-v2-400-instance-4-dddddddddddddddd`;
  fs.writeFileSync(truncatedWithMain, '{"version":2,"entries":');

  const loaded = createListenJournal({ filePath });
  await loaded.load();
  assert.equal(fs.existsSync(truncatedWithMain), false);
  await loaded.load();
  assert.equal(fs.existsSync(truncatedWithMain), false);

  const valid = fs.readFileSync(filePath);
  fs.rmSync(filePath);
  const recoveryTemp = `${filePath}.tmp-v2-500-instance-5-eeeeeeeeeeeeeeee`;
  const truncatedDuringRecovery = `${filePath}.tmp-v2-600-instance-6-ffffffffffffffff`;
  fs.writeFileSync(recoveryTemp, valid);
  fs.writeFileSync(truncatedDuringRecovery, '{"version":2');

  const recovered = await createListenJournal({ filePath }).load();
  assert.equal(
    recovered.entries['netease:scope:main-for-truncated-temp'].sessionId,
    'main-for-truncated-temp',
  );
  assert.deepEqual(
    fs.readdirSync(directory).filter(name => name.includes('.tmp-v2-')),
    [],
  );
});

test('never follows or deletes a modern temp symlink identity or another namespace', async t => {
  const { directory, filePath, journal } = tempJournal(t);
  await journal.put(entry('main-before-link'));
  const linkLikeTemp = `${filePath}.tmp-v2-700-instance-7-1111111111111111`;
  const otherNamespace = path.join(
    directory,
    `other-${path.basename(filePath)}.tmp-v2-800-instance-8-2222222222222222`,
  );
  fs.writeFileSync(linkLikeTemp, fs.readFileSync(filePath));
  fs.writeFileSync(otherNamespace, '{"other":"namespace"}');
  const guardedFs = {
    ...fs,
    promises: {
      ...fs.promises,
      async lstat(target) {
        if (target === linkLikeTemp) {
          return {
            isFile: () => false,
            isSymbolicLink: () => true,
          };
        }
        return fs.promises.lstat(target);
      },
    },
  };

  await createListenJournal({ filePath, fs: guardedFs }).load();

  assert.equal(fs.existsSync(linkLikeTemp), true);
  assert.equal(fs.existsSync(otherNamespace), true);
});
