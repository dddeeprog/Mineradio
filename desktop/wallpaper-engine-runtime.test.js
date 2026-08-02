'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  WallpaperEngineRuntime,
  safeRuntimeOptions,
  nativeWindowControlScript,
} = require('./wallpaper-engine-runtime');

test('bounds native Wallpaper Engine launch dimensions and frame rate', () => {
  assert.deepEqual(safeRuntimeOptions({
    width: 99999,
    height: -4,
    fps: 999,
    x: Number.POSITIVE_INFINITY,
  }), {
    width: 7680,
    height: 64,
    fps: 240,
    x: 0,
    y: 0,
    sourceTimeoutMs: 15000,
    sourcePollMs: 60,
  });
});

test('adds the Windows PowerShell module directory for signature verification', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-we-powershell-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = new WallpaperEngineRuntime({
    platform: 'win32',
    nativeTempPath: root,
    desktopCapturer: {},
  });

  const env = runtime._powerShellEnv();
  const expected = path.join(
    process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'Modules'
  );
  const modulePaths = String(env.PSModulePath || '').split(path.delimiter);

  assert.equal(modulePaths[0].toLowerCase(), expected.toLowerCase());
});

test('parking a captured Scene removes the real source window from the taskbar', () => {
  const script = Buffer.from(nativeWindowControlScript(), 'base64').toString('utf16le');
  assert.match(script, /interface ITaskbarList/);
  assert.match(script, /RemoveTaskbarTab\(IntPtr hWnd\)[\s\S]*taskbar\.DeleteTab\(hWnd\)/);
  assert.match(script, /String\.Equals\(action, "park"[\s\S]*RemoveTaskbarTab\(hWnd\)/);
  assert.match(script, /parkResult\.taskbarHidden = true/);
});

test('runs native window control from a staged helper instead of the Windows command line', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-we-window-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let invocation = null;
  const runtime = new WallpaperEngineRuntime({
    platform: 'win32',
    nativeTempPath: root,
    desktopCapturer: {},
    nativeExecFile(executable, args, options, callback) {
      invocation = { executable, args, options };
      callback(null, '{"ok":true,"parked":true,"taskbarHidden":true}\n', '');
    },
  });

  const result = await runtime._nativeWindowControl('park', {
    sourceId: 'window:4242:0',
    locationTitle: 'Mineradio Wallpaper session',
    executable: 'C:\\Wallpaper Engine\\wallpaper64.exe',
  });

  assert.equal(result.taskbarHidden, true);
  assert.ok(invocation);
  assert.equal(invocation.args.includes('-EncodedCommand'), false);
  const fileIndex = invocation.args.indexOf('-File');
  assert.notEqual(fileIndex, -1);
  const helperFile = invocation.args[fileIndex + 1];
  assert.equal(path.dirname(helperFile), root);
  assert.match(fs.readFileSync(helperFile, 'utf8'), /MineradioWeWindowControl/);
});

test('starts one native Scene session and stops only the matching session', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-we-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectFile = path.join(root, 'project.json');
  const scenePackage = path.join(root, 'scene.pkg');
  fs.writeFileSync(projectFile, '{}');
  fs.writeFileSync(scenePackage, 'PKGV0001');
  const id = '1234567890abcdef12345678';

  const runtime = new WallpaperEngineRuntime({
    library: {
      async getNativeSceneTarget(requestedId) {
        assert.equal(requestedId, id);
        return { id, projectFile, scenePackage, muteProperties: {} };
      },
    },
    platform: 'win32',
    nativeTempPath: root,
    desktopCapturer: {},
  });
  runtime._discoverExecutable = async () => ({ available: true, executable: 'C:\\Wallpaper Engine\\wallpaper64.exe' });
  runtime._ensureEngineReady = async (executable) => executable;
  runtime._prepareSilentLaunchFile = async () => projectFile;
  runtime._openInitialSessionWindow = async (session) => { session.launched = true; };
  runtime._findWindowSource = async () => ({ id: 'window:4242:0', name: 'Mineradio Wallpaper' });
  runtime._muteSession = async (session) => { session.audioMuted = true; };
  runtime._closeSession = async () => true;

  const started = await runtime.start(id, { width: 1280, height: 720, fps: 30 });

  assert.equal(started.active, true);
  assert.equal(started.id, id);
  assert.equal(started.sourceId, 'window:4242:0');
  assert.match(started.sessionId, /^[a-f0-9]{24}$/);
  assert.equal(started.audioMuted, true);

  const mismatch = await runtime.stop('ffffffffffffffffffffffff');
  assert.equal(mismatch.stopped, false);
  assert.equal(mismatch.reason, 'WALLPAPER_ENGINE_SESSION_MISMATCH');

  const stopped = await runtime.stop(started.sessionId);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.active, false);
});
