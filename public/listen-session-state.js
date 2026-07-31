/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioListenSessionState = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
  'use strict';

  var PROVIDERS = ['netease', 'qq', 'kugou', 'qishui', 'spotify', 'local'];
  var MAX_LISTEN_MS = 7 * 24 * 60 * 60 * 1000;
  var OUTBOX_KEY = 'mineradio-listen-report-outbox-v1';
  var OUTBOX_LOCK_KEY = OUTBOX_KEY + '-lock';
  var OUTBOX_LOCK_EPOCH_KEY = OUTBOX_KEY + '-lock-epoch';
  var OUTBOX_SHARD_PREFIX = OUTBOX_KEY + '-writer-';
  var OUTBOX_ACK_SHARD_PREFIX = OUTBOX_KEY + '-ack-';
  var OUTBOX_CLEANUP_MARKER_PREFIX = OUTBOX_KEY + '-cleanup-';
  var LOCAL_MEDIA_SALT_KEY = 'mineradio-local-media-salt-v1';
  var LOCAL_MEDIA_SALT_LOCK_KEY = LOCAL_MEDIA_SALT_KEY + '-lock';
  var OUTBOX_MAX_COUNT = 32;
  var OUTBOX_MAX_BYTES = 128 * 1024;
  var OUTBOX_MAX_STORAGE_KEYS = 512;
  var STORAGE_KEY_SCAN_LIMIT = 128;
  var STORAGE_KEY_HARD_LIMIT = 4096;
  var STORAGE_KEY_PROOF_LIMIT = 8192;
  var STORAGE_KEY_PROOF_BYTES = 512 * 1024;
  var STORAGE_LOCK_TTL_MS = 2_000;
  var OUTBOX_SHARD_SETTLE_MS = STORAGE_LOCK_TTL_MS * 2;
  var OUTBOX_WRITER_LEASE_MS = OUTBOX_SHARD_SETTLE_MS * 2;
  var ephemeralLocalMediaSalt = '';
  var fallbackInstanceSerial = 0;
  var saltCells = typeof WeakMap === 'function' ? new WeakMap() : null;
  var fallbackSaltCell = { value: '', candidate: '', canonicalRequired: false };
  var SHA256_CONSTANTS = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function safeValue(value, key) {
    try {
      return value && value[key];
    } catch (_) {
      return undefined;
    }
  }

  function createSafeStorage(resolveValue, clock) {
    var resolver = typeof resolveValue === 'function'
      ? resolveValue
      : function() { return resolveValue; };
    var raw = null;
    var missing = false;
    var retryAt = 0;
    var failures = 0;
    var keyScanCursor = 0;
    var keyScanLength = null;
    var keyScanEpoch = 0;
    var methodFailures = {
      setItem: { retryAt: 0, failures: 0 },
      removeItem: { retryAt: 0, failures: 0 },
    };

    function safeNow() {
      try {
        return boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      } catch (_) {
        return 0;
      }
    }

    function transientFailure() {
      failures = Math.min(8, failures + 1);
      retryAt = safeNow() + Math.min(1_000, 25 * Math.pow(2, failures - 1));
    }

    function operationSuccess() {
      failures = 0;
      retryAt = 0;
    }

    function methodFailure(name) {
      var state = methodFailures[name];
      if (!state) {
        transientFailure();
        return;
      }
      state.failures = Math.min(8, state.failures + 1);
      state.retryAt = safeNow()
        + Math.min(1_000, 25 * Math.pow(2, state.failures - 1));
    }

    function methodSuccess(name) {
      var state = methodFailures[name];
      if (!state) {
        operationSuccess();
        return;
      }
      state.failures = 0;
      state.retryAt = 0;
    }

    function resolveRaw() {
      if (missing || safeNow() < retryAt) return null;
      try {
        var candidate = resolver();
        if (!candidate || (
          typeof candidate !== 'object'
          && typeof candidate !== 'function'
        )) {
          missing = true;
          raw = null;
          return null;
        }
        raw = candidate;
        return raw;
      } catch (_) {
        transientFailure();
        return null;
      }
    }

    function method(name, force) {
      var target = resolveRaw();
      if (!target) return null;
      var state = methodFailures[name];
      if (!force && state && safeNow() < state.retryAt) return null;
      try {
        var candidate = target[name];
        if (typeof candidate !== 'function') {
          missing = true;
          return null;
        }
        return { target: target, method: candidate };
      } catch (_) {
        methodFailure(name);
        return null;
      }
    }

    return {
      get raw() {
        return raw || resolveRaw();
      },
      get available() {
        return !!resolveRaw();
      },
      get unavailableCode() {
        if (missing) return 'STORAGE_UNAVAILABLE';
        if (safeNow() < retryAt) return 'STORAGE_TRANSIENT_FAILURE';
        return resolveRaw()
          ? ''
          : (missing ? 'STORAGE_UNAVAILABLE' : 'STORAGE_TRANSIENT_FAILURE');
      },
      get keyCount() {
        var target = resolveRaw();
        if (!target) return null;
        try {
          var length = target.length;
          var key = target.key;
          if (typeof length === 'undefined' || typeof key !== 'function') {
            return null;
          }
          if (!Number.isSafeInteger(length) || length < 0) {
            transientFailure();
            return null;
          }
          return length;
        } catch (_) {
          transientFailure();
          return null;
        }
      },
      keyProof: function() {
        var target = resolveRaw();
        if (!target) {
          return {
            keys: [],
            complete: false,
            digest: '',
            length: null,
          };
        }
        try {
          var length = target.length;
          var key = target.key;
          if (typeof length === 'undefined' || typeof key !== 'function') {
            return {
              keys: [],
              complete: true,
              digest: 'enumeration-unavailable',
              length: null,
              unsupported: true,
            };
          }
          if (
            !Number.isSafeInteger(length)
            || length < 0
            || length > STORAGE_KEY_PROOF_LIMIT
          ) {
            return {
              keys: [],
              complete: false,
              digest: '',
              length: Number.isSafeInteger(length) ? length : null,
            };
          }
          var keys = [];
          var totalBytes = 0;
          for (var index = 0; index < length; index += 1) {
            var result = key.call(target, index);
            if (typeof result !== 'string') {
              transientFailure();
              return {
                keys: [],
                complete: false,
                digest: '',
                length: length,
              };
            }
            totalBytes += utf8ByteLength(result);
            if (totalBytes > STORAGE_KEY_PROOF_BYTES) {
              return {
                keys: [],
                complete: false,
                digest: '',
                length: length,
              };
            }
            keys.push(result);
          }
          if (target.length !== length) {
            transientFailure();
            return {
              keys: [],
              complete: false,
              digest: '',
              length: length,
            };
          }
          operationSuccess();
          return {
            keys: keys,
            complete: true,
            digest: sha256Hex(JSON.stringify(keys)),
            length: length,
          };
        } catch (_) {
          transientFailure();
          return {
            keys: [],
            complete: false,
            digest: '',
            length: null,
          };
        }
      },
      getItem: function(key) {
        var operation = method('getItem');
        if (!operation) return null;
        try {
          var result = operation.method.call(operation.target, key);
          methodSuccess('getItem');
          return result;
        } catch (_) {
          methodFailure('getItem');
          return null;
        }
      },
      setItem: function(key, item, force) {
        var operation = method('setItem', force === true);
        if (!operation) return false;
        try {
          operation.method.call(operation.target, key, item);
          methodSuccess('setItem');
          return true;
        } catch (_) {
          methodFailure('setItem');
          return false;
        }
      },
      removeItem: function(key) {
        var operation = method('removeItem');
        if (!operation) return false;
        try {
          operation.method.call(operation.target, key);
          methodSuccess('removeItem');
          return true;
        } catch (_) {
          methodFailure('removeItem');
          return false;
        }
      },
      keys: function() {
        var target = resolveRaw();
        if (!target) {
          return {
            keys: [],
            complete: false,
            cursor: 0,
            epoch: keyScanEpoch,
            length: null,
            scanned: 0,
          };
        }
        try {
          var length = target.length;
          var key = target.key;
          if (typeof length === 'undefined' || typeof key !== 'function') {
            return {
              keys: [],
              complete: true,
              cursor: 0,
              epoch: keyScanEpoch,
              length: null,
              scanned: 0,
              unsupported: true,
            };
          }
          if (!Number.isSafeInteger(length) || length < 0) {
            transientFailure();
            return {
              keys: [],
              complete: false,
              cursor: 0,
              epoch: keyScanEpoch,
              length: null,
              scanned: 0,
            };
          }
          if (keyScanLength !== length || keyScanCursor === 0) {
            keyScanCursor = 0;
            keyScanLength = length;
            keyScanEpoch += 1;
          }
          var scanCount = length <= STORAGE_KEY_HARD_LIMIT
            ? length
            : Math.min(length - keyScanCursor, STORAGE_KEY_SCAN_LIMIT);
          var start = keyScanCursor;
          var keys = [];
          for (var offset = 0; offset < scanCount; offset += 1) {
            var index = start + offset;
            var result = key.call(target, index);
            if (typeof result !== 'string') {
              keyScanCursor = 0;
              keyScanLength = null;
              transientFailure();
              return {
                keys: [],
                complete: false,
                cursor: 0,
                epoch: keyScanEpoch,
                length: length,
                scanned: 0,
              };
            }
            keys.push(result);
          }
          if (target.length !== length) {
            keyScanCursor = 0;
            keyScanLength = null;
            transientFailure();
            return {
              keys: [],
              complete: false,
              cursor: 0,
              epoch: keyScanEpoch,
              length: length,
              scanned: 0,
            };
          }
          var complete = start + scanCount >= length;
          keyScanCursor = complete ? 0 : start + scanCount;
          operationSuccess();
          return {
            keys: keys,
            complete: complete,
            cursor: keyScanCursor,
            epoch: keyScanEpoch,
            length: length,
            scanned: scanCount,
          };
        } catch (_) {
          keyScanCursor = 0;
          keyScanLength = null;
          transientFailure();
          return {
            keys: [],
            complete: false,
            cursor: 0,
            epoch: keyScanEpoch,
            length: null,
            scanned: 0,
          };
        }
      },
    };
  }

  function cleanString(value, max, pattern) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    var result = String(value).trim();
    if (!result || result.length > max) return '';
    return pattern && !pattern.test(result) ? '' : result;
  }

  function cleanProvider(value) {
    var provider = cleanString(value, 16).toLowerCase();
    if (provider === 'local-library') provider = 'local';
    if (provider === 'song' || provider === 'music') provider = 'netease';
    return PROVIDERS.indexOf(provider) >= 0 ? provider : '';
  }

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : (fallback || 0);
  }

  function boundedInteger(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(finite(value, min))));
  }

  function utf8ByteLength(value) {
    try {
      var Encoder = root && root.TextEncoder;
      if (typeof Encoder === 'function') return new Encoder().encode(value).length;
      return unescape(encodeURIComponent(value)).length;
    } catch (_) {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  function createSessionId(cryptoApi, clock, random) {
    try {
      if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID();
      }
      if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        var bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.prototype.map.call(bytes, function(byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('');
        return [
          hex.slice(0, 8),
          hex.slice(8, 12),
          hex.slice(12, 16),
          hex.slice(16, 20),
          hex.slice(20),
        ].join('-');
      }
    } catch (_) {}
    fallbackInstanceSerial += 1;
    var randomValue = typeof random === 'function' ? random : Math.random;
    var entropy = [];
    for (var index = 0; index < 4; index += 1) {
      try {
        entropy.push(String(randomValue()));
      } catch (_) {
        entropy.push(String(Math.random()));
      }
    }
    entropy.push(
      String(clock()),
      String(Date.now()),
      String(fallbackInstanceSerial)
    );
    return [
      'mr',
      Number(clock()).toString(36),
      fallbackInstanceSerial.toString(36),
      sha256Hex(entropy.join(':')).slice(0, 24),
    ].join('-');
  }

  function utf8Bytes(value) {
    var text = String(value);
    try {
      var Encoder = root && root.TextEncoder;
      if (typeof Encoder === 'function') return Array.from(new Encoder().encode(text));
    } catch (_) {}
    var bytes = [];
    for (var index = 0; index < text.length; index += 1) {
      var code = text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
        var low = text.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          index += 1;
        }
      }
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(
          0xe0 | (code >>> 12),
          0x80 | ((code >>> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      } else {
        bytes.push(
          0xf0 | (code >>> 18),
          0x80 | ((code >>> 12) & 0x3f),
          0x80 | ((code >>> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      }
    }
    return bytes;
  }

  function rotateRight(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function sha256Bytes(input) {
    var bytes = Array.isArray(input) ? input.slice() : utf8Bytes(input);
    var bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var byteIndex = 7; byteIndex >= 0; byteIndex -= 1) {
      bytes.push(Math.floor(bitLength / Math.pow(2, byteIndex * 8)) & 0xff);
    }
    var hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    var words = new Array(64);
    for (var offset = 0; offset < bytes.length; offset += 64) {
      for (var wordIndex = 0; wordIndex < 16; wordIndex += 1) {
        var cursor = offset + wordIndex * 4;
        words[wordIndex] = (
          (bytes[cursor] << 24)
          | (bytes[cursor + 1] << 16)
          | (bytes[cursor + 2] << 8)
          | bytes[cursor + 3]
        ) >>> 0;
      }
      for (var expanded = 16; expanded < 64; expanded += 1) {
        var left = words[expanded - 15];
        var right = words[expanded - 2];
        var sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
        var sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
        words[expanded] = (
          words[expanded - 16] + sigma0 + words[expanded - 7] + sigma1
        ) >>> 0;
      }
      var a = hash[0];
      var b = hash[1];
      var c = hash[2];
      var d = hash[3];
      var e = hash[4];
      var f = hash[5];
      var g = hash[6];
      var h = hash[7];
      for (var round = 0; round < 64; round += 1) {
        var sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        var choose = (e & f) ^ (~e & g);
        var temporary1 = (h + sum1 + choose + SHA256_CONSTANTS[round] + words[round]) >>> 0;
        var sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        var majority = (a & b) ^ (a & c) ^ (b & c);
        var temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    var output = [];
    hash.forEach(function(word) {
      output.push(
        (word >>> 24) & 0xff,
        (word >>> 16) & 0xff,
        (word >>> 8) & 0xff,
        word & 0xff
      );
    });
    return output;
  }

  function bytesHex(bytes) {
    return bytes.map(function(byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function sha256Hex(value) {
    return bytesHex(sha256Bytes(value));
  }

  function hmacSha256Hex(key, value) {
    var keyBytes = utf8Bytes(key);
    if (keyBytes.length > 64) keyBytes = sha256Bytes(keyBytes);
    while (keyBytes.length < 64) keyBytes.push(0);
    var inner = keyBytes.map(function(byte) { return byte ^ 0x36; });
    var outer = keyBytes.map(function(byte) { return byte ^ 0x5c; });
    return bytesHex(sha256Bytes(outer.concat(sha256Bytes(inner.concat(utf8Bytes(value))))));
  }

  function randomSalt(cryptoApi, clock, random) {
    try {
      if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        var bytes = new Uint8Array(32);
        cryptoApi.getRandomValues(bytes);
        return bytesHex(Array.from(bytes));
      }
      if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return sha256Hex(cryptoApi.randomUUID() + ':' + cryptoApi.randomUUID());
      }
    } catch (_) {}
    var randomValue = typeof random === 'function' ? random : Math.random;
    return sha256Hex(
      String(clock()) + ':' + String(randomValue()) + ':' + String(randomValue())
    );
  }

  function validSalt(value) {
    return cleanString(value, 64, /^[a-f0-9]{64}$/);
  }

  function installationSaltCell(storage) {
    if (storage.raw && saltCells) {
      var existing = saltCells.get(storage.raw);
      if (existing) return existing;
      var created = { value: '', candidate: '', canonicalRequired: false };
      saltCells.set(storage.raw, created);
      return created;
    }
    return fallbackSaltCell;
  }

  function ephemeralSalt(cell, cryptoApi, clock, random) {
    if (cell.canonicalRequired) {
      cell.value = '';
      return cell.value;
    }
    if (!ephemeralLocalMediaSalt) {
      ephemeralLocalMediaSalt = cell.candidate
        || cell.value
        || randomSalt(cryptoApi, clock, random);
    }
    cell.value = ephemeralLocalMediaSalt;
    return cell.value;
  }

  function resolveInstallationSalt(cell, storage, cryptoApi, clock, random) {
    var stored = validSalt(storage.getItem(LOCAL_MEDIA_SALT_KEY));
    if (stored) {
      cell.value = stored;
      cell.candidate = stored;
      cell.canonicalRequired = false;
      return cell.value;
    }
    if (!storage.available) {
      if (storage.unavailableCode === 'STORAGE_UNAVAILABLE') {
        return ephemeralSalt(cell, cryptoApi, clock, random);
      }
      cell.value = '';
      cell.canonicalRequired = true;
      return cell.value;
    }
    for (var attempt = 0; attempt < 4; attempt += 1) {
      stored = validSalt(storage.getItem(LOCAL_MEDIA_SALT_KEY));
      if (stored) {
        cell.value = stored;
        cell.candidate = stored;
        cell.canonicalRequired = false;
        return cell.value;
      }
      var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      var current = null;
      try {
        current = JSON.parse(storage.getItem(LOCAL_MEDIA_SALT_LOCK_KEY) || 'null');
      } catch (_) {}
      if (
        isRecord(current)
        && validSalt(current.candidate)
        && boundedInteger(current.expiresAt, 0, Number.MAX_SAFE_INTEGER) > now
      ) {
        cell.candidate = validSalt(current.candidate);
        cell.value = '';
        cell.canonicalRequired = true;
        return cell.value;
      }
      var candidate = isRecord(current) && validSalt(current.candidate)
        ? validSalt(current.candidate)
        : validSalt(cell.candidate || cell.value);
      if (!candidate) candidate = randomSalt(cryptoApi, clock, random);
      cell.candidate = candidate;
      cell.value = '';
      cell.canonicalRequired = true;
      var token = createSessionId(cryptoApi, clock, random);
      var lock = {
        token: token,
        candidate: candidate,
        expiresAt: now + STORAGE_LOCK_TTL_MS,
      };
      if (!storage.setItem(LOCAL_MEDIA_SALT_LOCK_KEY, JSON.stringify(lock))) break;
      var confirmed = null;
      try {
        confirmed = JSON.parse(storage.getItem(LOCAL_MEDIA_SALT_LOCK_KEY) || 'null');
      } catch (_) {}
      if (!isRecord(confirmed) || confirmed.token !== token) {
        if (isRecord(confirmed) && validSalt(confirmed.candidate)) {
          cell.candidate = validSalt(confirmed.candidate);
        }
        continue;
      }
      stored = validSalt(storage.getItem(LOCAL_MEDIA_SALT_KEY));
      if (!stored) {
        var owner = null;
        try {
          owner = JSON.parse(storage.getItem(LOCAL_MEDIA_SALT_LOCK_KEY) || 'null');
        } catch (_) {}
        if (!isRecord(owner) || owner.token !== token) continue;
        if (!storage.setItem(LOCAL_MEDIA_SALT_KEY, candidate)) break;
      }
      var finalValue = validSalt(storage.getItem(LOCAL_MEDIA_SALT_KEY));
      if (finalValue) {
        cell.value = finalValue;
        cell.candidate = finalValue;
        cell.canonicalRequired = false;
      }
      var release = null;
      try {
        release = JSON.parse(storage.getItem(LOCAL_MEDIA_SALT_LOCK_KEY) || 'null');
      } catch (_) {}
      if (isRecord(release) && release.token === token) {
        storage.removeItem(LOCAL_MEDIA_SALT_LOCK_KEY);
      }
      if (finalValue) return cell.value;
    }
    stored = validSalt(storage.getItem(LOCAL_MEDIA_SALT_KEY));
    if (stored) {
      cell.value = stored;
      cell.candidate = stored;
      cell.canonicalRequired = false;
      return cell.value;
    }
    if (!storage.available) {
      if (storage.unavailableCode === 'STORAGE_UNAVAILABLE') {
        return ephemeralSalt(cell, cryptoApi, clock, random);
      }
      cell.value = '';
      cell.canonicalRequired = true;
      return cell.value;
    }
    cell.value = '';
    return cell.value;
  }

  function installationSalt(storage, cryptoApi, clock, random) {
    var cell = installationSaltCell(storage);
    resolveInstallationSalt(cell, storage, cryptoApi, clock, random);
    return cell;
  }

  function localIdentityMaterial(value) {
    value = isRecord(value) ? value : {};
    var sourceIds = isRecord(value.sourceIds) ? value.sourceIds : {};
    var candidates = [
      value.localId,
      value.localLibraryFileSignature,
      value.localKey,
      value.catalogSourceId,
      value.playbackSourceId,
      sourceIds.local,
      value.key,
      value.id,
    ];
    for (var index = 0; index < candidates.length; index += 1) {
      if (typeof candidates[index] !== 'string' && typeof candidates[index] !== 'number') {
        continue;
      }
      var candidate = String(candidates[index]).trim();
      if (candidate && candidate.length <= 4096) return candidate;
    }
    return '';
  }

  function privateLocalSourceId(value, salt) {
    var material = localIdentityMaterial(value);
    if (/^local-v2-[a-f0-9]{64}$/.test(material)) return material;
    if (!material || !/^[a-f0-9]{64}$/.test(salt)) return '';
    return 'local-v2-' + hmacSha256Hex(salt, material);
  }

  function cleanContext(value) {
    if (!isRecord(value)) return null;
    var context = {};
    var stringFields = {
      type: 32,
      source: 32,
      playlistId: 128,
      radioId: 128,
    };
    Object.keys(stringFields).forEach(function(key) {
      var result = cleanString(
        value[key],
        stringFields[key],
        /^[^\u0000-\u001f\/\\]*$/
      );
      if (result) context[key] = result;
    });
    var position = Number(value.position);
    if (Number.isSafeInteger(position) && position >= 0 && position <= 1000000) {
      context.position = position;
    }
    return Object.keys(context).length ? context : null;
  }

  function cleanSourceIds(value) {
    if (!isRecord(value)) return {};
    var sourceIds = {};
    PROVIDERS.forEach(function(provider) {
      var id = cleanString(value[provider], 128, /^[^\u0000-\u001f\/\\]+$/);
      if (id) sourceIds[provider] = id;
    });
    return sourceIds;
  }

  function sourceIdFor(song, provider, playback) {
    song = isRecord(song) ? song : {};
    if (playback && cleanProvider(song.playbackProvider) === provider) {
      var explicit = cleanString(
        song.playbackSourceId,
        128,
        /^[^\u0000-\u001f\/\\]+$/
      );
      if (explicit) return explicit;
    }
    if (!playback && cleanProvider(song.catalogProvider) === provider) {
      var catalog = cleanString(
        song.catalogSourceId,
        128,
        /^[^\u0000-\u001f\/\\]+$/
      );
      if (catalog) return catalog;
    }
    var fields = {
      netease: ['neteaseId', 'id'],
      qq: ['mid', 'songmid', 'qqId', 'id'],
      kugou: ['hash', 'id'],
      qishui: ['trackId', 'id'],
      spotify: ['spotifyId', 'id', 'uri'],
      local: ['localId', 'id', 'key'],
    }[provider] || [];
    for (var index = 0; index < fields.length; index += 1) {
      var value = cleanString(
        song[fields[index]],
        128,
        /^[^\u0000-\u001f\/\\]+$/
      );
      if (value) return value;
    }
    return '';
  }

  function normalizeIdentity(song, localSourceId) {
    song = isRecord(song) ? song : {};
    var catalogProvider = cleanProvider(
      song.catalogProvider || song.provider || song.source || song.type
    );
    var playbackProvider = cleanProvider(
      song.playbackProvider || song.resolvedPlaybackProvider || catalogProvider
    );
    if (!catalogProvider || !playbackProvider) return null;
    var resolutionMode;
    if (playbackProvider === 'local') {
      resolutionMode = 'local';
      catalogProvider = 'local';
      localSourceId = cleanString(
        localSourceId,
        128,
        /^[A-Za-z0-9._:-]+$/
      );
      if (!localSourceId) return null;
      return {
        catalogProvider: 'local',
        playbackProvider: 'local',
        resolutionMode: 'local',
        catalogSourceId: localSourceId,
        playbackSourceId: localSourceId,
        sourceIds: { local: localSourceId },
      };
    } else if (catalogProvider === playbackProvider) {
      resolutionMode = 'direct';
    } else {
      resolutionMode = 'matched-provider';
    }
    var catalogSourceId = sourceIdFor(song, catalogProvider, false);
    var playbackSourceId = sourceIdFor(song, playbackProvider, true);
    if (!catalogSourceId || !playbackSourceId) return null;
    var sourceIds = {};
    sourceIds[catalogProvider] = catalogSourceId;
    sourceIds[playbackProvider] = playbackSourceId;
    return {
      catalogProvider: catalogProvider,
      playbackProvider: playbackProvider,
      resolutionMode: resolutionMode,
      catalogSourceId: catalogSourceId,
      playbackSourceId: playbackSourceId,
      sourceIds: sourceIds,
    };
  }

  function completedListenMinimum(durationMs) {
    if (!(durationMs > 0)) return 1000;
    return Math.max(1, Math.min(1000, Math.floor(durationMs * 0.8)));
  }

  function displaySnapshot(song, identity) {
    song = isRecord(song) ? song : {};
    return {
      key: identity.catalogProvider === 'local'
        ? identity.catalogProvider + ':' + identity.catalogSourceId
        : (
          cleanString(song.key, 160, /^[^\u0000-\u001f\/\\]+$/)
          || identity.catalogProvider + ':' + identity.catalogSourceId
        ),
      name: cleanString(song.name || song.title, 160) || '未知歌曲',
      artist: cleanString(song.artist, 160),
      cover: cleanString(song.cover, 2048, /^https?:\/\//i),
      source: identity.catalogProvider,
    };
  }

  function createListenSessionState(options) {
    options = isRecord(options) ? options : {};
    var clock = typeof options.clock === 'function' ? options.clock : Date.now;
    var cryptoApi = Object.prototype.hasOwnProperty.call(options, 'crypto')
      ? safeValue(options, 'crypto')
      : safeValue(root, 'crypto');
    var random = typeof safeValue(options, 'random') === 'function'
      ? safeValue(options, 'random')
      : Math.random;
    var storage = createSafeStorage(function() {
      return Object.prototype.hasOwnProperty.call(options, 'storage')
        ? options.storage
        : (root && root.localStorage);
    }, clock);
    var localMediaSalt = installationSalt(storage, cryptoApi, clock, random);
    function localMediaSaltValue() {
      return resolveInstallationSalt(localMediaSalt, storage, cryptoApi, clock, random);
    }
    var createId = typeof options.createId === 'function'
      ? options.createId
      : function() { return createSessionId(cryptoApi, clock, random); };
    var active = null;
    var waiting = null;
    var finalized = Object.create(null);

    function snapshot() {
      if (active) return JSON.parse(JSON.stringify(active));
      if (!waiting) return null;
      return {
        status: 'waiting-salt',
        sessionId: waiting.sessionId,
        transactionId: waiting.transactionId,
        confirmedPlayback: true,
        paused: waiting.paused,
        listenMs: waiting.listenMs,
        maxProgress: waiting.maxProgress,
      };
    }

    function localSong(value) {
      value = isRecord(value) ? value : {};
      return cleanProvider(
        value.playbackProvider
        || value.provider
        || value.source
        || value.type
      ) === 'local';
    }

    function waitingDisplay(value) {
      value = isRecord(value) ? value : {};
      var name = cleanString(value.name || value.title, 160);
      if (
        /[\/\\]/.test(name)
        || /\.(aac|flac|m4a|mp3|ogg|opus|wav|webm)$/i.test(name)
      ) name = '';
      return {
        name: name || '本地音乐',
        artist: cleanString(value.artist, 160, /^[^\u0000-\u001f\/\\]*$/),
        cover: cleanString(value.cover, 2048, /^https?:\/\//i),
        source: 'local',
      };
    }

    function advanceTiming(session, input) {
      input = isRecord(input) ? input : {};
      var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      var mediaTime = Math.max(0, finite(input.mediaTime, session.lastMediaTime));
      var durationMs = boundedInteger(
        input.durationMs == null ? session.durationMs : input.durationMs,
        0,
        MAX_LISTEN_MS
      );
      if (!session.paused) {
        var mediaDelta = Math.max(0, mediaTime - session.lastMediaTime) * 1000;
        var wallDelta = Math.max(0, now - session.lastWallAt);
        var delta = Math.min(mediaDelta, wallDelta, 60000);
        if (delta > 0) {
          session.listenMs = Math.min(MAX_LISTEN_MS, session.listenMs + delta);
        }
      }
      session.lastWallAt = now;
      session.lastMediaTime = mediaTime;
      session.mediaTime = mediaTime;
      session.durationMs = durationMs;
      if (durationMs > 0) {
        session.maxProgress = Math.max(
          session.maxProgress,
          Math.min(1, mediaTime * 1000 / durationMs)
        );
      }
      return session;
    }

    function createActive(input, sessionId, transactionId, identity, display, timing) {
      var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      var mediaTime = Math.max(0, finite(
        timing && timing.mediaTime,
        finite(input.mediaTime, 0)
      ));
      var durationMs = boundedInteger(
        timing && timing.durationMs != null ? timing.durationMs : input.durationMs,
        0,
        MAX_LISTEN_MS
      );
      active = {
        sessionId: sessionId,
        transactionId: transactionId,
        confirmedPlayback: true,
        catalogProvider: identity.catalogProvider,
        playbackProvider: identity.playbackProvider,
        resolutionMode: identity.resolutionMode,
        catalogSourceId: identity.catalogSourceId,
        playbackSourceId: identity.playbackSourceId,
        sourceIds: identity.sourceIds,
        context: timing ? timing.context : cleanContext(input.context),
        display: display,
        startedAt: timing ? timing.startedAt : now,
        lastWallAt: timing ? timing.lastWallAt : now,
        lastMediaTime: timing ? timing.lastMediaTime : mediaTime,
        listenMs: timing
          ? boundedInteger(timing.listenMs, 0, MAX_LISTEN_MS)
          : 0,
        durationMs: durationMs,
        maxProgress: Math.max(
          timing ? Math.max(0, Math.min(1, finite(timing.maxProgress, 0))) : 0,
          durationMs > 0 ? Math.min(1, mediaTime * 1000 / durationMs) : 0
        ),
        paused: !!(timing && timing.paused),
      };
      var reportingBinding = cleanString(
        timing ? timing.reportingBinding : input.reportingBinding,
        97,
        /^[a-f0-9]{32}\.[a-f0-9]{64}$/
      );
      if (reportingBinding) {
        active.reportingBinding = reportingBinding;
      }
      return active;
    }

    function activateWaiting() {
      if (!waiting) return false;
      var salt = localMediaSaltValue();
      var localSourceId = privateLocalSourceId(
        { localId: waiting.localMaterial },
        salt
      );
      if (!localSourceId) return false;
      var pending = waiting;
      waiting = null;
      createActive(
        {},
        pending.sessionId,
        pending.transactionId,
        {
          catalogProvider: 'local',
          playbackProvider: 'local',
          resolutionMode: 'local',
          catalogSourceId: localSourceId,
          playbackSourceId: localSourceId,
          sourceIds: { local: localSourceId },
        },
        {
          key: 'local:' + localSourceId,
          name: pending.display.name,
          artist: pending.display.artist,
          cover: pending.display.cover,
          source: 'local',
        },
        pending
      );
      return true;
    }

    function startConfirmed(input) {
      input = isRecord(input) ? input : {};
      if (input.confirmed !== true) return null;
      var transactionId = cleanString(input.transactionId, 128, /^[A-Za-z0-9._:-]+$/);
      if (!transactionId) return null;
      if (active && active.transactionId === transactionId) return snapshot();
      if (waiting && waiting.transactionId === transactionId) return snapshot();
      if (active || waiting) return null;
      var sessionId = cleanString(createId(), 128, /^[A-Za-z0-9._:-]+$/);
      if (!sessionId) return null;
      var salt = localMediaSaltValue();
      var identity = normalizeIdentity(
        input.song,
        privateLocalSourceId(input.song, salt)
      );
      if (!identity) {
        var material = localIdentityMaterial(input.song);
        if (!localSong(input.song) || !material || salt) return null;
        var waitingNow = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
        waiting = {
          sessionId: sessionId,
          transactionId: transactionId,
          localMaterial: material,
          display: waitingDisplay(input.song),
          context: cleanContext(input.context),
          startedAt: waitingNow,
          lastWallAt: waitingNow,
          lastMediaTime: Math.max(0, finite(input.mediaTime, 0)),
          mediaTime: Math.max(0, finite(input.mediaTime, 0)),
          listenMs: 0,
          durationMs: boundedInteger(input.durationMs, 0, MAX_LISTEN_MS),
          maxProgress: input.durationMs > 0
            ? Math.min(
              1,
              Math.max(0, finite(input.mediaTime, 0)) * 1000
                / boundedInteger(input.durationMs, 1, MAX_LISTEN_MS)
            )
            : 0,
          paused: false,
        };
        return snapshot();
      }
      createActive(
        input,
        sessionId,
        transactionId,
        identity,
        displaySnapshot(input.song, identity),
        null
      );
      return snapshot();
    }

    function tick(input) {
      input = isRecord(input) ? input : {};
      if (!active && waiting) {
        advanceTiming(waiting, input);
        if (!activateWaiting()) return snapshot();
        return snapshot();
      }
      if (!active) return null;
      advanceTiming(active, input);
      return snapshot();
    }

    function pause(input) {
      if (!active && waiting) {
        tick(input);
        if (waiting) {
          waiting.paused = true;
          return snapshot();
        }
      }
      if (!active) return null;
      tick(input);
      active.paused = true;
      return snapshot();
    }

    function resume(input) {
      input = isRecord(input) ? input : {};
      if (!active && waiting) {
        advanceTiming(waiting, input);
        if (!activateWaiting()) {
          waiting.paused = false;
          waiting.lastWallAt = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
          waiting.lastMediaTime = Math.max(0, finite(
            input.mediaTime,
            waiting.lastMediaTime
          ));
          waiting.mediaTime = waiting.lastMediaTime;
          return snapshot();
        }
      }
      if (!active) return null;
      active.paused = false;
      active.lastWallAt = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      active.lastMediaTime = Math.max(0, finite(input.mediaTime, active.lastMediaTime));
      return snapshot();
    }

    function finalize(input) {
      input = isRecord(input) ? input : {};
      var timingApplied = false;
      if (!active && waiting) {
        advanceTiming(waiting, input);
        timingApplied = true;
        if (!activateWaiting()) {
          waiting = null;
          return null;
        }
      }
      if (!active) return null;
      if (!timingApplied && (input.mediaTime != null || input.durationMs != null)) {
        tick(input);
      }
      var session = active;
      active = null;
      if (
        !session.sessionId
        || Object.prototype.hasOwnProperty.call(finalized, session.sessionId)
      ) return null;
      var reason = cleanString(input.reason, 32).toLowerCase();
      var completed = input.completed === true || reason === 'ended';
      var ratio = Math.max(0, Math.min(1, session.maxProgress || 0));
      var effective = completed
        ? session.listenMs >= completedListenMinimum(session.durationMs) && ratio > 0
        : session.listenMs >= 45000 || ratio >= 0.5;
      if (!effective) {
        finalized[session.sessionId] = null;
        return null;
      }
      var event = {
        sessionId: session.sessionId,
        confirmedPlayback: true,
        catalogProvider: session.catalogProvider,
        playbackProvider: session.playbackProvider,
        resolutionMode: session.resolutionMode,
        completeness: 'partial',
        sourceIds: JSON.parse(JSON.stringify(session.sourceIds)),
        catalogSourceId: session.catalogSourceId,
        playbackSourceId: session.playbackSourceId,
        listenMs: Math.round(session.listenMs),
        durationMs: session.durationMs,
        completion: {
          completed: completed,
          ratio: Math.round(ratio * 10000) / 10000,
        },
        playedAt: boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER),
        context: session.context,
        display: session.display,
      };
      if (session.reportingBinding) {
        event.reportingBinding = session.reportingBinding;
      }
      finalized[session.sessionId] = event;
      return JSON.parse(JSON.stringify(event));
    }

    return Object.freeze({
      startConfirmed: startConfirmed,
      tick: tick,
      pause: pause,
      resume: resume,
      finalize: finalize,
      retry: function(sessionId) {
        sessionId = cleanString(sessionId, 128, /^[A-Za-z0-9._:-]+$/);
        var event = sessionId && finalized[sessionId];
        return event ? JSON.parse(JSON.stringify(event)) : null;
      },
      snapshot: snapshot,
      destroy: function() {
        active = null;
        waiting = null;
      },
    });
  }

  function emptyLocalStats() {
    return { history: [], songs: {}, artists: {}, updatedAt: 0 };
  }

  var LOCAL_STATS_HISTORY_MAX = 180;
  var LOCAL_STATS_AGGREGATE_MAX = 512;
  var LOCAL_STATS_MAX_BYTES = 512 * 1024;

  function boundedAggregateMap(value, keyField, protectedKeys) {
    var rows = Object.keys(isRecord(value) ? value : {}).map(function(key) {
      return { key: key, value: value[key] };
    }).filter(function(item) {
      return isRecord(item.value);
    }).sort(function(left, right) {
      var leftAt = boundedInteger(left.value.lastPlayedAt, 0, Number.MAX_SAFE_INTEGER);
      var rightAt = boundedInteger(right.value.lastPlayedAt, 0, Number.MAX_SAFE_INTEGER);
      return (rightAt || 0) - (leftAt || 0)
        || left.key.localeCompare(right.key);
    });
    var protectedRows = rows.filter(function(item) {
      return protectedKeys[item.key] === true;
    });
    var retained = protectedRows.concat(rows.filter(function(item) {
      return protectedKeys[item.key] !== true;
    })).slice(0, LOCAL_STATS_AGGREGATE_MAX);
    var output = {};
    retained.forEach(function(item) {
      output[item.key] = item.value;
      if (!output[item.key][keyField]) output[item.key][keyField] = item.key;
    });
    return output;
  }

  function compactLocalStats(state) {
    state.history = (Array.isArray(state.history) ? state.history : [])
      .filter(isRecord)
      .slice(0, LOCAL_STATS_HISTORY_MAX);
    var protectedSongs = Object.create(null);
    var protectedArtists = Object.create(null);
    state.history.forEach(function(item) {
      var key = cleanString(item.key, 160, /^[^\u0000-\u001f\/\\]+$/);
      if (key) protectedSongs[key] = true;
      String(item.artist || '').split(/\s*\/\s*|\s*,\s*|、|&/).forEach(function(name) {
        name = cleanString(name, 160);
        if (name) protectedArtists[name] = true;
      });
    });
    state.songs = boundedAggregateMap(state.songs, 'key', protectedSongs);
    state.artists = boundedAggregateMap(state.artists, 'name', protectedArtists);

    function byteLength() {
      try {
        return utf8ByteLength(JSON.stringify(state));
      } catch (_) {
        return Number.MAX_SAFE_INTEGER;
      }
    }
    if (byteLength() <= LOCAL_STATS_MAX_BYTES) return state;

    Object.keys(state.songs).forEach(function(key) {
      if (state.songs[key] && state.songs[key].cover) state.songs[key].cover = '';
    });
    state.history.forEach(function(item) {
      if (item.cover) item.cover = '';
    });
    var songKeys = Object.keys(state.songs).sort(function(left, right) {
      return (state.songs[left].lastPlayedAt || 0) - (state.songs[right].lastPlayedAt || 0)
        || right.localeCompare(left);
    });
    var artistKeys = Object.keys(state.artists).sort(function(left, right) {
      return (state.artists[left].lastPlayedAt || 0) - (state.artists[right].lastPlayedAt || 0)
        || right.localeCompare(left);
    });
    while (
      byteLength() > LOCAL_STATS_MAX_BYTES
      && (songKeys.length > 1 || artistKeys.length > 1)
    ) {
      var oldestSong = songKeys.length > 1 ? songKeys.shift() : '';
      var oldestArtist = artistKeys.length > 1 ? artistKeys.shift() : '';
      if (oldestSong) delete state.songs[oldestSong];
      if (oldestArtist) delete state.artists[oldestArtist];
    }
    while (byteLength() > LOCAL_STATS_MAX_BYTES && state.history.length > 1) {
      state.history.pop();
    }
    return state;
  }

  function normalizeLocalStats(value) {
    value = isRecord(value) ? value : {};
    return compactLocalStats({
      history: Array.isArray(value.history)
        ? value.history.slice(0, LOCAL_STATS_HISTORY_MAX)
        : [],
      songs: isRecord(value.songs) ? value.songs : {},
      artists: isRecord(value.artists) ? value.artists : {},
      updatedAt: boundedInteger(value.updatedAt, 0, Number.MAX_SAFE_INTEGER),
    });
  }

  function recordLocalListen(value, event) {
    var state = value ? normalizeLocalStats(value) : emptyLocalStats();
    if (!isRecord(event) || !cleanString(event.sessionId, 128, /^[A-Za-z0-9._:-]+$/)) {
      return state;
    }
    if (state.history.some(function(item) {
      return item && item.sessionId === event.sessionId;
    })) return state;
    var display = isRecord(event.display) ? event.display : {};
    var key = cleanString(display.key, 160, /^[^\u0000-\u001f\/\\]+$/)
      || event.catalogProvider + ':' + event.catalogSourceId;
    var record = {
      sessionId: event.sessionId,
      key: key,
      id: event.catalogSourceId || '',
      mid: event.catalogProvider === 'qq' ? event.catalogSourceId : '',
      mediaMid: '',
      type: event.catalogProvider === 'local' ? 'local' : 'song',
      sourceKey: event.catalogProvider,
      name: cleanString(display.name, 160) || '未知歌曲',
      artist: cleanString(display.artist, 160),
      cover: cleanString(display.cover, 2048, /^https?:\/\//i),
      source: cleanString(display.source, 32),
      playedAt: boundedInteger(event.playedAt, 0, Number.MAX_SAFE_INTEGER),
      listenMs: boundedInteger(event.listenMs, 0, MAX_LISTEN_MS),
      completed: !!(event.completion && event.completion.completed),
      context: cleanContext(event.context),
    };
    state.history = [record].concat(state.history).slice(0, 180);
    var song = state.songs[key] || {
      key: key,
      name: record.name,
      artist: record.artist,
      cover: record.cover,
      source: record.source,
      plays: 0,
      listenMs: 0,
      completed: 0,
      lastPlayedAt: 0,
    };
    song.name = record.name;
    song.artist = record.artist;
    song.cover = record.cover || song.cover || '';
    song.source = record.source || song.source || '';
    song.plays = boundedInteger(song.plays, 0, Number.MAX_SAFE_INTEGER) + 1;
    song.listenMs = boundedInteger(song.listenMs, 0, MAX_LISTEN_MS) + record.listenMs;
    song.completed = boundedInteger(song.completed, 0, Number.MAX_SAFE_INTEGER)
      + (record.completed ? 1 : 0);
    song.lastPlayedAt = record.playedAt;
    state.songs[key] = song;
    String(record.artist || '').split(/\s*\/\s*|\s*,\s*|、|&/).forEach(function(name) {
      name = cleanString(name, 160);
      if (!name) return;
      var artist = state.artists[name] || {
        name: name,
        plays: 0,
        listenMs: 0,
        lastPlayedAt: 0,
      };
      artist.plays = boundedInteger(artist.plays, 0, Number.MAX_SAFE_INTEGER) + 1;
      artist.listenMs = boundedInteger(artist.listenMs, 0, MAX_LISTEN_MS) + record.listenMs;
      artist.lastPlayedAt = record.playedAt;
      state.artists[name] = artist;
    });
    state.updatedAt = record.playedAt;
    return compactLocalStats(state);
  }

  function createListenTransport(options) {
    options = isRecord(options) ? options : {};
    var fetchImpl = options.fetch || (root && root.fetch);
    var getReportingBinding = typeof safeValue(options, 'getReportingBinding') === 'function'
      ? safeValue(options, 'getReportingBinding')
      : null;
    var navigatorApi = safeValue(root, 'navigator');
    var sendBeacon = safeValue(options, 'sendBeacon') || (
      navigatorApi && safeValue(navigatorApi, 'sendBeacon')
        ? safeValue(navigatorApi, 'sendBeacon').bind(navigatorApi)
        : null
    );
    var timeoutMs = boundedInteger(options.timeoutMs || 3500, 10, 30000);
    var clock = typeof options.clock === 'function' ? options.clock : Date.now;
    var storage = createSafeStorage(function() {
      return Object.prototype.hasOwnProperty.call(options, 'storage')
        ? options.storage
        : (root && root.localStorage);
    }, clock);
    var cryptoApi = Object.prototype.hasOwnProperty.call(options, 'crypto')
      ? safeValue(options, 'crypto')
      : safeValue(root, 'crypto');
    var random = typeof safeValue(options, 'random') === 'function'
      ? safeValue(options, 'random')
      : Math.random;
    var localMediaSalt = installationSalt(storage, cryptoApi, clock, random);
    function localMediaSaltValue() {
      return resolveInstallationSalt(localMediaSalt, storage, cryptoApi, clock, random);
    }
    var requestedSetTimer = safeValue(options, 'setTimeout');
    var requestedClearTimer = safeValue(options, 'clearTimeout');
    function currentDefaultSetTimer(callback, delay) {
      var method = safeValue(root, 'setTimeout');
      if (typeof method !== 'function') return null;
      return method.call(root, callback, delay);
    }
    function currentDefaultClearTimer(handle) {
      var method = safeValue(root, 'clearTimeout');
      if (typeof method === 'function') method.call(root, handle);
    }
    var primarySetTimer = typeof requestedSetTimer === 'function'
      ? requestedSetTimer
      : currentDefaultSetTimer;
    var primaryClearTimer = typeof requestedClearTimer === 'function'
      ? requestedClearTimer
      : currentDefaultClearTimer;
    var fallbackSetTimer = typeof requestedSetTimer === 'function'
      ? currentDefaultSetTimer
      : null;
    var fallbackClearTimer = typeof requestedClearTimer === 'function'
      ? currentDefaultClearTimer
      : null;
    var autoRetry = safeValue(options, 'autoRetry') !== false;
    var requestedAbortController = safeValue(options, 'AbortController');
    var defaultAbortController = safeValue(root, 'AbortController');
    var AbortControllerOption = typeof requestedAbortController === 'function'
      ? requestedAbortController
      : (typeof defaultAbortController === 'function' ? defaultAbortController : null);
    var baseRetryMs = boundedInteger(options.baseRetryMs || 1000, 100, 60000);
    var maxRetryMs = boundedInteger(options.maxRetryMs || 60000, baseRetryMs, 600000);
    var records = Object.create(null);
    var timer = null;
    var flushPromise = null;
    var destroyed = false;
    var activeRequests = [];
    var timerOwners = [];
    var writerId = createSessionId(
      cryptoApi,
      clock,
      random
    );
    var writerGeneration = sha256Hex(writerId + ':generation').slice(0, 32);
    var writerShardKey = OUTBOX_SHARD_PREFIX + sha256Hex(writerId).slice(0, 32);
    var writerAckShardKey = OUTBOX_ACK_SHARD_PREFIX + sha256Hex(writerId).slice(0, 32);
    var writerCreatedAt = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
    var writerLastSeen = writerCreatedAt;
    var writerShardRevision = 0;
    var writerGenerationPublished = false;
    var writerShardFailureCode = '';
    var writerAckRevision = 0;
    var acknowledgements = Object.create(null);
    var durableAcknowledgements = Object.create(null);
    var localAcknowledgements = Object.create(null);
    var namespaceScanEpoch = -1;
    var namespaceScanLength = null;
    var namespaceScanScanned = 0;
    var namespaceScanKeys = Object.create(null);
    var namespaceScanKeyCount = 0;
    var namespaceScanOverflow = false;
    var completeNamespaceSnapshot = null;
    var activeLockEpochs = Object.create(null);

    function safeSetTimer(callback, delay) {
      var handle = null;
      var clear = primaryClearTimer;
      try {
        handle = primarySetTimer(callback, delay) || null;
      } catch (_) {}
      if (!handle && fallbackSetTimer) {
        try {
          handle = fallbackSetTimer(callback, delay) || null;
          clear = fallbackClearTimer || primaryClearTimer;
        } catch (_) {}
      }
      if (handle) timerOwners.push({ handle: handle, clear: clear });
      return handle;
    }

    function safeClearTimer(handle) {
      if (!handle) return;
      var owner = null;
      for (var index = timerOwners.length - 1; index >= 0; index -= 1) {
        if (timerOwners[index].handle === handle) {
          owner = timerOwners.splice(index, 1)[0];
          break;
        }
      }
      try {
        (owner && owner.clear || primaryClearTimer)(handle);
        return;
      } catch (_) {}
      var alternate = owner && owner.clear === fallbackClearTimer
        ? primaryClearTimer
        : fallbackClearTimer;
      if (!alternate) return;
      try { alternate(handle); } catch (_) {}
    }

    function safeUnrefTimer(handle) {
      var unref = safeValue(handle, 'unref');
      if (typeof unref !== 'function') return;
      try {
        unref.call(handle);
      } catch (_) {}
    }

    function sessionAccountProof(reportingBinding, sessionId) {
      reportingBinding = cleanString(
        reportingBinding,
        97,
        /^[a-f0-9]{32}\.[a-f0-9]{64}$/
      );
      sessionId = cleanString(sessionId, 128, /^[A-Za-z0-9._:-]+$/);
      if (!reportingBinding || !sessionId) return '';
      return sha256Hex(
        'listen-scope\u0000'
        + reportingBinding.slice(0, 32)
        + '\u0000'
        + sessionId
      ).slice(0, 32);
    }

    function persistentEvent(event) {
      if (!isRecord(event)) return event;
      var copy = JSON.parse(JSON.stringify(event));
      delete copy.reportingBinding;
      return copy;
    }

    function currentReportingBinding(provider, fallback) {
      if (getReportingBinding) {
        try {
          var current = getReportingBinding(provider);
          if (isRecord(current)) current = current.reportingBinding;
          return cleanString(current, 97, /^[a-f0-9]{32}\.[a-f0-9]{64}$/);
        } catch (_) {
          return '';
        }
      }
      return cleanString(fallback, 97, /^[a-f0-9]{32}\.[a-f0-9]{64}$/);
    }

    function reportPayload(event, fallbackBinding, allowMissingBinding) {
      var sessionId = cleanString(
        event && event.sessionId,
        128,
        /^[A-Za-z0-9._:-]+$/
      );
      if (!sessionId) return null;
      var catalogProvider = cleanProvider(event && event.catalogProvider);
      var playbackProvider = cleanProvider(event && event.playbackProvider);
      var localSourceId = playbackProvider === 'local'
        ? privateLocalSourceId(event, localMediaSaltValue())
        : '';
      if (playbackProvider === 'local' && !localSourceId) return null;
      var sourceIds = playbackProvider === 'local'
        ? { local: localSourceId }
        : cleanSourceIds(event && event.sourceIds);
      var body;
      try {
        var reportingBinding = currentReportingBinding(
          playbackProvider,
          fallbackBinding || event.reportingBinding
        );
        if (
          playbackProvider === 'netease'
          && !reportingBinding
          && allowMissingBinding !== true
        ) {
          return {
            sessionId: sessionId,
            error: 'REPORTING_BINDING_REQUIRED',
          };
        }
        body = JSON.stringify({
          sessionId: sessionId,
          confirmedPlayback: event.confirmedPlayback === true,
          catalogProvider: catalogProvider,
          playbackProvider: playbackProvider,
          resolutionMode: cleanString(event.resolutionMode, 32),
          completeness: ['complete', 'partial', 'unsupported'].indexOf(event.completeness) >= 0
            ? event.completeness
            : 'partial',
          sourceIds: sourceIds,
          catalogSourceId: playbackProvider === 'local'
            ? localSourceId
            : cleanString(
              event.catalogSourceId,
              128,
              /^[^\u0000-\u001f\/\\]+$/
            ),
          playbackSourceId: playbackProvider === 'local'
            ? localSourceId
            : cleanString(
              event.playbackSourceId,
              128,
              /^[^\u0000-\u001f\/\\]+$/
            ),
          listenMs: boundedInteger(event.listenMs, 0, MAX_LISTEN_MS),
          durationMs: boundedInteger(event.durationMs, 0, MAX_LISTEN_MS),
          completion: {
            completed: !!(event.completion && event.completion.completed),
            ratio: Math.max(0, Math.min(1, finite(
              event.completion && event.completion.ratio,
              0
            ))),
          },
          playedAt: boundedInteger(event.playedAt, 0, Number.MAX_SAFE_INTEGER),
          context: cleanContext(event.context),
          reportingBinding: reportingBinding || undefined,
        });
      } catch (_) {
        return null;
      }
      if (utf8ByteLength(body) > 16 * 1024) return null;
      return { sessionId: sessionId, body: body, event: JSON.parse(body) };
    }

    function normalizeAcknowledgement(value) {
      if (!isRecord(value)) return null;
      var sessionId = cleanString(value.sessionId, 128, /^[A-Za-z0-9._:-]+$/);
      var digest = cleanString(value.digest, 64, /^[a-f0-9]{64}$/);
      if (!sessionId || !digest) return null;
      var source = isRecord(value.deliveryResult)
        ? value.deliveryResult
        : value;
      var deliveryResult = normalizeDeliveryResult(source);
      return {
        sessionId: sessionId,
        digest: digest,
        confirmedAt: boundedInteger(value.confirmedAt, 0, Number.MAX_SAFE_INTEGER),
        delivery: deliveryResult.delivery,
        status: deliveryResult.status,
        completeness: deliveryResult.completeness,
        duplicate: !!deliveryResult.duplicate,
        code: cleanString(deliveryResult.code, 32, /^[A-Z0-9_]+$/),
        deliveryResult: deliveryResult,
      };
    }

    function acknowledgementShardKeys(providedSnapshot) {
      var snapshot = providedSnapshot || namespaceKeySnapshot();
      return {
        complete: snapshot.complete,
        overflow: snapshot.overflow,
        keys: snapshot.keys.filter(function(key) {
          return typeof key === 'string'
            && (
              key.indexOf(OUTBOX_ACK_SHARD_PREFIX) === 0
              || key.indexOf(OUTBOX_CLEANUP_MARKER_PREFIX) === 0
            );
        }).sort(),
      };
    }

    function readAcknowledgementState(providedSnapshot) {
      var keySnapshot = acknowledgementShardKeys(providedSnapshot);
      var entries = [];
      var documents = [];
      var totalBytes = 0;
      var overflow = keySnapshot.overflow;
      keySnapshot.keys.forEach(function(key) {
        if (overflow) return;
        try {
          var raw = storage.getItem(key);
          if (!raw || utf8ByteLength(raw) > OUTBOX_MAX_BYTES) return;
          totalBytes += utf8ByteLength(raw);
          if (totalBytes > OUTBOX_MAX_BYTES) {
            overflow = true;
            return;
          }
          var document = JSON.parse(raw);
          if (
            !isRecord(document)
            || document.version !== 1
            || !Array.isArray(document.entries)
            || document.entries.length > OUTBOX_MAX_COUNT
          ) return;
          var normalized = document.entries.map(normalizeAcknowledgement)
            .filter(Boolean);
          entries = entries.concat(normalized);
          if (entries.length > OUTBOX_MAX_COUNT) {
            entries = entries.slice(0, OUTBOX_MAX_COUNT);
          }
          documents.push({
            key: key,
            raw: raw,
            entries: normalized,
            cleanup: document.cleanup === true,
            createdAt: boundedInteger(document.createdAt, 0, Number.MAX_SAFE_INTEGER),
          });
        } catch (_) {}
      });
      return {
        entries: entries,
        documents: documents,
        complete: keySnapshot.complete,
        overflow: overflow,
      };
    }

    function payloadAcknowledged(payload) {
      if (!payload) return false;
      var acknowledgement = acknowledgements[payload.sessionId];
      return !!acknowledgement
        && acknowledgement.digest === sha256Hex(payload.body);
    }

    function payloadDurablyAcknowledged(payload) {
      return !!payload
        && durableAcknowledgements[payload.sessionId] === sha256Hex(payload.body);
    }

    function restoreAcknowledgements(completeOnly) {
      var keyCount = storage.keyCount;
      if (
        completeOnly === true
        && keyCount > STORAGE_KEY_HARD_LIMIT
        && !completeNamespaceSnapshot
      ) return;
      var state = readAcknowledgementState();
      if (completeOnly === true && !state.complete) return;
      state.entries.forEach(function(entry) {
        var current = acknowledgements[entry.sessionId];
        if (!current || entry.confirmedAt > current.confirmedAt) {
          acknowledgements[entry.sessionId] = entry;
        }
        durableAcknowledgements[entry.sessionId] = entry.digest;
      });
    }

    function isOutboxNamespaceKey(key) {
      return key === OUTBOX_KEY
        || (
          typeof key === 'string'
          && (
            key.indexOf(OUTBOX_SHARD_PREFIX) === 0
            || key.indexOf(OUTBOX_ACK_SHARD_PREFIX) === 0
            || key.indexOf(OUTBOX_CLEANUP_MARKER_PREFIX) === 0
          )
        );
    }

    function completeNamespaceProof() {
      var proof = storage.keyProof();
      if (!proof || proof.complete !== true) {
        return {
          keys: [],
          complete: false,
          overflow: false,
          digest: '',
          length: null,
        };
      }
      if (proof.unsupported === true) {
        return {
          keys: [],
          complete: true,
          overflow: false,
          digest: proof.digest,
          length: null,
          enumerationUnavailable: true,
        };
      }
      var keys = proof.keys.filter(isOutboxNamespaceKey).sort();
      return {
        keys: keys,
        complete: keys.length <= OUTBOX_MAX_STORAGE_KEYS,
        overflow: keys.length > OUTBOX_MAX_STORAGE_KEYS,
        digest: proof.digest,
        length: proof.length,
      };
    }

    function namespaceProofMatches(left, right) {
      return !!left
        && !!right
        && left.complete === true
        && right.complete === true
        && left.overflow !== true
        && right.overflow !== true
        && left.length === right.length
        && left.digest
        && left.digest === right.digest;
    }

    function namespaceKeysMatch(left, right) {
      if (!left || !right || left.keys.length !== right.keys.length) return false;
      for (var index = 0; index < left.keys.length; index += 1) {
        if (left.keys[index] !== right.keys[index]) return false;
      }
      return true;
    }

    function resetNamespaceScan(page) {
      namespaceScanEpoch = page && Number.isSafeInteger(page.epoch)
        ? page.epoch
        : -1;
      namespaceScanLength = page && Number.isSafeInteger(page.length)
        ? page.length
        : null;
      namespaceScanScanned = 0;
      namespaceScanKeys = Object.create(null);
      namespaceScanKeyCount = 0;
      namespaceScanOverflow = false;
      completeNamespaceSnapshot = null;
    }

    function namespaceKeySnapshot() {
      if (completeNamespaceSnapshot) {
        var currentProof = completeNamespaceProof();
        if (
          namespaceProofMatches(completeNamespaceSnapshot, currentProof)
          && namespaceKeysMatch(completeNamespaceSnapshot, currentProof)
        ) return completeNamespaceSnapshot;
      }
      if (completeNamespaceSnapshot) resetNamespaceScan(null);
      var page = storage.keys();
      if (
        !isRecord(page)
        || !Array.isArray(page.keys)
        || !Number.isSafeInteger(page.epoch)
      ) {
        resetNamespaceScan(null);
        return { keys: [], complete: false, overflow: false, length: null };
      }
      if (page.unsupported === true) {
        return {
          keys: [],
          complete: true,
          overflow: false,
          length: null,
          enumerationUnavailable: true,
        };
      }
      if (
        page.epoch !== namespaceScanEpoch
        || page.length !== namespaceScanLength
        || (page.cursor === 0 && page.scanned === 0)
      ) resetNamespaceScan(page);
      namespaceScanScanned += boundedInteger(
        page.scanned,
        0,
        STORAGE_KEY_HARD_LIMIT
      );
      page.keys.forEach(function(key) {
        if (!isOutboxNamespaceKey(key) || namespaceScanKeys[key]) return;
        if (namespaceScanKeyCount >= OUTBOX_MAX_STORAGE_KEYS + 1) {
          namespaceScanOverflow = true;
          return;
        }
        namespaceScanKeys[key] = true;
        namespaceScanKeyCount += 1;
      });
      var snapshot = {
        keys: Object.keys(namespaceScanKeys).sort(),
        complete: page.complete === true
          && namespaceScanScanned === page.length
          && !namespaceScanOverflow,
        overflow: namespaceScanOverflow,
        length: page.length,
        digest: '',
      };
      if (snapshot.complete) {
        var verification = completeNamespaceProof();
        if (
          verification.complete
          && !verification.overflow
          && namespaceKeysMatch(snapshot, verification)
        ) {
          snapshot.digest = verification.digest;
          snapshot.length = verification.length;
          completeNamespaceSnapshot = snapshot;
        } else {
          snapshot.complete = false;
          resetNamespaceScan(null);
        }
      }
      return snapshot;
    }

    function namespaceBudgetAllows(replacementKey, replacementValue) {
      var keyCount = storage.keyCount;
      if (keyCount == null) return true;
      var keySnapshot = namespaceKeySnapshot();
      if (!keySnapshot.complete || keySnapshot.overflow) return false;
      var keys = keySnapshot.keys;
      var namespaceCount = 0;
      var namespaceBytes = 0;
      var replacementSeen = false;
      var seen = Object.create(null);
      for (var index = 0; index < keys.length; index += 1) {
        var key = keys[index];
        if (!isOutboxNamespaceKey(key) || seen[key]) continue;
        seen[key] = true;
        var raw = key === replacementKey
          ? replacementValue
          : storage.getItem(key);
        if (typeof raw !== 'string') return false;
        if (key === replacementKey) replacementSeen = true;
        namespaceCount += 1;
        namespaceBytes += utf8ByteLength(key) + utf8ByteLength(raw);
        if (
          namespaceCount > OUTBOX_MAX_STORAGE_KEYS
          || namespaceBytes > OUTBOX_MAX_BYTES
        ) return false;
      }
      if (!replacementSeen && replacementValue != null) {
        namespaceCount += 1;
        namespaceBytes += utf8ByteLength(replacementKey)
          + utf8ByteLength(replacementValue);
      }
      return namespaceCount <= OUTBOX_MAX_STORAGE_KEYS
        && namespaceBytes <= OUTBOX_MAX_BYTES;
    }

    function persistAcknowledgement(record) {
      var digest = sha256Hex(record.body);
      var entry = localAcknowledgements[record.sessionId];
      if (!entry || entry.digest !== digest) {
        entry = {
          sessionId: record.sessionId,
          digest: digest,
          confirmedAt: boundedInteger(
            record.confirmedAt == null ? clock() : record.confirmedAt,
            0,
            Number.MAX_SAFE_INTEGER
          ),
          status: record.deliveryResult && record.deliveryResult.status,
          completeness: record.deliveryResult && record.deliveryResult.completeness,
          duplicate: !!(record.deliveryResult && record.deliveryResult.duplicate),
          delivery: record.deliveryResult && record.deliveryResult.delivery,
          code: cleanString(
            record.deliveryResult && record.deliveryResult.code,
            32,
            /^[A-Z0-9_]+$/
          ),
          deliveryResult: record.deliveryResult || publicDeliveryResult(null),
        };
      }
      record.ackDigest = entry.digest;
      record.confirmedAt = entry.confirmedAt;
      acknowledgements[entry.sessionId] = entry;
      localAcknowledgements[entry.sessionId] = entry;
      var entries = Object.keys(localAcknowledgements).map(function(sessionId) {
        return localAcknowledgements[sessionId];
      }).sort(function(left, right) {
        return right.confirmedAt - left.confirmedAt
          || left.sessionId.localeCompare(right.sessionId);
      }).slice(0, OUTBOX_MAX_COUNT);
      localAcknowledgements = Object.create(null);
      entries.forEach(function(item) {
        localAcknowledgements[item.sessionId] = item;
      });
      var token = '';
      for (var lockAttempt = 0; lockAttempt < 2 && !token; lockAttempt += 1) {
        token = acquireStorageLock(lockAttempt > 0);
      }
      if (!token) return false;
      try {
        writerAckRevision += 1;
        var serialized;
        try {
          serialized = JSON.stringify({
            version: 1,
            writer: writerId,
            revision: writerAckRevision,
            lockEpoch: activeLockEpochs[token],
            entries: entries,
          });
        } catch (_) {
          return false;
        }
        if (utf8ByteLength(serialized) > OUTBOX_MAX_BYTES) return false;
        if (!ownsStorageLock(token)) return false;
        if (!namespaceBudgetAllows(writerAckShardKey, serialized)) return false;
        var written = storage.setItem(writerAckShardKey, serialized);
        if (!written) written = storage.setItem(writerAckShardKey, serialized, true);
        if (!written || !ownsStorageLock(token)) return false;
        if (storage.getItem(writerAckShardKey) !== serialized) return false;
        if (!ownsStorageLock(token)) return false;
        entries.forEach(function(item) {
          durableAcknowledgements[item.sessionId] = item.digest;
        });
        return true;
      } finally {
        releaseStorageLock(token);
      }
    }

    function applyDurableAcknowledgements() {
      Object.keys(records).forEach(function(sessionId) {
        var record = records[sessionId];
        var payload = reportPayload(record && record.event);
        if (!payloadDurablyAcknowledged(payload)) return;
        record.state = 'sent';
        var acknowledgement = acknowledgements[sessionId];
        record.deliveryResult = acknowledgement && acknowledgement.deliveryResult
          ? acknowledgement.deliveryResult
          : publicDeliveryResult(null);
        record.nextAttemptAt = 0;
        record.lastErrorCode = '';
      });
    }

    function pendingRecords() {
      return Object.keys(records).map(function(key) {
        return records[key];
      }).filter(function(record) {
        return record.state === 'pending'
          || record.state === 'inflight'
          || record.state === 'queued'
          || record.state === 'ack-pending';
      }).sort(function(left, right) {
        return left.createdAt - right.createdAt
          || left.sessionId.localeCompare(right.sessionId);
      });
    }

    function readOutboxSnapshot() {
      if (!storage || typeof storage.getItem !== 'function') {
        return { raw: null, document: null };
      }
      try {
        var raw = storage.getItem(OUTBOX_KEY);
        if (!raw) return { raw: null, document: null };
        if (utf8ByteLength(raw) > OUTBOX_MAX_BYTES) {
          return { raw: raw, document: null };
        }
        var value = JSON.parse(raw);
        if (
          !isRecord(value)
          || (value.version !== 1 && value.version !== 2)
          || !Array.isArray(value.entries)
        ) return { raw: raw, document: null };
        return { raw: raw, document: value };
      } catch (_) {
        return null;
      }
    }

    function readOutboxDocument() {
      var snapshot = readOutboxSnapshot();
      return snapshot && snapshot.document;
    }

    function outboxEntry(record) {
      var entry = {
        event: persistentEvent(record.event),
        accountProof: cleanString(record.accountProof, 32, /^[a-f0-9]{32}$/),
        attempts: record.attempts,
        nextAttemptAt: record.nextAttemptAt,
        createdAt: record.createdAt,
        state: record.state,
        lastErrorCode: cleanString(
          record.lastErrorCode,
          32,
          /^[A-Z0-9_]+$/
        ),
      };
      if (record.state === 'ack-pending') {
        entry.ackAttempts = boundedInteger(record.ackAttempts, 0, 1000);
        entry.ackDigest = cleanString(record.ackDigest, 64, /^[a-f0-9]{64}$/);
        entry.confirmedAt = boundedInteger(
          record.confirmedAt,
          0,
          Number.MAX_SAFE_INTEGER
        );
        entry.status = record.deliveryResult && record.deliveryResult.status;
        entry.completeness = record.deliveryResult
          && record.deliveryResult.completeness;
        entry.duplicate = !!(
          record.deliveryResult
          && record.deliveryResult.duplicate
        );
        entry.delivery = record.deliveryResult && record.deliveryResult.delivery;
        entry.code = cleanString(
          record.deliveryResult && record.deliveryResult.code,
          32,
          /^[A-Z0-9_]+$/
        );
      }
      return entry;
    }

    function outboxShardKeys(providedSnapshot) {
      var snapshot = providedSnapshot || namespaceKeySnapshot();
      return {
        complete: snapshot.complete,
        overflow: snapshot.overflow,
        keys: snapshot.keys.filter(function(key) {
          return typeof key === 'string'
            && key.indexOf(OUTBOX_SHARD_PREFIX) === 0;
        }).sort(),
      };
    }

    function readShardState(providedSnapshot) {
      var keySnapshot = outboxShardKeys(providedSnapshot);
      var entries = [];
      var documents = [];
      var totalBytes = 0;
      var overflow = keySnapshot.overflow;
      keySnapshot.keys.forEach(function(key) {
        if (overflow) return;
        try {
          var raw = storage.getItem(key);
          if (!raw || utf8ByteLength(raw) > OUTBOX_MAX_BYTES) return;
          totalBytes += utf8ByteLength(raw);
          if (totalBytes > OUTBOX_MAX_BYTES) {
            overflow = true;
            return;
          }
          var document = JSON.parse(raw);
          if (
            !isRecord(document)
            || (document.version !== 1 && document.version !== 2)
            || !Array.isArray(document.entries)
            || document.entries.length > OUTBOX_MAX_COUNT
          ) {
            return;
          }
          entries = entries.concat(document.entries);
          if (entries.length > OUTBOX_MAX_COUNT) {
            overflow = true;
            return;
          }
          documents.push({
            key: key,
            writer: cleanString(document.writer, 128, /^[A-Za-z0-9._:-]+$/),
            generation: cleanString(
              document.generation,
              128,
              /^[A-Za-z0-9._:-]+$/
            ),
            createdAt: boundedInteger(document.createdAt, 0, Number.MAX_SAFE_INTEGER),
            lastSeen: boundedInteger(
              document.lastSeen == null ? document.createdAt : document.lastSeen,
              0,
              Number.MAX_SAFE_INTEGER
            ),
            revision: boundedInteger(document.revision, 0, Number.MAX_SAFE_INTEGER),
            lockEpoch: boundedInteger(document.lockEpoch, 0, Number.MAX_SAFE_INTEGER),
            entries: document.entries,
            raw: raw,
          });
        } catch (_) {}
      });
      return {
        entries: entries,
        documents: documents,
        overflow: overflow,
        complete: keySnapshot.complete,
      };
    }

    function readShardEntries() {
      var state = readShardState();
      return state.overflow ? [] : state.entries;
    }

    function captureOutboxGeneration(providedSnapshot) {
      var main = readOutboxSnapshot();
      if (!main) return null;
      var keySnapshot = outboxShardKeys(providedSnapshot);
      if (!keySnapshot.complete || keySnapshot.overflow) return null;
      var keys = keySnapshot.keys;
      var raws = Object.create(null);
      var mainEntries = (main.document && main.document.entries || []).slice();
      var entries = mainEntries.slice();
      var documents = [];
      var totalBytes = 0;
      for (var index = 0; index < keys.length; index += 1) {
        var raw = storage.getItem(keys[index]);
        if (typeof raw !== 'string') return null;
        totalBytes += utf8ByteLength(raw);
        if (totalBytes > OUTBOX_MAX_BYTES) return null;
        raws[keys[index]] = raw;
        try {
          var document = JSON.parse(raw);
          if (
            isRecord(document)
            && (document.version === 1 || document.version === 2)
            && Array.isArray(document.entries)
            && document.entries.length <= OUTBOX_MAX_COUNT
          ) {
            entries = entries.concat(document.entries);
            documents.push({
              key: keys[index],
              generation: cleanString(
                document.generation,
                128,
                /^[A-Za-z0-9._:-]+$/
              ),
              createdAt: boundedInteger(
                document.createdAt,
                0,
                Number.MAX_SAFE_INTEGER
              ),
              lastSeen: boundedInteger(
                document.lastSeen == null ? document.createdAt : document.lastSeen,
                0,
                Number.MAX_SAFE_INTEGER
              ),
              entries: document.entries,
            });
          }
        } catch (_) {}
      }
      return {
        mainRaw: main.raw,
        keys: keys,
        raws: raws,
        mainEntries: mainEntries,
        documents: documents,
        entries: entries,
      };
    }

    function generationMatches(generation, token, providedSnapshot) {
      if (!generation || !ownsStorageLock(token)) return false;
      var main = readOutboxSnapshot();
      if (!main || main.raw !== generation.mainRaw) return false;
      var keySnapshot = outboxShardKeys(providedSnapshot);
      if (!keySnapshot.complete || keySnapshot.overflow) return false;
      var keys = keySnapshot.keys;
      if (keys.length !== generation.keys.length) return false;
      for (var index = 0; index < keys.length; index += 1) {
        if (
          keys[index] !== generation.keys[index]
          || storage.getItem(keys[index]) !== generation.raws[keys[index]]
        ) return false;
      }
      return ownsStorageLock(token);
    }

    function acknowledgementNeeded(entry, generation) {
      function matches(item) {
        var payload = reportPayload(item && item.event);
        return payload
          && payload.sessionId === entry.sessionId
          && sha256Hex(payload.body) === entry.digest;
      }
      if (generation.mainEntries.some(matches)) return true;
      var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      return generation.documents.some(function(document) {
        return document.entries.some(matches)
          || (
            now - document.lastSeen <= OUTBOX_WRITER_LEASE_MS
            && document.createdAt <= entry.confirmedAt
          );
      });
    }

    function persistCleanupMarker(document, token, now) {
      if (!document || !document.entries.length || !ownsStorageLock(token)) {
        return false;
      }
      var key = OUTBOX_CLEANUP_MARKER_PREFIX
        + sha256Hex(document.key).slice(0, 32);
      var serialized;
      try {
        serialized = JSON.stringify({
          version: 1,
          cleanup: true,
          createdAt: now,
          lockEpoch: activeLockEpochs[token],
          entries: document.entries,
        });
      } catch (_) {
        return false;
      }
      if (
        utf8ByteLength(serialized) > OUTBOX_MAX_BYTES
        || !namespaceBudgetAllows(key, serialized)
        || !ownsStorageLock(token)
      ) return false;
      if (!storage.setItem(key, serialized, true)) return false;
      return ownsStorageLock(token) && storage.getItem(key) === serialized;
    }

    function cleanupAcknowledgementShards() {
      var token = acquireStorageLock();
      if (!token) return false;
      try {
        var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
        var proofBefore = completeNamespaceProof();
        if (!proofBefore.complete || proofBefore.overflow) return false;
        var state = readAcknowledgementState(proofBefore);
        if (!state.complete || state.overflow) return false;
        var generation = captureOutboxGeneration(proofBefore);
        if (!generation) return false;
        var proofAfter = completeNamespaceProof();
        if (!namespaceProofMatches(proofBefore, proofAfter)) return false;
        var acknowledgedDigests = Object.create(null);
        state.entries.forEach(function(entry) {
          acknowledgedDigests[entry.sessionId] = entry.digest;
        });
        for (
          var shardIndex = 0;
          shardIndex < generation.documents.length;
          shardIndex += 1
        ) {
          var shard = generation.documents[shardIndex];
          if (now - shard.lastSeen <= OUTBOX_WRITER_LEASE_MS) continue;
          var fullyAcknowledged = shard.entries.length > 0
            && shard.entries.every(function(item) {
              var payload = reportPayload(item && item.event);
              return payload
                && acknowledgedDigests[payload.sessionId] === sha256Hex(payload.body);
            });
          if (!fullyAcknowledged) continue;
          if (!generationMatches(generation, token, proofAfter)) return false;
          if (storage.getItem(shard.key) !== generation.raws[shard.key]) return false;
          if (!storage.removeItem(shard.key)) return false;
          if (!ownsStorageLock(token)) return false;
          return false;
        }
        for (var index = 0; index < state.documents.length; index += 1) {
          var document = state.documents[index];
          if (!document.entries.length) continue;
          if (document.cleanup === true) {
            if (
              document.createdAt > now
              || now - document.createdAt < OUTBOX_WRITER_LEASE_MS
            ) continue;
          }
          var removable = document.entries.every(function(entry) {
            return now - entry.confirmedAt >= OUTBOX_SHARD_SETTLE_MS
              && !acknowledgementNeeded(entry, generation);
          });
          if (
            !removable
            || !generationMatches(generation, token, proofAfter)
          ) continue;
          if (storage.getItem(document.key) !== document.raw) continue;
          if (!generationMatches(generation, token, proofAfter)) return false;
          if (
            document.cleanup !== true
            && !persistCleanupMarker(document, token, now)
          ) return false;
          if (!storage.removeItem(document.key)) return false;
          if (!ownsStorageLock(token)) return false;
          var proofDeleted = completeNamespaceProof();
          if (!proofDeleted.complete || proofDeleted.overflow) return false;
          document.entries.forEach(function(entry) {
            var current = acknowledgements[entry.sessionId];
            if (current && current.digest === entry.digest) {
              delete acknowledgements[entry.sessionId];
            }
            if (durableAcknowledgements[entry.sessionId] === entry.digest) {
              delete durableAcknowledgements[entry.sessionId];
            }
            var local = localAcknowledgements[entry.sessionId];
            if (local && local.digest === entry.digest) {
              delete localAcknowledgements[entry.sessionId];
            }
          });
        }
        return true;
      } finally {
        releaseStorageLock(token);
      }
    }

    function pendingCapacityAllows(writerEntries) {
      var snapshot = readOutboxSnapshot();
      if (!snapshot) return false;
      var shardState = readShardState();
      if (!shardState.complete || shardState.overflow) return false;
      var pending = Object.create(null);
      function include(item) {
        var payload = reportPayload(item && item.event);
        if (!payload || payloadAcknowledged(payload)) return;
        pending[payload.sessionId] = true;
      }
      (snapshot.document && snapshot.document.entries || []).forEach(include);
      shardState.documents.forEach(function(document) {
        if (document.key === writerShardKey) return;
        document.entries.forEach(include);
      });
      writerEntries.forEach(include);
      return Object.keys(pending).length <= OUTBOX_MAX_COUNT;
    }

    function writeWriterShard(token, force) {
      writerShardFailureCode = '';
      if (!ownsStorageLock(token)) return false;
      var entries = pendingRecords().filter(function(record) {
        return record.writerOwned === true;
      }).map(outboxEntry);
      if (entries.length > OUTBOX_MAX_COUNT) return false;
      if (!pendingCapacityAllows(entries)) {
        writerShardFailureCode = 'OUTBOX_CAPACITY';
        return false;
      }
      writerShardRevision += 1;
      writerLastSeen = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      var serialized;
      try {
        serialized = JSON.stringify({
          version: 2,
          writer: writerId,
          generation: writerGeneration,
          createdAt: writerCreatedAt,
          lastSeen: writerLastSeen,
          revision: writerShardRevision,
          lockEpoch: activeLockEpochs[token],
          entries: entries,
        });
      } catch (_) {
        return false;
      }
      if (utf8ByteLength(serialized) > OUTBOX_MAX_BYTES) return false;
      if (!ownsStorageLock(token)) return false;
      if (!namespaceBudgetAllows(writerShardKey, serialized)) {
        writerShardFailureCode = 'OUTBOX_CAPACITY';
        return false;
      }
      if (!storage.setItem(writerShardKey, serialized, force === true)) {
        writerShardFailureCode = 'SHARD_WRITE_FAILED';
        return false;
      }
      if (!ownsStorageLock(token)) {
        writerShardFailureCode = 'STORAGE_OWNERSHIP_LOST';
        return false;
      }
      if (storage.getItem(writerShardKey) !== serialized) {
        writerShardFailureCode = 'SHARD_VERIFY_FAILED';
        return false;
      }
      if (!ownsStorageLock(token)) {
        writerShardFailureCode = 'STORAGE_OWNERSHIP_LOST';
        return false;
      }
      writerGenerationPublished = true;
      return true;
    }

    function ownsWriterGeneration(token) {
      if (!ownsStorageLock(token)) return false;
      try {
        var raw = storage.getItem(writerShardKey);
        if (!raw) return false;
        var document = JSON.parse(raw);
        return isRecord(document)
          && document.writer === writerId
          && document.generation === writerGeneration
          && document.revision === writerShardRevision
          && document.lastSeen === writerLastSeen
          && ownsStorageLock(token);
      } catch (_) {
        return false;
      }
    }

    function storedWriterGenerationMatches(token) {
      if (!writerGenerationPublished || !ownsStorageLock(token)) return true;
      try {
        var raw = storage.getItem(writerShardKey);
        if (!raw) return false;
        var document = JSON.parse(raw);
        return isRecord(document)
          && document.writer === writerId
          && document.generation === writerGeneration
          && ownsStorageLock(token);
      } catch (_) {
        return false;
      }
    }

    function pruneAcknowledgedShards(token) {
      if (!ownsStorageLock(token)) return;
      var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      var sent = Object.create(null);
      Object.keys(records).forEach(function(sessionId) {
        if (records[sessionId].state === 'sent') sent[sessionId] = true;
      });
      var proofBefore = completeNamespaceProof();
      if (!proofBefore.complete || proofBefore.overflow) return;
      var shardState = readShardState(proofBefore);
      if (!shardState.complete || shardState.overflow) return;
      var proofAfter = completeNamespaceProof();
      if (!namespaceProofMatches(proofBefore, proofAfter)) return;
      shardState.documents.forEach(function(shard) {
        try {
          var raw = shard.raw;
          var generation = shard.generation;
          var lastSeen = shard.lastSeen;
          var ownGeneration = shard.key === writerShardKey
            && generation === writerGeneration;
          if (ownGeneration) return;
          if (now - lastSeen <= OUTBOX_WRITER_LEASE_MS) return;
          var entries = shard.entries.filter(function(item) {
            var payload = reportPayload(item && item.event);
            return !payload || (
              !sent[payload.sessionId]
              && !payloadDurablyAcknowledged(payload)
            );
          });
          if (!ownsStorageLock(token)) return;
          if (storage.getItem(shard.key) !== raw) return;
          if (!ownsStorageLock(token)) return;
          if (!entries.length) {
            storage.removeItem(shard.key);
          } else if (entries.length !== shard.entries.length) {
            storage.setItem(shard.key, JSON.stringify({
              version: 2,
              writer: shard.writer,
              generation: generation,
              createdAt: shard.createdAt,
              lastSeen: lastSeen,
              revision: shard.revision + 1,
              lockEpoch: shard.lockEpoch,
              entries: entries,
            }));
          }
        } catch (_) {}
      });
    }

    function cleanupRedundantShards(document, token) {
      if (!document || !ownsStorageLock(token)) return;
      var canonical = Object.create(null);
      (document.entries || []).forEach(function(item) {
        var payload = reportPayload(item && item.event);
        if (payload) canonical[payload.sessionId] = payload.body;
      });
      var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      var proofBefore = completeNamespaceProof();
      if (!proofBefore.complete || proofBefore.overflow) return;
      var shardState = readShardState(proofBefore);
      if (!shardState.complete || shardState.overflow) return;
      var proofAfter = completeNamespaceProof();
      if (!namespaceProofMatches(proofBefore, proofAfter)) return;
      shardState.documents.forEach(function(shard) {
        if (!ownsStorageLock(token)) return;
        if (
          shard.key === writerShardKey
          && shard.generation === writerGeneration
        ) return;
        if (now - shard.lastSeen <= OUTBOX_WRITER_LEASE_MS) return;
        var redundant = shard.entries.every(function(item) {
          var payload = reportPayload(item && item.event);
          return payload && canonical[payload.sessionId] === payload.body;
        });
        if (!redundant) return;
        storage.removeItem(shard.key);
      });
    }

    function acquireStorageLock(force) {
      if (!storage.available) return '';
      var token = writerId + ':' + String(clock()) + ':' + String(random());
      try {
        var existingRaw = storage.getItem(OUTBOX_LOCK_KEY);
        if (existingRaw) {
          var existing = JSON.parse(existingRaw);
          if (isRecord(existing) && finite(existing.expiresAt, 0) > finite(clock(), 0)) {
            return '';
          }
        }
        var currentEpoch = boundedInteger(
          Number(storage.getItem(OUTBOX_LOCK_EPOCH_KEY) || 0),
          0,
          Number.MAX_SAFE_INTEGER - 1
        );
        if (currentEpoch === null) return '';
        var epoch = currentEpoch + 1;
        if (!storage.setItem(OUTBOX_LOCK_EPOCH_KEY, String(epoch), force === true)) {
          return '';
        }
        if (Number(storage.getItem(OUTBOX_LOCK_EPOCH_KEY)) !== epoch) return '';
        if (!storage.setItem(OUTBOX_LOCK_KEY, JSON.stringify({
          token: token,
          epoch: epoch,
          expiresAt: boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER) + STORAGE_LOCK_TTL_MS,
        }), force === true)) return '';
        var confirmed = JSON.parse(storage.getItem(OUTBOX_LOCK_KEY) || '{}');
        if (
          confirmed.token !== token
          || confirmed.epoch !== epoch
          || Number(storage.getItem(OUTBOX_LOCK_EPOCH_KEY)) !== epoch
        ) return '';
        activeLockEpochs[token] = epoch;
        return token;
      } catch (_) {
        return '';
      }
    }

    function releaseStorageLock(token) {
      if (!token) return;
      try {
        var current = JSON.parse(storage.getItem(OUTBOX_LOCK_KEY) || '{}');
        if (current.token === token) {
          storage.setItem(OUTBOX_LOCK_KEY, JSON.stringify({
            token: '',
            epoch: current.epoch,
            expiresAt: 0,
          }), true);
        }
      } catch (_) {}
      delete activeLockEpochs[token];
    }

    function ownsStorageLock(token) {
      if (!token || !storage.available) return false;
      try {
        var current = JSON.parse(storage.getItem(OUTBOX_LOCK_KEY) || '{}');
        return current.token === token
          && current.epoch === activeLockEpochs[token]
          && Number(storage.getItem(OUTBOX_LOCK_EPOCH_KEY)) === current.epoch
          && finite(current.expiresAt, 0) > finite(clock(), 0);
      } catch (_) {
        return false;
      }
    }

    function persistenceResult(durable, code) {
      return { durable: durable === true, code: code || (durable ? 'DURABLE' : 'MEMORY_ONLY') };
    }

    function persistOutbox(force) {
      if (!storage.available) {
        return persistenceResult(
          false,
          storage.unavailableCode || 'STORAGE_TRANSIENT_FAILURE'
        );
      }
      for (var writeAttempt = 0; writeAttempt < 4; writeAttempt += 1) {
        var token = acquireStorageLock(force === true);
        if (!token) return persistenceResult(false, 'STORAGE_LOCK_UNAVAILABLE');
        try {
          if (pendingRecords().length) {
            restoreAcknowledgements();
            applyDurableAcknowledgements();
          }
          var writerFenced = !storedWriterGenerationMatches(token);
          var cleanupOnly = writerFenced && pendingRecords().length === 0;
          if (writerFenced && !cleanupOnly) {
            return persistenceResult(false, 'WRITER_GENERATION_FENCED');
          }
          pruneAcknowledgedShards(token);
          if (!cleanupOnly && !writeWriterShard(token, force)) {
            return persistenceResult(
              false,
              writerShardFailureCode || 'SHARD_WRITE_FAILED'
            );
          }
          var snapshot = readOutboxSnapshot();
          if (!snapshot) return persistenceResult(false, 'OUTBOX_READ_FAILED');
          var existing = snapshot.document;
          var merged = Object.create(null);
          var shardState = readShardState();
          if (!storage.available) {
            return persistenceResult(
              false,
              storage.unavailableCode || 'STORAGE_TRANSIENT_FAILURE'
            );
          }
          if (!shardState.complete) {
            return persistenceResult(false, 'OUTBOX_SNAPSHOT_INCOMPLETE');
          }
          if (shardState.overflow) {
            return persistenceResult(false, 'OUTBOX_CAPACITY');
          }
          var durableEntries = (existing && existing.entries || [])
            .slice(0, OUTBOX_MAX_COUNT)
            .concat(shardState.entries);
          durableEntries.forEach(function(item) {
            if (!isRecord(item)) return;
            var legacyBinding = cleanString(
              item.event && item.event.reportingBinding,
              97,
              /^[a-f0-9]{32}\.[a-f0-9]{64}$/
            );
            var payload = reportPayload(item.event, legacyBinding, true);
            if (!payload || payload.error) return;
            var accountProof = cleanString(
              item.accountProof,
              32,
              /^[a-f0-9]{32}$/
            ) || sessionAccountProof(legacyBinding, payload.sessionId);
            if (payloadAcknowledged(payload)) return;
            var local = records[payload.sessionId];
            if (local && local.state === 'sent') return;
            merged[payload.sessionId] = {
              event: persistentEvent(payload.event),
              attempts: boundedInteger(item.attempts, 0, 1000),
              nextAttemptAt: boundedInteger(item.nextAttemptAt, 0, Number.MAX_SAFE_INTEGER),
              createdAt: boundedInteger(item.createdAt, 0, Number.MAX_SAFE_INTEGER),
              state: cleanString(
                item.state,
                16,
                /^(pending|inflight|queued|ack-pending)$/
              ) || 'pending',
              lastErrorCode: cleanString(item.lastErrorCode, 32, /^[A-Z0-9_]+$/),
              accountProof: accountProof,
              ackAttempts: boundedInteger(item.ackAttempts, 0, 1000),
              ackDigest: cleanString(item.ackDigest, 64, /^[a-f0-9]{64}$/),
              confirmedAt: boundedInteger(
                item.confirmedAt,
                0,
                Number.MAX_SAFE_INTEGER
              ),
            };
          });
          pendingRecords().forEach(function(record) {
            merged[record.sessionId] = outboxEntry(record);
          });
          Object.keys(records).forEach(function(sessionId) {
            if (records[sessionId].state === 'sent') delete merged[sessionId];
          });
          var entries = Object.keys(merged).map(function(sessionId) {
            return merged[sessionId];
          }).sort(function(left, right) {
            return left.createdAt - right.createdAt
              || left.event.sessionId.localeCompare(right.event.sessionId);
          });
          if (entries.length > OUTBOX_MAX_COUNT) {
            return persistenceResult(false, 'OUTBOX_CAPACITY');
          }
          var currentSnapshot = readOutboxSnapshot();
          if (
            !currentSnapshot
            || currentSnapshot.raw !== snapshot.raw
            || !ownsStorageLock(token)
          ) {
            continue;
          }
          if (!entries.length) {
            try {
              if (!storage.removeItem(OUTBOX_KEY)) {
                return persistenceResult(false, 'OUTBOX_REMOVE_FAILED');
              }
              var removed = readOutboxSnapshot();
              if (
                removed
                && removed.raw === null
                && (cleanupOnly || ownsWriterGeneration(token))
              ) {
                return persistenceResult(true, 'DURABLE_EMPTY');
              }
            } catch (_) {
              return persistenceResult(false, 'OUTBOX_REMOVE_FAILED');
            }
            continue;
          }
          var document = {
            version: 2,
            revision: boundedInteger(existing && existing.revision, 0, Number.MAX_SAFE_INTEGER) + 1,
            writer: writerId,
            lockEpoch: activeLockEpochs[token],
            entries: entries,
          };
          var serialized;
          try {
            serialized = JSON.stringify(document);
          } catch (_) {
            return persistenceResult(false, 'OUTBOX_SERIALIZE_FAILED');
          }
          if (utf8ByteLength(serialized) > OUTBOX_MAX_BYTES) {
            return persistenceResult(false, 'OUTBOX_CAPACITY');
          }
          if (!namespaceBudgetAllows(OUTBOX_KEY, serialized)) {
            return persistenceResult(false, 'OUTBOX_CAPACITY');
          }
          try {
            if (!storage.setItem(OUTBOX_KEY, serialized, force === true)) {
              return persistenceResult(false, 'OUTBOX_WRITE_FAILED');
            }
            var verified = readOutboxDocument();
            var verifiedIds = (verified && verified.entries || []).map(function(item) {
              return item && item.event && item.event.sessionId;
            });
            var requiredIds = pendingRecords().map(function(record) {
              return record.sessionId;
            });
            var verificationShards = readShardState();
            if (!verificationShards.complete || verificationShards.overflow) {
              return persistenceResult(false, 'OUTBOX_SNAPSHOT_INCOMPLETE');
            }
            verificationShards.entries.forEach(function(item) {
              var payload = reportPayload(item && item.event);
              if (
                payload
                && !payloadAcknowledged(payload)
                && requiredIds.indexOf(payload.sessionId) < 0
              ) requiredIds.push(payload.sessionId);
            });
            if (
              ownsStorageLock(token)
              && (cleanupOnly || ownsWriterGeneration(token))
              && verified
              && verified.writer === writerId
              && verified.lockEpoch === activeLockEpochs[token]
              && requiredIds.every(function(sessionId) {
                return verifiedIds.indexOf(sessionId) >= 0;
              })
            ) {
              cleanupRedundantShards(verified, token);
              return persistenceResult(true, 'DURABLE');
            }
          } catch (_) {
            return persistenceResult(false, 'OUTBOX_VERIFY_FAILED');
          }
        } finally {
          releaseStorageLock(token);
        }
      }
      return persistenceResult(false, 'OUTBOX_WRITE_CONFLICT');
    }

    function restoreOutbox() {
      var parsed = readOutboxDocument();
      var restored = Object.create(null);
      (parsed && parsed.entries || []).concat(readShardEntries()).forEach(function(item) {
        if (!isRecord(item)) return;
        var legacyBinding = cleanString(
          item.event && item.event.reportingBinding,
          97,
          /^[a-f0-9]{32}\.[a-f0-9]{64}$/
        );
        var payload = reportPayload(item.event, legacyBinding, true);
        if (
          !payload
          || payload.error
          || payloadAcknowledged(payload)
          || restored[payload.sessionId]
        ) return;
        var accountProof = cleanString(
          item.accountProof,
          32,
          /^[a-f0-9]{32}$/
        ) || sessionAccountProof(legacyBinding, payload.sessionId);
        var ackDigest = cleanString(item.ackDigest, 64, /^[a-f0-9]{64}$/);
        var acknowledgementPending = item.state === 'ack-pending'
          && ackDigest === sha256Hex(payload.body);
        restored[payload.sessionId] = {
          sessionId: payload.sessionId,
          event: persistentEvent(payload.event),
          body: payload.body,
          reportingBinding: legacyBinding,
          accountProof: accountProof,
          state: acknowledgementPending ? 'ack-pending' : 'pending',
          attempts: boundedInteger(item.attempts, 0, 1000),
          nextAttemptAt: boundedInteger(item.nextAttemptAt, 0, Number.MAX_SAFE_INTEGER),
          createdAt: boundedInteger(item.createdAt, 0, Number.MAX_SAFE_INTEGER),
          promise: null,
          durable: true,
          lastErrorCode: cleanString(item.lastErrorCode, 32, /^[A-Z0-9_]+$/),
          ackAttempts: acknowledgementPending
            ? boundedInteger(item.ackAttempts, 0, 1000)
            : 0,
          ackDigest: acknowledgementPending ? ackDigest : '',
          confirmedAt: acknowledgementPending
            ? boundedInteger(item.confirmedAt, 0, Number.MAX_SAFE_INTEGER)
            : 0,
          deliveryResult: acknowledgementPending
            ? normalizeDeliveryResult({
              delivery: item.delivery,
              status: item.status,
              completeness: item.completeness,
              duplicate: item.duplicate,
              code: item.code,
            })
            : null,
          writerOwned: false,
        };
      });
      Object.keys(restored).sort(function(left, right) {
        return restored[left].createdAt - restored[right].createdAt
          || left.localeCompare(right);
      }).slice(0, OUTBOX_MAX_COUNT).forEach(function(sessionId) {
        records[sessionId] = restored[sessionId];
      });
    }

    function markPending(record, errorCode, minimumDelayMs) {
      record.state = 'pending';
      record.attempts += 1;
      var retryDelay = Math.min(
        maxRetryMs,
        baseRetryMs * Math.pow(2, Math.min(20, record.attempts - 1))
      );
      minimumDelayMs = boundedInteger(minimumDelayMs, 0, maxRetryMs);
      record.nextAttemptAt = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER)
        + Math.max(retryDelay, minimumDelayMs || 0);
      record.lastErrorCode = cleanString(errorCode, 32, /^[A-Z0-9_]+$/)
        || 'DELIVERY_FAILED';
      record.durable = persistOutbox().durable;
      schedule();
      return false;
    }

    function markTerminal(record, status, errorCode) {
      record.state = status;
      record.nextAttemptAt = 0;
      record.lastErrorCode = cleanString(errorCode, 32, /^[A-Z0-9_]+$/)
        || 'HTTP_REJECTED';
      record.deliveryResult = {
        accepted: false,
        localRecorded: true,
        delivery: 'terminal',
        status: status,
        code: record.lastErrorCode,
      };
      if (!persistAcknowledgement(record)) {
        return markAcknowledgementPending(record);
      }
      return completeAcknowledgement(record);
    }

    function retryAfterMs(response) {
      var headers = response && response.headers;
      if (!headers || typeof headers.get !== 'function') return 0;
      var raw;
      try {
        raw = headers.get('retry-after');
      } catch (_) {
        return 0;
      }
      if (typeof raw !== 'string' || !/^\d{1,7}$/.test(raw.trim())) return 0;
      var seconds = Number(raw.trim());
      return Number.isSafeInteger(seconds)
        ? Math.min(maxRetryMs, seconds * 1000)
        : 0;
    }

    function persistenceBlocksDelivery(result) {
      if (!result) return false;
      return result.durable !== true && result.code !== 'STORAGE_UNAVAILABLE';
    }

    function markFenced(record) {
      record.state = 'fenced';
      record.nextAttemptAt = 0;
      record.lastErrorCode = 'WRITER_GENERATION_FENCED';
      record.durable = false;
      return false;
    }

    function publicDeliveryResult(value) {
      var status = cleanString(
        value && value.status,
        16,
        /^(pending|submitted|unsupported|uncertain)$/
      ) || 'submitted';
      var delivery = status === 'submitted'
        ? 'submitted'
        : (status === 'pending' ? 'local-only' : status);
      var result = {
        accepted: true,
        localRecorded: true,
        delivery: delivery,
        status: status,
        completeness: ['complete', 'partial', 'unsupported'].indexOf(
          value && value.completeness
        ) >= 0
          ? value.completeness
          : (status === 'submitted' ? 'complete' : 'partial'),
        duplicate: !!(value && value.duplicate),
      };
      var code = cleanString(value && value.code, 32, /^[A-Z0-9_]+$/);
      if (code) result.code = code;
      return result;
    }

    function normalizeDeliveryResult(value) {
      var status = cleanString(
        value && value.status,
        16,
        /^(conflict|rejected)$/
      );
      if (value && value.delivery === 'terminal' && status) {
        return {
          accepted: false,
          localRecorded: true,
          delivery: 'terminal',
          status: status,
          code: cleanString(value.code, 32, /^[A-Z0-9_]+$/)
            || 'HTTP_REJECTED',
        };
      }
      return publicDeliveryResult(value);
    }

    function completeAcknowledgement(record) {
      record.state = 'sent';
      record.nextAttemptAt = 0;
      record.lastErrorCode = '';
      record.durable = persistOutbox().durable;
      cleanupAcknowledgementShards();
      return record.deliveryResult || publicDeliveryResult(null);
    }

    function markAcknowledgementPending(record) {
      record.state = 'ack-pending';
      record.ackAttempts = boundedInteger(record.ackAttempts, 0, 1000) + 1;
      record.nextAttemptAt = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER)
        + Math.min(
          maxRetryMs,
          baseRetryMs * Math.pow(2, Math.min(20, record.ackAttempts - 1))
        );
      record.lastErrorCode = 'ACK_PERSIST_FAILED';
      record.durable = persistOutbox(true).durable;
      schedule();
      return record.deliveryResult || publicDeliveryResult(null);
    }

    function retryAcknowledgement(record) {
      if (!persistAcknowledgement(record)) {
        markAcknowledgementPending(record);
        return false;
      }
      return completeAcknowledgement(record);
    }

    async function deliver(record, submitOptions) {
      if (record.promise) return record.promise;
      restoreAcknowledgements(true);
      applyDurableAcknowledgements();
      if (record.state === 'sent') {
        await Promise.resolve();
        record.durable = persistOutbox().durable;
        cleanupAcknowledgementShards();
        return false;
      }
      submitOptions = isRecord(submitOptions) ? submitOptions : {};
      record.state = 'inflight';
      record.lastErrorCode = '';
      var deliveryPersistence = persistOutbox();
      record.durable = deliveryPersistence.durable;
      if (record.state === 'sent') return false;
      if (deliveryPersistence.code === 'WRITER_GENERATION_FENCED') {
        return markFenced(record);
      }
      if (persistenceBlocksDelivery(deliveryPersistence)) {
        return markPending(record, 'STORAGE_GATE_UNAVAILABLE');
      }
      var deliveryPayload = reportPayload(record.event, record.reportingBinding);
      if (!deliveryPayload || deliveryPayload.error) {
        return markPending(record, 'LOGIN_REQUIRED');
      }
      var currentProof = sessionAccountProof(
        deliveryPayload.event.reportingBinding,
        deliveryPayload.sessionId
      );
      if (
        deliveryPayload.event.playbackProvider === 'netease'
        && (!record.accountProof || currentProof !== record.accountProof)
      ) {
        return markPending(record, 'ACCOUNT_CHANGED');
      }
      record.body = deliveryPayload.body;
      record.promise = (async function() {
        if (submitOptions.unload && typeof sendBeacon === 'function') {
          try {
            if (sendBeacon('/api/listen/report', record.body)) {
              record.state = 'queued';
              record.nextAttemptAt = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
              record.durable = persistOutbox().durable;
              if (record.durable) {
                record.deliveryResult = publicDeliveryResult({
                  status: 'pending',
                  completeness: 'partial',
                });
                return record.deliveryResult;
              }
              record.state = 'inflight';
            }
          } catch (_) {}
        }
        if (typeof fetchImpl !== 'function') {
          return markPending(record, 'TRANSPORT_UNAVAILABLE');
        }
        var controller = AbortControllerOption ? new AbortControllerOption() : null;
        var cancelDelivery = null;
        var cancellation = new Promise(function(resolve) {
          cancelDelivery = function(code) {
            if (!cancelDelivery) return;
            cancelDelivery = null;
            resolve({ kind: 'cancelled', code: code });
          };
        });
        var requestTimer = safeSetTimer(function() {
          if (controller) {
            try { controller.abort(); } catch (_) {}
          }
          if (cancelDelivery) cancelDelivery('REQUEST_TIMEOUT');
        }, timeoutMs);
        if (!requestTimer) {
          cancelDelivery = null;
          return markPending(record, 'TIMER_UNAVAILABLE');
        }
        var activeRequest = {
          controller: controller,
          timer: requestTimer,
          cancel: function(code) {
            if (cancelDelivery) cancelDelivery(code || 'DELIVERY_CANCELLED');
          },
        };
        activeRequests.push(activeRequest);
        try {
          var request = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: record.body,
            keepalive: true,
          };
          if (controller) request.signal = controller.signal;
          var network = (async function() {
            try {
              var response = await fetchImpl('/api/listen/report', request);
              var result = null;
              try {
                result = response && typeof response.json === 'function'
                  ? await response.json()
                  : null;
              } catch (_) {}
              return { kind: 'response', response: response, result: result };
            } catch (_) {
              return { kind: 'network-error' };
            }
          })();
          var outcome = await Promise.race([network, cancellation]);
          cancelDelivery = null;
          if (outcome.kind === 'cancelled') {
            return markPending(record, outcome.code);
          }
          if (outcome.kind === 'network-error') {
            return markPending(record, 'NETWORK_ERROR');
          }
          if (
            outcome.response
            && outcome.response.ok === true
            && outcome.result
            && outcome.result.accepted === true
            && outcome.result.localRecorded === true
          ) {
            record.deliveryResult = publicDeliveryResult(outcome.result);
            if (!persistAcknowledgement(record)) {
              return markAcknowledgementPending(record);
            }
            return completeAcknowledgement(record);
          }
          var status = boundedInteger(
            outcome.response && outcome.response.status,
            100,
            599
          );
          if (status === 409) {
            return markTerminal(record, 'conflict', 'LISTEN_SESSION_CONFLICT');
          }
          if ([400, 410, 413, 422].indexOf(status) >= 0) {
            return markTerminal(record, 'rejected', 'HTTP_REJECTED');
          }
          if (status === 401 || status === 403) {
            return markPending(record, 'LOGIN_REQUIRED', retryAfterMs(outcome.response));
          }
          return markPending(
            record,
            'HTTP_ERROR',
            retryAfterMs(outcome.response)
          );
        } finally {
          safeClearTimer(requestTimer);
          activeRequests = activeRequests.filter(function(item) {
            return item !== activeRequest;
          });
        }
      })();
      try {
        return await record.promise;
      } finally {
        record.promise = null;
      }
    }

    async function submit(event, submitOptions) {
      if (destroyed) return false;
      var payload = reportPayload(event);
      if (!payload) return false;
      if (payload.error === 'REPORTING_BINDING_REQUIRED') {
        return {
          accepted: false,
          localRecorded: true,
          delivery: 'terminal',
          status: 'rejected',
          code: payload.error,
        };
      }
      if (payloadAcknowledged(payload)) return false;
      var existing = records[payload.sessionId];
      if (existing) {
        if (existing.promise) return existing.promise;
        return false;
      }
      restoreAcknowledgements(true);
      applyDurableAcknowledgements();
      var pendingBefore = pendingRecords();
      var capacityDocument;
      try {
        capacityDocument = JSON.stringify({
          version: 2,
          entries: pendingBefore.map(outboxEntry).concat([{
            event: persistentEvent(payload.event),
            accountProof: sessionAccountProof(
              payload.event.reportingBinding,
              payload.sessionId
            ),
            attempts: 0,
            nextAttemptAt: boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER),
            createdAt: boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER),
            state: 'pending',
            lastErrorCode: '',
          }]),
        });
      } catch (_) {
        capacityDocument = '';
      }
      if (
        pendingBefore.length >= OUTBOX_MAX_COUNT
        || !capacityDocument
        || utf8ByteLength(capacityDocument) > OUTBOX_MAX_BYTES
      ) {
        return {
          accepted: false,
          localRecorded: true,
          status: 'rejected',
          code: 'OUTBOX_CAPACITY_EXCEEDED',
        };
      }
      var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      var record = {
        sessionId: payload.sessionId,
        event: persistentEvent(payload.event),
        body: payload.body,
        reportingBinding: payload.event.reportingBinding || '',
        accountProof: sessionAccountProof(
          payload.event.reportingBinding,
          payload.sessionId
        ),
        state: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        promise: null,
        durable: false,
        lastErrorCode: '',
        ackAttempts: 0,
        writerOwned: true,
      };
      records[payload.sessionId] = record;
      var reservation = persistOutbox();
      record.durable = reservation.durable;
      if (
        reservation.code === 'OUTBOX_CAPACITY'
        || reservation.code === 'OUTBOX_CAPACITY_EXCEEDED'
      ) {
        delete records[payload.sessionId];
        persistOutbox();
        return {
          accepted: false,
          localRecorded: true,
          status: 'rejected',
          code: 'OUTBOX_CAPACITY_EXCEEDED',
        };
      }
      return deliver(record, submitOptions);
    }

    function retry(sessionId) {
      if (destroyed) return Promise.resolve(false);
      sessionId = cleanString(sessionId, 128, /^[A-Za-z0-9._:-]+$/);
      var record = sessionId && records[sessionId];
      if (!record) return Promise.resolve(false);
      if (record.state === 'ack-pending') {
        return Promise.resolve(retryAcknowledgement(record));
      }
      if (record.state !== 'pending') return Promise.resolve(false);
      return deliver(record, {});
    }

    function flushDue() {
      if (destroyed) return Promise.resolve([]);
      if (flushPromise) return flushPromise;
      flushPromise = (async function() {
        if (pendingRecords().length) {
          persistOutbox();
        } else {
          cleanupAcknowledgementShards();
        }
        var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
        var due = pendingRecords().filter(function(record) {
          return (
            record.state === 'pending'
            || record.state === 'ack-pending'
          ) && record.nextAttemptAt <= now;
        });
        for (var index = 0; index < due.length; index += 1) {
          if (due[index].state === 'ack-pending') {
            retryAcknowledgement(due[index]);
          } else {
            await deliver(due[index], {});
          }
        }
        return due.map(function(record) { return record.sessionId; });
      })();
      flushPromise = flushPromise.finally(function() {
        flushPromise = null;
      });
      return flushPromise;
    }

    function schedule() {
      if (!autoRetry || destroyed || timer) return;
      var pending = pendingRecords();
      if (!pending.length) return;
      var now = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER);
      var next = pending.reduce(function(value, record) {
        return Math.min(value, record.nextAttemptAt);
      }, Number.MAX_SAFE_INTEGER);
      timer = safeSetTimer(function() {
        timer = null;
        try {
          flushDue().finally(schedule);
        } catch (_) {
          schedule();
        }
      }, Math.max(0, next - now));
      safeUnrefTimer(timer);
    }

    restoreAcknowledgements();
    restoreOutbox();
    if (Object.keys(acknowledgements).length) {
      persistOutbox();
      cleanupAcknowledgementShards();
    }
    schedule();

    return Object.freeze({
      submit: submit,
      retry: retry,
      flushDue: flushDue,
      status: function(sessionId) {
        sessionId = cleanString(sessionId, 128, /^[A-Za-z0-9._:-]+$/);
        if (!sessionId) return '';
        if (records[sessionId] && records[sessionId].deliveryResult) {
          return JSON.parse(JSON.stringify(records[sessionId].deliveryResult));
        }
        if (
          acknowledgements[sessionId]
          && acknowledgements[sessionId].deliveryResult
        ) {
          return JSON.parse(JSON.stringify(
            acknowledgements[sessionId].deliveryResult
          ));
        }
        return records[sessionId] ? records[sessionId].state : '';
      },
      destroy: function() {
        destroyed = true;
        safeClearTimer(timer);
        timer = null;
        activeRequests.forEach(function(request) {
          safeClearTimer(request.timer);
          if (request.cancel) {
            try { request.cancel('DELIVERY_CANCELLED'); } catch (_) {}
          }
          if (request.controller) {
            try { request.controller.abort(); } catch (_) {}
          }
        });
        activeRequests = [];
      },
    });
  }

  return Object.freeze({
    createListenSessionState: createListenSessionState,
    createListenTransport: createListenTransport,
    recordLocalListen: recordLocalListen,
  });
});
