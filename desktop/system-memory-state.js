/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
'use strict';

const PRESSURE_RANK = Object.freeze({ normal: 0, moderate: 1, critical: 2 });
const THERMAL_STATES = new Set(['unknown', 'nominal', 'fair', 'serious', 'critical']);

function finite(value, fallback = 0) {
  value = Number(value);
  return Number.isFinite(value) ? value : fallback;
}

function kibToMb(value) {
  return Math.max(0, Math.round(finite(value, 0) / 1024));
}

function normalizeSystemMemoryInfo(info = {}) {
  const totalMB = kibToMb(info.total);
  const freeMB = Math.min(totalMB || Number.MAX_SAFE_INTEGER, kibToMb(info.free));
  const availableRatio = totalMB > 0
    ? Math.round((freeMB / totalMB) * 10000) / 10000
    : 0;
  return {
    totalMB,
    freeMB,
    availableRatio,
    swapTotalMB: kibToMb(info.swapTotal),
    swapFreeMB: kibToMb(info.swapFree),
  };
}

function classifyMemoryPressure(memory = {}) {
  if (!memory.totalMB) return 'normal';
  if (memory.availableRatio <= 0.07 || memory.freeMB <= 512) return 'critical';
  if (memory.availableRatio <= 0.16 || memory.freeMB <= 1024) return 'moderate';
  return 'normal';
}

function normalizeThermalState(value) {
  value = String(value || 'unknown').toLowerCase();
  return THERMAL_STATES.has(value) ? value : 'unknown';
}

function normalizeSpeedLimit(value) {
  return Math.max(0, Math.min(100, finite(value, 100)));
}

function createSystemMemoryState(options = {}) {
  const recoveryHoldMs = Math.max(0, finite(options.recoveryHoldMs, 15000));
  let memory = normalizeSystemMemoryInfo({});
  let pressure = 'normal';
  let recoveryTarget = null;
  let recoverySince = null;
  let onBattery = false;
  let thermalState = 'unknown';
  let speedLimit = 100;
  let locked = false;
  let suspended = false;
  let revision = 0;
  let updatedAt = 0;

  function snapshot() {
    return {
      pressure,
      totalMB: memory.totalMB,
      freeMB: memory.freeMB,
      availableRatio: memory.availableRatio,
      swapTotalMB: memory.swapTotalMB,
      swapFreeMB: memory.swapFreeMB,
      onBattery,
      thermalState,
      speedLimit,
      locked,
      suspended,
      revision,
      updatedAt,
    };
  }

  function sample(input = {}, now = Date.now()) {
    now = Math.max(updatedAt, finite(now, updatedAt));
    updatedAt = now;
    if (input.memoryInfo) memory = normalizeSystemMemoryInfo(input.memoryInfo);
    if (Object.prototype.hasOwnProperty.call(input, 'onBattery')) onBattery = input.onBattery === true;
    if (Object.prototype.hasOwnProperty.call(input, 'thermalState')) thermalState = normalizeThermalState(input.thermalState);
    if (Object.prototype.hasOwnProperty.call(input, 'speedLimit')) speedLimit = normalizeSpeedLimit(input.speedLimit);
    if (Object.prototype.hasOwnProperty.call(input, 'locked')) locked = input.locked === true;
    if (Object.prototype.hasOwnProperty.call(input, 'suspended')) suspended = input.suspended === true;

    const desired = classifyMemoryPressure(memory);
    if (PRESSURE_RANK[desired] > PRESSURE_RANK[pressure]) {
      pressure = desired;
      recoveryTarget = null;
      recoverySince = null;
    } else if (PRESSURE_RANK[desired] < PRESSURE_RANK[pressure]) {
      if (recoveryTarget !== desired) {
        recoveryTarget = desired;
        recoverySince = now;
      }
      if (now - recoverySince >= recoveryHoldMs) {
        pressure = desired;
        recoveryTarget = null;
        recoverySince = null;
      }
    } else {
      recoveryTarget = null;
      recoverySince = null;
    }
    revision += 1;
    return snapshot();
  }

  return { sample, snapshot };
}

module.exports = {
  classifyMemoryPressure,
  createSystemMemoryState,
  normalizeSystemMemoryInfo,
};
