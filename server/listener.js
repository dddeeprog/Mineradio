'use strict';

function listenOnAvailablePort(server, options = {}) {
  if (!server || typeof server.listen !== 'function' || typeof server.address !== 'function') {
    return Promise.reject(new TypeError('A listen-capable server is required.'));
  }

  const host = options.host || '127.0.0.1';
  const preferredPort = Number(options.preferredPort);
  const maxAttempts = Number(options.maxAttempts);
  if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65535) {
    return Promise.reject(new RangeError('preferredPort must be an integer between 0 and 65535.'));
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    return Promise.reject(new RangeError('maxAttempts must be a positive integer.'));
  }

  return new Promise((resolve, reject) => {
    let attempt = 0;

    function tryListen() {
      const candidatePort = preferredPort === 0 ? 0 : preferredPort + attempt;
      if (candidatePort > 65535) {
        reject(new RangeError('No candidate ports remain in the configured range.'));
        return;
      }

      let settled = false;
      function cleanup() {
        server.removeListener('error', onError);
        server.removeListener('listening', onListening);
      }
      function onListening() {
        if (settled) return;
        settled = true;
        cleanup();
        const address = server.address();
        if (!address || typeof address !== 'object' || !Number.isInteger(address.port)) {
          reject(new Error('Listening server did not expose an actual port.'));
          return;
        }
        resolve(address.port);
      }
      function onError(error) {
        if (settled) return;
        settled = true;
        cleanup();
        const retryable = error && (error.code === 'EADDRINUSE' || error.code === 'EACCES');
        attempt += 1;
        if (retryable && attempt < maxAttempts) {
          setImmediate(tryListen);
          return;
        }
        reject(error);
      }

      server.once('error', onError);
      server.once('listening', onListening);
      try {
        server.listen(candidatePort, host);
      } catch (error) {
        onError(error);
      }
    }

    tryListen();
  });
}

module.exports = {
  listenOnAvailablePort,
};
