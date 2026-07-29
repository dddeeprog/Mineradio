const { isAllowedAppUrl } = require('./navigation-guard');

const MAIN_CHANNELS = new Set([
  'desktop-window-minimize',
  'desktop-window-toggle-maximize',
  'desktop-window-toggle-fullscreen',
  'desktop-window-exit-fullscreen-windowed',
  'desktop-window-get-state',
  'desktop-window-close',
  'mineradio-hotkeys-configure-global',
  'mineradio-tray-get-settings',
  'mineradio-tray-set-close-to-tray',
  'mineradio-startup-set-enabled',
  'mineradio-ui-state-read-sync',
  'mineradio-ui-state-write',
  'mineradio-export-json-file',
  'mineradio-import-json-file',
  'netease-music-open-login',
  'netease-music-clear-login',
  'qq-music-open-login',
  'qq-music-clear-login',
  'mineradio-open-update-installer',
  'mineradio-restart-app',
  'mineradio-desktop-lyrics-update',
  'mineradio-wallpaper-set-enabled',
  'mineradio-wallpaper-update',
  'mineradio-eisland-bridge-state',
  'mineradio-eisland-bridge-heartbeat',
  'mineradio-eisland-bridge-command-complete',
]);

const OVERLAY_CHANNELS = new Set([
  'mineradio-desktop-lyrics-set-dragging',
  'mineradio-desktop-lyrics-set-pointer-capture',
  'mineradio-desktop-lyrics-set-hot-bounds',
  'mineradio-desktop-lyrics-set-lock-state',
  'mineradio-desktop-lyrics-move-by',
]);

const SHARED_CHANNELS = new Set([
  'mineradio-desktop-lyrics-set-enabled',
]);

function parsePathname(value) {
  try {
    return new URL(String(value || '')).pathname || '/';
  } catch (err) {
    return '';
  }
}

function senderRoleForUrl(value, port) {
  if (!isAllowedAppUrl(value, port)) return '';
  const pathname = parsePathname(value);
  if (pathname === '/' || pathname === '/index.html') return 'main';
  if (pathname === '/desktop-lyrics.html' || pathname === '/wallpaper.html') return 'overlay';
  return '';
}

function isAllowedIpcSender(channel, senderUrl, port) {
  const role = senderRoleForUrl(senderUrl, port);
  if (!role) return false;
  if (MAIN_CHANNELS.has(channel)) return role === 'main';
  if (OVERLAY_CHANNELS.has(channel)) return role === 'overlay';
  if (SHARED_CHANNELS.has(channel)) return role === 'main' || role === 'overlay';
  return false;
}

function senderUrlFromEvent(event) {
  if (event && event.senderFrame && event.senderFrame.url) return event.senderFrame.url;
  if (event && event.sender && typeof event.sender.getURL === 'function') return event.sender.getURL();
  return '';
}

function assertAllowedIpcSender(event, channel, port) {
  const senderUrl = senderUrlFromEvent(event);
  if (isAllowedIpcSender(channel, senderUrl, port)) return true;
  const err = new Error('IPC_SENDER_NOT_ALLOWED');
  err.code = 'IPC_SENDER_NOT_ALLOWED';
  err.channel = channel;
  err.senderUrl = senderUrl;
  throw err;
}

module.exports = {
  assertAllowedIpcSender,
  isAllowedIpcSender,
  senderRoleForUrl,
};
