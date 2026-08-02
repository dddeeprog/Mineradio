'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '..');
const safetyModule = path.join(root, 'server', 'process-stream-safety.js');

test('server installs process output guards before handling requests', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.equal(fs.existsSync(safetyModule), true);
  assert.match(source, /require\('\.\/server\/process-stream-safety'\)/);
  assert.match(source, /installProcessOutputGuards\(\)/);
});

test('output guard ignores EPIPE and remains idempotent', () => {
  assert.equal(fs.existsSync(safetyModule), true);
  if (!fs.existsSync(safetyModule)) return;
  const { installBrokenPipeGuard } = require(safetyModule);
  const stream = new EventEmitter();

  assert.equal(installBrokenPipeGuard(stream), true);
  assert.equal(installBrokenPipeGuard(stream), false);
  assert.equal(stream.listenerCount('error'), 1);
  assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' })));
});

test('output guard does not hide unexpected stream errors', () => {
  assert.equal(fs.existsSync(safetyModule), true);
  if (!fs.existsSync(safetyModule)) return;
  const { installBrokenPipeGuard } = require(safetyModule);
  const stream = new EventEmitter();
  installBrokenPipeGuard(stream);

  assert.throws(
    () => stream.emit('error', Object.assign(new Error('disk failure'), { code: 'EIO' })),
    /disk failure/
  );
});

test('process output guard covers both standard streams', () => {
  assert.equal(fs.existsSync(safetyModule), true);
  if (!fs.existsSync(safetyModule)) return;
  const { installProcessOutputGuards } = require(safetyModule);
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  assert.deepEqual(installProcessOutputGuards({ stdout, stderr }), {
    stdout: true,
    stderr: true,
  });
  assert.equal(stdout.listenerCount('error'), 1);
  assert.equal(stderr.listenerCount('error'), 1);
});
