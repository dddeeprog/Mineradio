'use strict';

/**
 * Mineradio WorkerW wallpaper lifecycle.
 * Adapted from XxHuberrr/Mineradio wallpaper-mode-runtime.js and the
 * TaskbarCreated hook in desktop/main.js at
 * 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * Window ownership, retries, system-event handling, diagnostics, and rollback
 * are rewritten around the current Mineradio Electron security boundary.
 */

const path = require('node:path');
const {
  DEFAULT_WALLPAPER_STATE,
  normalizeWallpaperState,
} = require('./wallpaper-properties');
const {
  DEFAULT_DESKTOP_ICONS,
  layoutDesktopIcons,
} = require('./desktop-icon-state');
const {
  createWallpaperDiagnostics,
  diagnosticCode,
} = require('./wallpaper-diagnostics');

const DEFAULT_RETRY_DELAYS = Object.freeze([0, 180, 620]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBounds(value) {
  value = value && typeof value === 'object' ? value : {};
  return {
    x: Math.max(-32768, Math.min(32768, Math.round(finite(value.x, 0)))),
    y: Math.max(-32768, Math.min(32768, Math.round(finite(value.y, 0)))),
    width: Math.max(1, Math.min(16384, Math.round(finite(value.width, 1)))),
    height: Math.max(1, Math.min(16384, Math.round(finite(value.height, 1)))),
  };
}

function nativeWindowHandleDecimal(win) {
  if (!win || typeof win.getNativeWindowHandle !== 'function') {
    throw Object.assign(new Error('WALLPAPER_NATIVE_HANDLE_INVALID'), { code: 'WALLPAPER_NATIVE_HANDLE_INVALID' });
  }
  const handle = win.getNativeWindowHandle();
  if (!Buffer.isBuffer(handle) || handle.length < 4) {
    throw Object.assign(new Error('WALLPAPER_NATIVE_HANDLE_INVALID'), { code: 'WALLPAPER_NATIVE_HANDLE_INVALID' });
  }
  if (handle.length >= 8 && (process.arch === 'x64' || process.arch === 'arm64')) {
    return handle.readBigUInt64LE(0).toString();
  }
  return String(handle.readUInt32LE(0));
}

function buildWorkerWAttachScript(input = {}) {
  const hwnd = String(input.hwnd || '');
  if (!/^\d+$/.test(hwnd)) {
    throw Object.assign(new Error('WALLPAPER_NATIVE_HANDLE_INVALID'), { code: 'WALLPAPER_NATIVE_HANDLE_INVALID' });
  }
  const bounds = normalizeBounds(input.bounds || input);
  return `
$ErrorActionPreference = "Stop"
if (-not ("MineradioWallpaperNative" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MineradioWallpaperNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)] private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)] private static extern IntPtr GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW", SetLastError=true)] private static extern IntPtr SetWindowLong32(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder value, int maxCount);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : GetWindowLong32(hWnd, index); }
  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value) { return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, index, value) : SetWindowLong32(hWnd, index, value); }
}
"@
}
$nullString = [NullString]::Value
$progman = [MineradioWallpaperNative]::FindWindow("Progman", $nullString)
if ($progman -eq [IntPtr]::Zero) { throw "WALLPAPER_PROGMAN_NOT_FOUND" }
$sendResult = [IntPtr]::Zero
[MineradioWallpaperNative]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$sendResult) | Out-Null
$script:workerw = [IntPtr]::Zero
$script:shellView = [IntPtr]::Zero
$callback = [MineradioWallpaperNative+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$state)
  $shellView = [MineradioWallpaperNative]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $nullString)
  if ($shellView -ne [IntPtr]::Zero) {
    $script:shellView = $shellView
    $candidate = [MineradioWallpaperNative]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $nullString)
    if ($candidate -ne [IntPtr]::Zero) { $script:workerw = $candidate }
  }
  return $true
}
[MineradioWallpaperNative]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$parent = $script:workerw
$parentKind = "workerw"
$fallback = $false
if ($parent -eq [IntPtr]::Zero) {
  $parent = $progman
  $parentKind = "progman"
  $fallback = $true
}
$target = [IntPtr]::new([Int64]${hwnd})
if (-not [MineradioWallpaperNative]::IsWindow($target)) { throw "WALLPAPER_TARGET_NOT_FOUND" }
$GWL_STYLE = -16
$WS_POPUP = [Int64]0x80000000
$WS_CHILD = [Int64]0x40000000
$style = [MineradioWallpaperNative]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()
$childStyle = ($style -band (-bnot $WS_POPUP)) -bor $WS_CHILD
[MineradioWallpaperNative]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new($childStyle)) | Out-Null
[MineradioWallpaperNative]::SetParent($target, $parent) | Out-Null
if ([MineradioWallpaperNative]::GetParent($target) -ne $parent) { throw "WALLPAPER_WORKERW_ATTACH_FAILED" }
$origin = New-Object MineradioWallpaperNative+POINT
$origin.X = ${bounds.x}
$origin.Y = ${bounds.y}
if (-not [MineradioWallpaperNative]::ScreenToClient($parent, [ref]$origin)) { throw "WALLPAPER_WORKERW_BOUNDS_FAILED" }
$insertAfter = [IntPtr]::new([Int64]1)
if ($parentKind -eq "progman" -and $script:shellView -ne [IntPtr]::Zero) {
  $insertAfter = $script:shellView
}
if (-not [MineradioWallpaperNative]::SetWindowPos($target, $insertAfter, $origin.X, $origin.Y, ${bounds.width}, ${bounds.height}, 0x0030)) { throw "WALLPAPER_WORKERW_POSITION_FAILED" }
$className = New-Object System.Text.StringBuilder 128
[MineradioWallpaperNative]::GetClassName($parent, $className, $className.Capacity) | Out-Null
[pscustomobject]@{
  ok = $true
  targetWindowId = $target.ToInt64().ToString()
  parentWindowId = $parent.ToInt64().ToString()
  parentClassName = $className.ToString()
  parentKind = $parentKind
  fallback = $fallback
} | ConvertTo-Json -Compress
`;
}

function parseNativeAttachOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && parsed.ok === true) return parsed;
    } catch (_) {}
  }
  throw Object.assign(new Error('WALLPAPER_WORKERW_ACK_INVALID'), { code: 'WALLPAPER_WORKERW_ACK_INVALID' });
}

function nativeFailureCode(error, stderr, fallback = 'WALLPAPER_WORKERW_ATTACH_FAILED') {
  return diagnosticCode(String(stderr || '') + ' ' + String(error && (error.code || error.message) || ''), fallback);
}

function attachWallpaperWindowToDesktop(options = {}) {
  if (typeof options.execFileImpl !== 'function') {
    return Promise.reject(Object.assign(new Error('WALLPAPER_EXEC_UNAVAILABLE'), { code: 'WALLPAPER_EXEC_UNAVAILABLE' }));
  }
  let script;
  try {
    script = buildWorkerWAttachScript(options);
  } catch (error) {
    return Promise.reject(error);
  }
  const signal = options.signal;
  const nativeTempPath = String(options.nativeTempPath || '').trim();
  const environment = { ...process.env };
  if (nativeTempPath) {
    environment.TEMP = nativeTempPath;
    environment.TMP = nativeTempPath;
  }
  return new Promise((resolve, reject) => {
    let child = null;
    let settled = false;
    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      if (child && typeof child.kill === 'function') {
        try { child.kill(); } catch (_) {}
      }
      finish(Object.assign(new Error('WALLPAPER_NATIVE_ATTACH_ABORTED'), { code: 'WALLPAPER_NATIVE_ATTACH_ABORTED' }));
    };
    if (signal && signal.aborted) {
      onAbort();
      return;
    }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
    try {
      child = options.execFileImpl('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        timeout: Math.max(1000, Math.min(10000, finite(options.timeoutMs, 5000))),
        maxBuffer: 128 * 1024,
        env: environment,
      }, (error, stdout, stderr) => {
        if (error) {
          const code = nativeFailureCode(error, stderr);
          finish(Object.assign(new Error(code), { code }));
          return;
        }
        try {
          finish(null, parseNativeAttachOutput(stdout));
        } catch (parseError) {
          finish(parseError);
        }
      });
    } catch (error) {
      const code = nativeFailureCode(error, '');
      finish(Object.assign(new Error(code), { code }));
    }
  });
}

function registerExplorerRestartHook(options = {}) {
  const win = options.win;
  if (options.platform !== 'win32' || !win || typeof win.hookWindowMessage !== 'function' || typeof options.execFileImpl !== 'function') {
    return Promise.resolve(() => {});
  }
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MineradioShellMessage {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern uint RegisterWindowMessage(string messageName);
}
"@
[MineradioShellMessage]::RegisterWindowMessage("TaskbarCreated")
`;
  return new Promise(resolve => {
    options.execFileImpl('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 16 * 1024,
    }, (error, stdout) => {
      const messageId = error ? 0 : Number.parseInt(String(stdout || '').trim(), 10);
      if (!Number.isInteger(messageId) || messageId <= 0) {
        resolve(() => {});
        return;
      }
      let timer = null;
      const listener = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (typeof options.onRestart === 'function') options.onRestart();
        }, Math.max(0, Math.min(2000, finite(options.delayMs, 650))));
      };
      try {
        win.hookWindowMessage(messageId, listener);
      } catch (_) {
        resolve(() => {});
        return;
      }
      resolve(() => {
        if (timer) clearTimeout(timer);
        timer = null;
        try { win.unhookWindowMessage(messageId); } catch (_) {}
      });
    });
  });
}

class WallpaperRuntime {
  constructor(options = {}) {
    if (typeof options.BrowserWindow !== 'function') throw new Error('WALLPAPER_BROWSER_WINDOW_REQUIRED');
    if (!options.screen || typeof options.screen.getPrimaryDisplay !== 'function') throw new Error('WALLPAPER_SCREEN_REQUIRED');
    this.BrowserWindow = options.BrowserWindow;
    this.screen = options.screen;
    this.platform = options.platform || process.platform;
    this.preloadPath = path.resolve(String(options.preloadPath || 'overlay-preload.js'));
    this.overlayUrl = typeof options.overlayUrl === 'function' ? options.overlayUrl : () => String(options.overlayUrl || '');
    this.logger = options.logger || console;
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    this.sleep = typeof options.sleep === 'function' ? options.sleep : delay => new Promise(resolve => setTimeout(resolve, delay));
    this.retryDelays = (Array.isArray(options.retryDelays) ? options.retryDelays : DEFAULT_RETRY_DELAYS)
      .slice(0, 5)
      .map(value => Math.max(0, Math.min(5000, Math.round(finite(value, 0)))));
    if (!this.retryDelays.length) this.retryDelays = [0];
    this.attachNative = typeof options.attachNative === 'function'
      ? options.attachNative
      : input => attachWallpaperWindowToDesktop({
        ...input,
        execFileImpl: options.execFileImpl,
        nativeTempPath: options.nativeTempPath,
        timeoutMs: options.attachTimeoutMs,
      });
    this.explorerHookFactory = typeof options.explorerHookFactory === 'function'
      ? options.explorerHookFactory
      : input => registerExplorerRestartHook({
        ...input,
        platform: this.platform,
        execFileImpl: options.execFileImpl,
      });
    this.diagnostics = options.diagnostics || createWallpaperDiagnostics(options.diagnosticsOptions);
    this.window = null;
    this.closingWindow = null;
    this.state = normalizeWallpaperState(DEFAULT_WALLPAPER_STATE, {}, false);
    this.attachment = null;
    this.explorerHookCleanup = null;
    this.startPromise = null;
    this.stopPromise = null;
    this.reconcilePromise = null;
    this.attachAbortController = null;
    this.operation = 0;
    this.generation = 0;
    this.attachAttempts = 0;
    this.retryCount = 0;
    this.lastError = '';
    this.systemPaused = false;
    this.disposed = false;
  }

  isSupported() {
    return this.platform === 'win32';
  }

  isWindowAlive(win = this.window) {
    return !!(win && typeof win.isDestroyed === 'function' && !win.isDestroyed());
  }

  displaySnapshot() {
    const display = this.screen.getPrimaryDisplay() || {};
    return {
      displayId: String(display.id == null ? 'primary' : display.id),
      bounds: normalizeBounds(display.bounds),
    };
  }

  getStatus(reason = '') {
    const alive = this.isWindowAlive();
    const active = !!(alive && this.state.enabled && this.attachment);
    return {
      ok: !this.lastError,
      supported: this.isSupported(),
      enabled: this.state.enabled === true,
      active,
      phase: this.stopPromise ? 'stopping' : this.startPromise || this.reconcilePromise ? 'attaching' : this.systemPaused && active ? 'paused' : active ? 'active' : 'disabled',
      visible: alive && typeof this.window.isVisible === 'function' ? this.window.isVisible() : false,
      windowCount: alive ? 1 : 0,
      fullDesktop: this.state.fullDesktop === true,
      desktopIcons: this.state.desktopIcons !== false,
      systemPaused: this.systemPaused,
      parentKind: this.attachment && this.attachment.parentKind || '',
      fallback: !!(this.attachment && this.attachment.fallback),
      displayId: this.attachment && this.attachment.displayId || '',
      bounds: this.attachment && this.attachment.bounds || null,
      frameRate: this.state.frameRate,
      generation: this.generation,
      attachAttempts: this.attachAttempts,
      retryCount: this.retryCount,
      lastError: this.lastError,
      reason: String(reason || '').slice(0, 80),
    };
  }

  emitStatus(reason) {
    const status = this.getStatus(reason);
    this.diagnostics.record(reason || 'state', status);
    try { this.onStatus(status); } catch (_) {}
    return status;
  }

  getDiagnostics() {
    return this.diagnostics.snapshot(this.getStatus('diagnostics'));
  }

  renderState(snapshot = this.displaySnapshot()) {
    const iconLayout = layoutDesktopIcons(
      { width: snapshot.bounds.width, height: snapshot.bounds.height },
      DEFAULT_DESKTOP_ICONS,
      {
        visible: this.state.fullDesktop && this.state.desktopIcons,
        locked: true,
        reserved: [{ x: snapshot.bounds.width - 360, y: 0, width: 360, height: 150 }],
      },
    );
    return {
      ...this.state,
      systemPaused: this.systemPaused,
      hostKind: 'mineradio-workerw',
      iconLayout,
    };
  }

  sendState(win = this.window, snapshot = this.displaySnapshot()) {
    if (!this.isWindowAlive(win) || !win.webContents || (typeof win.webContents.isDestroyed === 'function' && win.webContents.isDestroyed())) return false;
    win.webContents.send('mineradio-wallpaper-state', this.renderState(snapshot));
    return true;
  }

  positionWindow(win = this.window) {
    const snapshot = this.displaySnapshot();
    if (this.isWindowAlive(win) && typeof win.setBounds === 'function') win.setBounds(snapshot.bounds, false);
    return snapshot;
  }

  createWindow() {
    const snapshot = this.displaySnapshot();
    const win = new this.BrowserWindow({
      ...snapshot.bounds,
      frame: false,
      transparent: false,
      backgroundColor: '#050608',
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      title: 'Mineradio Desktop Wallpaper',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    if (typeof win.setIgnoreMouseEvents === 'function') win.setIgnoreMouseEvents(true, { forward: true });
    if (win.webContents && typeof win.webContents.setWindowOpenHandler === 'function') {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
    if (win.webContents && typeof win.webContents.on === 'function') {
      win.webContents.on('will-navigate', (event, targetUrl) => {
        if (String(targetUrl || '') === String(this.overlayUrl() || '')) return;
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
      });
      win.webContents.on('render-process-gone', (_event, details) => {
        if (this.window !== win || !this.state.enabled) return;
        const reason = String(details && details.reason || 'unknown').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
        this.stop('renderer-gone', { error: 'WALLPAPER_RENDERER_GONE_' + reason.toUpperCase() }).catch(() => {});
      });
    }
    win.on('closed', () => {
      if (this.window !== win) return;
      const expected = this.closingWindow === win || this.state.enabled !== true;
      this.window = null;
      this.attachment = null;
      if (!expected) {
        this.state = normalizeWallpaperState(this.state, {}, false);
        this.lastError = 'WALLPAPER_WINDOW_CLOSED';
        this.emitStatus('window-closed-unexpectedly');
      }
    });
    this.window = win;
    return win;
  }

  async closeWindow(win) {
    if (!this.isWindowAlive(win)) return false;
    this.closingWindow = win;
    try {
      if (typeof win.destroy === 'function') win.destroy();
      else if (typeof win.close === 'function') win.close();
    } finally {
      if (this.closingWindow === win) this.closingWindow = null;
    }
    if (this.isWindowAlive(win)) {
      throw Object.assign(new Error('WALLPAPER_WINDOW_DESTROY_FAILED'), { code: 'WALLPAPER_WINDOW_DESTROY_FAILED' });
    }
    return true;
  }

  async clearExplorerHook() {
    const cleanup = this.explorerHookCleanup;
    this.explorerHookCleanup = null;
    if (typeof cleanup === 'function') {
      try { await cleanup(); } catch (_) {}
    }
  }

  async installExplorerHook(win) {
    await this.clearExplorerHook();
    try {
      const cleanup = await this.explorerHookFactory({
        win,
        onRestart: () => this.handleSystemEvent('explorer-restart').catch(() => {}),
      });
      if (this.window === win && this.isWindowAlive(win) && typeof cleanup === 'function') {
        this.explorerHookCleanup = cleanup;
      } else if (typeof cleanup === 'function') {
        await cleanup();
      }
    } catch (error) {
      this.diagnostics.record('explorer-hook-unavailable', {
        ...this.getStatus(),
        error: diagnosticCode(error && (error.code || error.message), 'WALLPAPER_EXPLORER_HOOK_UNAVAILABLE'),
      });
    }
  }

  async attachWithRetry(win, snapshot, operation) {
    const controller = new AbortController();
    this.attachAbortController = controller;
    this.attachAttempts = 0;
    this.retryCount = 0;
    let lastFailure = Object.assign(new Error('WALLPAPER_WORKERW_ATTACH_FAILED'), { code: 'WALLPAPER_WORKERW_ATTACH_FAILED' });
    try {
      for (let index = 0; index < this.retryDelays.length; index += 1) {
        if (index > 0) {
          this.retryCount += 1;
          await this.sleep(this.retryDelays[index]);
        }
        if (controller.signal.aborted || operation !== this.operation || this.window !== win || !this.isWindowAlive(win)) {
          throw Object.assign(new Error('WALLPAPER_START_SUPERSEDED'), { code: 'WALLPAPER_START_SUPERSEDED' });
        }
        this.attachAttempts += 1;
        try {
          const result = await this.attachNative({
            hwnd: nativeWindowHandleDecimal(win),
            bounds: snapshot.bounds,
            signal: controller.signal,
            attempt: this.attachAttempts,
          });
          const parentKind = result && result.parentKind === 'progman' ? 'progman' : result && result.parentKind === 'workerw' ? 'workerw' : '';
          if (!result || result.ok !== true || !String(result.parentWindowId || '') || !parentKind) {
            throw Object.assign(new Error('WALLPAPER_WORKERW_ACK_INVALID'), { code: 'WALLPAPER_WORKERW_ACK_INVALID' });
          }
          return {
            targetWindowId: String(result.targetWindowId || ''),
            parentWindowId: String(result.parentWindowId || ''),
            parentKind,
            fallback: result.fallback === true || parentKind === 'progman',
            displayId: snapshot.displayId,
            bounds: { ...snapshot.bounds },
          };
        } catch (error) {
          const code = diagnosticCode(error && (error.code || error.message), 'WALLPAPER_WORKERW_ATTACH_FAILED');
          lastFailure = Object.assign(new Error(code), { code });
          if (code === 'WALLPAPER_START_SUPERSEDED' || code === 'WALLPAPER_NATIVE_ATTACH_ABORTED') throw lastFailure;
        }
      }
      throw lastFailure;
    } finally {
      if (this.attachAbortController === controller) this.attachAbortController = null;
    }
  }

  async runStart(operation) {
    let win = this.isWindowAlive() ? this.window : null;
    try {
      if (!win) {
        win = this.createWindow();
        const targetUrl = String(this.overlayUrl() || '');
        if (!targetUrl) throw Object.assign(new Error('WALLPAPER_URL_UNAVAILABLE'), { code: 'WALLPAPER_URL_UNAVAILABLE' });
        await win.loadURL(targetUrl);
      }
      if (operation !== this.operation || !this.state.enabled || this.window !== win) {
        throw Object.assign(new Error('WALLPAPER_START_SUPERSEDED'), { code: 'WALLPAPER_START_SUPERSEDED' });
      }
      const snapshot = this.positionWindow(win);
      this.attachment = await this.attachWithRetry(win, snapshot, operation);
      if (operation !== this.operation || !this.state.enabled || this.window !== win) {
        throw Object.assign(new Error('WALLPAPER_START_SUPERSEDED'), { code: 'WALLPAPER_START_SUPERSEDED' });
      }
      await this.installExplorerHook(win);
      this.lastError = '';
      this.sendState(win, snapshot);
      if (typeof win.showInactive === 'function') win.showInactive();
      this.generation += 1;
      return { ok: true, enabled: true, status: this.emitStatus('started') };
    } catch (error) {
      const code = diagnosticCode(error && (error.code || error.message), 'WALLPAPER_START_FAILED');
      const superseded = code === 'WALLPAPER_START_SUPERSEDED' || code === 'WALLPAPER_NATIVE_ATTACH_ABORTED';
      await this.clearExplorerHook();
      if (this.window === win) this.window = null;
      this.attachment = null;
      try { await this.closeWindow(win); } catch (closeError) {
        if (!superseded) this.lastError = diagnosticCode(closeError && (closeError.code || closeError.message), code);
      }
      if (!superseded && operation === this.operation) {
        this.state = normalizeWallpaperState(this.state, {}, false);
        this.lastError = this.lastError || code;
        this.generation += 1;
        this.emitStatus('start-failed');
      }
      return {
        ok: false,
        enabled: false,
        stale: superseded,
        error: superseded ? 'WALLPAPER_START_SUPERSEDED' : this.lastError || code,
        status: this.getStatus(superseded ? 'start-superseded' : 'start-failed'),
      };
    }
  }

  async start(payload = {}) {
    if (this.disposed) return { ok: false, enabled: false, error: 'WALLPAPER_RUNTIME_DISPOSED', status: this.getStatus('disposed') };
    if (this.stopPromise) await this.stopPromise;
    this.state = normalizeWallpaperState(this.state, payload, true);
    if (!this.isSupported()) {
      this.state = normalizeWallpaperState(this.state, {}, false);
      this.lastError = 'WALLPAPER_PLATFORM_UNSUPPORTED';
      return { ok: false, enabled: false, error: this.lastError, status: this.emitStatus('unsupported') };
    }
    if (this.startPromise) {
      const pending = await this.startPromise;
      if (pending.ok && this.state.enabled) {
        this.sendState();
        return { ok: true, enabled: true, status: this.getStatus('updated-during-start') };
      }
      return pending;
    }
    if (this.isWindowAlive() && this.attachment) {
      this.lastError = '';
      this.sendState();
      return { ok: true, enabled: true, status: this.emitStatus('updated') };
    }
    const operation = ++this.operation;
    const job = this.runStart(operation);
    this.startPromise = job;
    try {
      return await job;
    } finally {
      if (this.startPromise === job) this.startPromise = null;
    }
  }

  async update(payload = {}) {
    const requestedEnabled = Object.prototype.hasOwnProperty.call(payload || {}, 'enabled')
      ? payload.enabled === true
      : this.state.enabled === true;
    this.state = normalizeWallpaperState(this.state, payload, requestedEnabled);
    if (!requestedEnabled) return this.stop('update-disabled');
    if (this.startPromise || !this.isWindowAlive() || !this.attachment) return this.start(this.state);
    this.sendState();
    return { ok: true, enabled: true, status: this.emitStatus('updated') };
  }

  async reconcile(reason = 'reconcile') {
    if (!this.state.enabled || !this.isWindowAlive()) return { ok: true, enabled: false, status: this.getStatus(reason) };
    if (this.reconcilePromise) return this.reconcilePromise;
    if (this.startPromise) await this.startPromise;
    if (!this.state.enabled || !this.isWindowAlive()) return { ok: false, enabled: false, error: this.lastError, status: this.getStatus(reason) };
    const operation = ++this.operation;
    const win = this.window;
    const job = (async () => {
      try {
        const snapshot = this.positionWindow(win);
        const attachment = await this.attachWithRetry(win, snapshot, operation);
        if (operation !== this.operation || this.window !== win || !this.state.enabled) {
          throw Object.assign(new Error('WALLPAPER_START_SUPERSEDED'), { code: 'WALLPAPER_START_SUPERSEDED' });
        }
        this.attachment = attachment;
        this.lastError = '';
        this.sendState(win, snapshot);
        this.generation += 1;
        return { ok: true, enabled: true, status: this.emitStatus(reason) };
      } catch (error) {
        const code = diagnosticCode(error && (error.code || error.message), 'WALLPAPER_RECONCILE_FAILED');
        if (code === 'WALLPAPER_START_SUPERSEDED' || code === 'WALLPAPER_NATIVE_ATTACH_ABORTED') {
          return { ok: false, enabled: false, stale: true, error: code, status: this.getStatus(reason) };
        }
        const stopped = await this.stop(reason + '-failed', { error: code });
        return { ok: false, enabled: false, error: code, status: stopped.status };
      }
    })();
    this.reconcilePromise = job;
    try {
      return await job;
    } finally {
      if (this.reconcilePromise === job) this.reconcilePromise = null;
    }
  }

  async handleSystemEvent(type) {
    type = String(type || '').toLowerCase();
    if (type === 'lock-screen' || type === 'suspend') {
      this.systemPaused = true;
      this.sendState();
      return { ok: true, enabled: this.state.enabled, status: this.emitStatus(type) };
    }
    if (type === 'unlock-screen' || type === 'resume') {
      this.systemPaused = false;
      this.sendState();
      return this.reconcile(type);
    }
    if (type === 'explorer-restart' || type === 'display-metrics-changed' || type === 'display-added' || type === 'display-removed') {
      return this.reconcile(type);
    }
    return { ok: true, enabled: this.state.enabled, status: this.getStatus('ignored-event') };
  }

  async runStop(reason = 'disabled', options = {}) {
    this.operation += 1;
    const controller = this.attachAbortController;
    this.attachAbortController = null;
    if (controller) {
      try { controller.abort(); } catch (_) {}
    }
    this.state = normalizeWallpaperState(this.state, {}, false);
    this.systemPaused = false;
    this.attachment = null;
    await this.clearExplorerHook();
    const win = this.window;
    if (this.window === win) this.window = null;
    let closeError = '';
    try { await this.closeWindow(win); } catch (error) {
      closeError = diagnosticCode(error && (error.code || error.message), 'WALLPAPER_WINDOW_DESTROY_FAILED');
      if (this.isWindowAlive(win) && !this.window) this.window = win;
    }
    this.lastError = diagnosticCode(options.error, '') || closeError;
    this.generation += 1;
    return { ok: !closeError, enabled: false, error: closeError, status: this.emitStatus(reason) };
  }

  async stop(reason = 'disabled', options = {}) {
    if (this.stopPromise) return this.stopPromise;
    const job = this.runStop(reason, options);
    this.stopPromise = job;
    try {
      return await job;
    } finally {
      if (this.stopPromise === job) this.stopPromise = null;
    }
  }

  async dispose() {
    if (this.disposed) return { ok: true, enabled: false, status: this.getStatus('disposed') };
    this.disposed = true;
    return this.stop('dispose');
  }
}

module.exports = {
  DEFAULT_RETRY_DELAYS,
  WallpaperRuntime,
  attachWallpaperWindowToDesktop,
  buildWorkerWAttachScript,
  nativeWindowHandleDecimal,
  parseNativeAttachOutput,
  registerExplorerRestartHook,
};
