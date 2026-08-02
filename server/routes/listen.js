/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
'use strict';

const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

function routeError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
    req.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        fail(routeError('REQUEST_BODY_TOO_LARGE', 413));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {
        reject(routeError('INVALID_JSON', 400));
        return;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        reject(routeError('INVALID_JSON', 400));
        return;
      }
      resolve(value);
    });
    req.on('error', () => fail(routeError('INVALID_REQUEST_BODY', 400)));
  });
}

function publicResult(value) {
  const reportedCapabilities = Array.isArray(value && value.reportedCapabilities)
    ? value.reportedCapabilities.filter(
      (capability, index, list) => (
        ['recentPlayReport', 'listenDurationReport'].includes(capability)
        && list.indexOf(capability) === index
      ),
    )
    : [];
  return {
    accepted: value && value.accepted === true,
    localRecorded: value && value.localRecorded === true,
    completeness: value && ['complete', 'partial', 'unsupported'].includes(value.completeness)
      ? value.completeness
      : 'partial',
    status: value && ['pending', 'submitted', 'unsupported', 'uncertain'].includes(value.status)
      ? value.status
      : 'pending',
    duplicate: value && value.duplicate === true,
    reportedCapabilities,
  };
}

function createListenRoutes(options) {
  options = options || {};
  const sendJSON = options.sendJSON;
  const reporter = options.reporter;
  const maxBodyBytes = Number.isSafeInteger(options.maxBodyBytes)
    ? options.maxBodyBytes
    : DEFAULT_MAX_BODY_BYTES;
  if (typeof sendJSON !== 'function') throw new TypeError('sendJSON is required');
  if (!reporter || typeof reporter.report !== 'function') {
    throw new TypeError('reporter is required');
  }

  return Object.freeze({
    async handleRoute(pathname, req, res) {
      if (pathname !== '/api/listen/report') return false;
      try {
        const body = await readJsonBody(req, maxBodyBytes);
        const result = publicResult(await reporter.report(body));
        sendJSON(res, result, result.status === 'pending' ? 202 : 200);
      } catch (error) {
        const status = Number.isInteger(error && error.status)
          && error.status >= 400
          && error.status <= 599
          ? error.status
          : 400;
        const code = typeof (error && error.code) === 'string'
          && /^[A-Z0-9_]{1,64}$/.test(error.code)
          ? error.code
          : 'LISTEN_REPORT_REJECTED';
        const failure = { accepted: false, error: code };
        if (code === 'LISTEN_JOURNAL_CAPACITY') {
          failure.localRecorded = false;
          failure.retryable = true;
        } else if (code === 'LISTEN_JOURNAL_CAPACITY_EXCEEDED') {
          failure.localRecorded = true;
          failure.completeness = 'partial';
          failure.status = 'pending';
          failure.retryable = true;
        }
        sendJSON(res, failure, status);
      }
      return true;
    },
  });
}

module.exports = {
  createListenRoutes,
};
