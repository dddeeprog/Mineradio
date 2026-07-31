'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');

let listenOnAvailablePort;
try {
  ({ listenOnAvailablePort } = require('../server/listener'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function occupyPreferredPort() {
  for (let port = 41000; port < 42000; port += 1) {
    const server = net.createServer();
    try {
      await listen(server, port);
      return { port, server };
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    }
  }
  throw new Error('No preferred test port was available.');
}

test('concurrent starters atomically retry an occupied preferred port', async (t) => {
  assert.equal(typeof listenOnAvailablePort, 'function');
  const blocker = await occupyPreferredPort();
  const first = net.createServer();
  const second = net.createServer();
  t.after(async () => {
    await Promise.all([close(first), close(second), close(blocker.server)]);
  });

  const ports = await Promise.all([
    listenOnAvailablePort(first, {
      host: '127.0.0.1',
      preferredPort: blocker.port,
      maxAttempts: 8,
    }),
    listenOnAvailablePort(second, {
      host: '127.0.0.1',
      preferredPort: blocker.port,
      maxAttempts: 8,
    }),
  ]);

  assert.equal(new Set(ports).size, 2);
  assert.deepEqual(ports, [first.address().port, second.address().port]);
  assert.ok(ports.every(port => port > blocker.port));
});

test('successful atomic listen returns the actual assigned port and cleans attempt listeners', async (t) => {
  assert.equal(typeof listenOnAvailablePort, 'function');
  const server = net.createServer();
  t.after(() => close(server));

  const port = await listenOnAvailablePort(server, {
    host: '127.0.0.1',
    preferredPort: 0,
    maxAttempts: 1,
  });

  assert.equal(port, server.address().port);
  assert.ok(port > 0);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('listening'), 0);
});

test('bounded listen failure rejects and removes attempt listeners', async (t) => {
  assert.equal(typeof listenOnAvailablePort, 'function');
  const blocker = await occupyPreferredPort();
  const server = net.createServer();
  t.after(async () => {
    await close(server);
    await close(blocker.server);
  });

  await assert.rejects(
    listenOnAvailablePort(server, {
      host: '127.0.0.1',
      preferredPort: blocker.port,
      maxAttempts: 1,
    }),
    error => error && error.code === 'EADDRINUSE',
  );
  assert.equal(server.listening, false);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('listening'), 0);
});
