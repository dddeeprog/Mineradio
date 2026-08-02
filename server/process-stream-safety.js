'use strict';

const guardedStreams = new WeakSet();

function installBrokenPipeGuard(stream) {
  if (!stream || typeof stream.on !== 'function' || guardedStreams.has(stream)) return false;
  guardedStreams.add(stream);
  stream.on('error', error => {
    if (error && error.code === 'EPIPE') return;
    throw error;
  });
  return true;
}

function installProcessOutputGuards(processLike = process) {
  return {
    stdout: installBrokenPipeGuard(processLike && processLike.stdout),
    stderr: installBrokenPipeGuard(processLike && processLike.stderr),
  };
}

module.exports = {
  installBrokenPipeGuard,
  installProcessOutputGuards,
};
