(function wallpaperEngineUiModule(window) {
  'use strict';

  var state = window.MineradioWallpaperEngineState || {};
  var normalizeProject = state.normalizeProject || function (value) { return value || {}; };
  var normalizeSelection = state.normalizeSelection || function () { return { active: false, id: '', title: '', kind: '' }; };
  var projectPlaybackKind = state.projectPlaybackKind || function () { return ''; };
  var projectMediaUrl = state.projectMediaUrl || function () { return ''; };
  var wallpaperEnginePerformancePolicy = state.wallpaperEnginePerformancePolicy || function (value) {
    value = value || {};
    if (value.hidden || value.isVisible === false || value.isMinimized || value.locked || value.systemSuspended) {
      return { suspended: true, fps: 0 };
    }
    var requested = Number(value.governorFps);
    var fps = requested > 0 ? Math.max(15, Math.min(30, Math.round(requested))) : 30;
    return { suspended: false, fps: value.isFocused === false ? Math.min(24, fps) : fps };
  };
  var STORAGE_KEY = 'mineradio-wallpaper-engine-selection-v1';
  var projects = [];
  var librarySnapshot = null;
  var mediaToken = '';
  var libraryBusy = false;
  var activationToken = 0;
  var captureStream = null;
  var captureFps = 0;
  var nativeSessionId = '';
  var wallpaperPlaybackSuspended = false;
  var lifecycleSyncPromise = Promise.resolve();
  var desktopStateUnsubscribe = null;
  var desktopLifecycleState = {
    isVisible: true,
    isMinimized: false,
    isFocused: true,
  };
  var selection = readSelection();

  function desktopApi() {
    return window.desktopWindow && window.desktopWindow.isDesktop ? window.desktopWindow : null;
  }

  function currentGovernorWallpaperFps() {
    var decision = window.resourceGovernorDecision;
    var fps = Number(decision && decision.wallpaperFps);
    return fps > 0 ? fps : 60;
  }

  function currentWallpaperEnginePerformancePolicy() {
    var resources = window.systemResourceState || {};
    return wallpaperEnginePerformancePolicy({
      hidden: document.hidden === true,
      isVisible: desktopLifecycleState.isVisible,
      isMinimized: desktopLifecycleState.isMinimized,
      isFocused: desktopLifecycleState.isFocused,
      locked: resources.locked === true,
      systemSuspended: resources.suspended === true,
      governorFps: currentGovernorWallpaperFps(),
    });
  }

  function mergeDesktopLifecycleState(value) {
    value = value || {};
    if (typeof value.isVisible === 'boolean') desktopLifecycleState.isVisible = value.isVisible;
    if (typeof value.isMinimized === 'boolean') desktopLifecycleState.isMinimized = value.isMinimized;
    if (typeof value.isFocused === 'boolean') desktopLifecycleState.isFocused = value.isFocused;
  }

  async function refreshDesktopLifecycleState() {
    var api = desktopApi();
    if (!api || typeof api.getState !== 'function') return desktopLifecycleState;
    try { mergeDesktopLifecycleState(await api.getState()); } catch (_error) {}
    return desktopLifecycleState;
  }

  function waitForUsableDesktopWindow() {
    var api = desktopApi();
    if (!api || typeof api.getState !== 'function') return Promise.resolve();
    return new Promise(function (resolve) {
      var settled = false;
      var unsubscribe = null;
      function finish() {
        if (settled) return;
        settled = true;
        if (typeof unsubscribe === 'function') unsubscribe();
        resolve();
      }
      function inspect(state) {
        if (state && state.isVisible && !state.isMinimized) finish();
      }
      if (typeof api.onStateChange === 'function') unsubscribe = api.onStateChange(inspect);
      Promise.resolve(api.getState()).then(inspect).catch(finish);
    });
  }

  async function waitForPlayerEntry() {
    if (document.body && document.body.classList.contains('splash-active')) {
      await new Promise(function (resolve) {
        var observer = new MutationObserver(function () {
          if (document.body.classList.contains('splash-active')) return;
          observer.disconnect();
          resolve();
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      });
    }
    await waitForUsableDesktopWindow();
  }

  function notify(message) {
    if (!message) return;
    if (typeof window.showToast === 'function') window.showToast(message);
  }

  function readSelection() {
    try {
      return normalizeSelection(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch (_error) {
      return normalizeSelection({});
    }
  }

  function saveSelection() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection)); } catch (_error) {}
  }

  function projectById(id) {
    id = String(id || '').toLowerCase();
    return projects.find(function (project) { return project.id === id; }) || null;
  }

  function playbackLabel(kind) {
    if (kind === 'engine') return 'Scene';
    if (kind === 'video') return 'Video';
    if (kind === 'image') return 'Image';
    if (kind === 'preview') return 'Preview';
    return 'Unavailable';
  }

  function friendlyError(error) {
    var code = String(error && (error.code || error.message) || error || 'UNKNOWN');
    if (/NOT_INSTALLED/.test(code)) return '未找到 Wallpaper Engine';
    if (/SIGNATURE_INVALID/.test(code)) return 'Wallpaper Engine 安装无法验证';
    if (/CAPTURE/.test(code)) return 'Scene 画面连接失败';
    if (/SCENE/.test(code)) return 'Scene 项目启动失败';
    if (/UNSUPPORTED/.test(code)) return '当前环境不支持此项目';
    return code.slice(0, 120);
  }

  function updateEntry() {
    var value = document.getElementById('wallpaper-engine-value');
    var restore = document.getElementById('wallpaper-engine-restore-btn');
    if (value) {
      value.textContent = selection.active
        ? (selection.title + ' · ' + playbackLabel(selection.kind))
        : '未启用 · 原背景保留';
    }
    if (restore) restore.disabled = !selection.active;
  }

  function updateStatus(message, loading) {
    var status = document.getElementById('wallpaper-engine-library-status');
    if (!status) return;
    status.textContent = String(message || '');
    status.classList.toggle('loading', loading === true);
  }

  function stopMediaStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach(function (track) {
      try { track.stop(); } catch (_error) {}
    });
  }

  function clearLayerMedia() {
    var layer = document.getElementById('wallpaper-engine-layer');
    var image = document.getElementById('wallpaper-engine-image');
    var video = document.getElementById('wallpaper-engine-video');
    if (captureStream) stopMediaStream(captureStream);
    captureStream = null;
    captureFps = 0;
    if (video) {
      try { video.pause(); } catch (_error) {}
      video.srcObject = null;
      video.removeAttribute('src');
      try { video.load(); } catch (_error) {}
    }
    if (image) image.removeAttribute('src');
    if (layer) layer.classList.remove('ready', 'image-ready', 'video-ready', 'engine-ready');
  }

  async function stopNativeSession(sessionId) {
    var api = desktopApi();
    var expected = String(sessionId || nativeSessionId || '');
    if (!sessionId || expected === nativeSessionId) nativeSessionId = '';
    if (!api || typeof api.stopWallpaperEngineScene !== 'function') return;
    try { await api.stopWallpaperEngineScene({ sessionId: expected }); } catch (_error) {}
  }

  async function releaseCurrentPlayback() {
    var sessionId = nativeSessionId;
    clearLayerMedia();
    if (sessionId) await stopNativeSession(sessionId);
    document.body.classList.remove('wallpaper-engine-active');
    var layer = document.getElementById('wallpaper-engine-layer');
    if (layer) layer.setAttribute('aria-hidden', 'true');
  }

  function restoreOriginalBackground() {
    document.body.classList.remove('wallpaper-engine-active');
    clearLayerMedia();
    var layer = document.getElementById('wallpaper-engine-layer');
    if (layer) layer.setAttribute('aria-hidden', 'true');
  }

  function commitSelection(project, kind) {
    selection = normalizeSelection({
      active: true,
      id: project.id,
      title: project.title,
      kind: kind,
    });
    wallpaperPlaybackSuspended = false;
    saveSelection();
    updateEntry();
    renderLibrary();
  }

  function revealLayer(kind) {
    var layer = document.getElementById('wallpaper-engine-layer');
    if (!layer) throw new Error('WALLPAPER_LAYER_MISSING');
    layer.classList.remove('image-ready', 'video-ready', 'engine-ready');
    layer.classList.add(kind === 'image' || kind === 'preview' ? 'image-ready' : 'video-ready');
    if (kind === 'engine') layer.classList.add('engine-ready');
    layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('wallpaper-engine-active');
    window.requestAnimationFrame(function () { layer.classList.add('ready'); });
  }

  function waitForImage(image, url, token) {
    return new Promise(function (resolve, reject) {
      var timer = 0;
      function cleanup() {
        clearTimeout(timer);
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', failed);
      }
      function loaded() {
        cleanup();
        if (token !== activationToken) reject(new Error('WALLPAPER_SWITCH_SUPERSEDED'));
        else resolve();
      }
      function failed() {
        cleanup();
        reject(new Error('WALLPAPER_MEDIA_LOAD_FAILED'));
      }
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', failed, { once: true });
      timer = setTimeout(failed, 12000);
      image.src = url;
    });
  }

  function waitForVideo(video, token) {
    return new Promise(function (resolve, reject) {
      var timer = 0;
      function cleanup() {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('error', failed);
      }
      function finish() {
        cleanup();
        if (token !== activationToken) reject(new Error('WALLPAPER_SWITCH_SUPERSEDED'));
        else resolve();
      }
      function ready() {
        Promise.resolve(video.play()).then(function () {
          if (typeof video.requestVideoFrameCallback === 'function') {
            video.requestVideoFrameCallback(finish);
          } else {
            finish();
          }
        }).catch(failed);
      }
      function failed() {
        cleanup();
        reject(new Error('WALLPAPER_VIDEO_PLAY_FAILED'));
      }
      video.addEventListener('loadeddata', ready, { once: true });
      video.addEventListener('error', failed, { once: true });
      timer = setTimeout(failed, 15000);
      if (video.readyState >= 2) ready();
    });
  }

  async function showImageProject(project, kind, token) {
    var image = document.getElementById('wallpaper-engine-image');
    var url = projectMediaUrl(project, kind === 'preview' ? 'preview' : 'media', mediaToken);
    if (!image || !url) throw new Error('WALLPAPER_IMAGE_UNAVAILABLE');
    await waitForImage(image, url, token);
    if (token !== activationToken) return false;
    revealLayer(kind);
    commitSelection(project, kind);
    return true;
  }

  async function showVideoProject(project, token) {
    var video = document.getElementById('wallpaper-engine-video');
    var url = projectMediaUrl(project, 'media', mediaToken);
    if (!video || !url) throw new Error('WALLPAPER_VIDEO_UNAVAILABLE');
    video.srcObject = null;
    video.src = url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.load();
    await waitForVideo(video, token);
    if (token !== activationToken) return false;
    revealLayer('video');
    commitSelection(project, 'video');
    return true;
  }

  async function openSceneCapture(session, token, targetFps) {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('WALLPAPER_CAPTURE_UNSUPPORTED');
    }
    var sourceId = String(session && session.sourceId || '');
    if (!/^window:\d+:\d+$/.test(sourceId)) throw new Error('WALLPAPER_CAPTURE_SOURCE_INVALID');
    var stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: targetFps,
        },
      },
    });
    if (token !== activationToken) {
      stopMediaStream(stream);
      throw new Error('WALLPAPER_SWITCH_SUPERSEDED');
    }
    captureFps = targetFps;
    return stream;
  }

  async function showSceneProject(project, token) {
    var api = desktopApi();
    var video = document.getElementById('wallpaper-engine-video');
    if (!api || !video || typeof api.startWallpaperEngineScene !== 'function') {
      throw new Error('WALLPAPER_ENGINE_UNSUPPORTED');
    }
    var policy = currentWallpaperEnginePerformancePolicy();
    if (policy.suspended) throw new Error('WALLPAPER_ENGINE_SUSPENDED');
    var targetFps = policy.fps || 60;
    var session = await api.startWallpaperEngineScene({ id: project.id, fps: targetFps });
    if (!session || session.ok === false || !session.sessionId || !session.sourceId) {
      throw new Error(session && session.error || 'WALLPAPER_ENGINE_SCENE_START_FAILED');
    }
    if (token !== activationToken) {
      await stopNativeSession(session.sessionId);
      return false;
    }
    nativeSessionId = String(session.sessionId);
    try {
      captureStream = await openSceneCapture(session, token, targetFps);
      video.removeAttribute('src');
      video.srcObject = captureStream;
      video.muted = true;
      video.loop = false;
      video.playsInline = true;
      await waitForVideo(video, token);
      var parked = await api.parkWallpaperEngineScene({ sessionId: nativeSessionId });
      if (!parked || parked.ok === false) throw new Error(parked && parked.error || 'WALLPAPER_ENGINE_SCENE_PARK_FAILED');
      if (token !== activationToken) return false;
      revealLayer('engine');
      commitSelection(project, 'engine');
      return true;
    } catch (error) {
      stopMediaStream(captureStream);
      captureStream = null;
      video.srcObject = null;
      await stopNativeSession(nativeSessionId);
      throw error;
    }
  }

  async function syncWallpaperEngineCaptureFrameRate() {
    var policy = currentWallpaperEnginePerformancePolicy();
    if (policy.suspended) return { ok: false, suspended: true, fps: 0 };
    var track = captureStream && captureStream.getVideoTracks
      ? captureStream.getVideoTracks()[0] : null;
    if (!track || typeof track.applyConstraints !== 'function') {
      return { ok: false, skipped: true, fps: policy.fps };
    }
    var targetFps = policy.fps || 60;
    try {
      var capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
      var range = capabilities && capabilities.frameRate;
      if (range && Number(range.min) > 0) targetFps = Math.max(Number(range.min), targetFps);
      if (range && Number(range.max) > 0) targetFps = Math.min(Number(range.max), targetFps);
    } catch (_capabilitiesError) {}
    try {
      await track.applyConstraints({ frameRate: { ideal: targetFps, max: targetFps } });
      try { track.contentHint = 'motion'; } catch (_contentHintError) {}
      captureFps = targetFps;
      return { ok: true, fps: targetFps };
    } catch (error) {
      return { ok: false, error: friendlyError(error), fps: captureFps };
    }
  }

  async function suspendWallpaperEnginePlayback(reason) {
    if (!selection.active || wallpaperPlaybackSuspended) {
      return { ok: true, suspended: wallpaperPlaybackSuspended, reason: reason || '' };
    }
    wallpaperPlaybackSuspended = true;
    ++activationToken;
    var stream = captureStream;
    var sessionId = nativeSessionId;
    captureStream = null;
    captureFps = 0;
    nativeSessionId = '';
    if (stream) stopMediaStream(stream);
    var video = document.getElementById('wallpaper-engine-video');
    if (video) {
      try { video.pause(); } catch (_pauseError) {}
    }
    if (sessionId) await stopNativeSession(sessionId);
    return { ok: true, suspended: true, reason: reason || '' };
  }

  async function resumeWallpaperEnginePlayback(reason) {
    var policy = currentWallpaperEnginePerformancePolicy();
    if (!selection.active || policy.suspended) {
      return { ok: false, suspended: policy.suspended, reason: reason || '' };
    }
    if (!wallpaperPlaybackSuspended) return syncWallpaperEngineCaptureFrameRate();
    var project = projectById(selection.id);
    if (!project) {
      await loadLibrary(false, false);
      project = projectById(selection.id);
    }
    if (!project) return { ok: false, missing: true, reason: reason || '' };
    wallpaperPlaybackSuspended = false;
    if (selection.kind === 'engine') {
      return { ok: await activateProject(project, { silent: true }), resumed: true };
    }
    var video = document.getElementById('wallpaper-engine-video');
    if (selection.kind === 'video' && video) {
      try {
        await video.play();
        return { ok: true, resumed: true };
      } catch (error) {
        wallpaperPlaybackSuspended = true;
        return { ok: false, error: friendlyError(error) };
      }
    }
    return { ok: true, resumed: true };
  }

  function queueWallpaperEnginePerformanceSync(reason) {
    lifecycleSyncPromise = lifecycleSyncPromise.catch(function () {}).then(async function () {
      await refreshDesktopLifecycleState();
      if (!selection.active) return { ok: true, skipped: true };
      var policy = currentWallpaperEnginePerformancePolicy();
      if (policy.suspended) return suspendWallpaperEnginePlayback(reason);
      if (wallpaperPlaybackSuspended) return resumeWallpaperEnginePlayback(reason);
      return syncWallpaperEngineCaptureFrameRate();
    });
    return lifecycleSyncPromise;
  }

  async function activateProject(project, options) {
    options = options || {};
    project = normalizeProject(project);
    var kind = projectPlaybackKind(project);
    if (!project.id || !kind) {
      if (!options.silent) notify('这个项目没有可用画面');
      return false;
    }
    var token = ++activationToken;
    updateStatus('正在连接 ' + project.title + '…', true);
    await releaseCurrentPlayback();
    if (token !== activationToken) return false;
    try {
      if (kind === 'engine') await showSceneProject(project, token);
      else if (kind === 'video') await showVideoProject(project, token);
      else await showImageProject(project, kind, token);
      updateLibrarySummary();
      if (!options.silent) notify('已使用 Wallpaper Engine 背景');
      return true;
    } catch (error) {
      if (token !== activationToken) return false;
      if (/WALLPAPER_ENGINE_SUSPENDED/.test(String(error && (error.code || error.message) || error || ''))) {
        wallpaperPlaybackSuspended = true;
        updateStatus(project.title + ' · 窗口恢复后继续', false);
        return false;
      }
      clearLayerMedia();
      if (kind === 'engine' && project.hasPreview) {
        try {
          await showImageProject(project, 'preview', token);
          updateStatus(project.title + ' · Scene 连接失败，已显示预览', false);
          if (!options.silent) notify('Scene 连接失败，已显示项目预览');
          return true;
        } catch (_previewError) {}
      }
      restoreOriginalBackground();
      selection = normalizeSelection({});
      saveSelection();
      updateEntry();
      renderLibrary();
      updateStatus('连接失败：' + friendlyError(error), false);
      if (!options.silent) notify('Wallpaper Engine 连接失败');
      return false;
    }
  }

  function renderManualRoots() {
    var root = document.getElementById('wallpaper-engine-manual-roots');
    if (!root) return;
    root.replaceChildren();
    var roots = librarySnapshot && Array.isArray(librarySnapshot.manualRoots)
      ? librarySnapshot.manualRoots : [];
    roots.forEach(function (item) {
      var chip = document.createElement('div');
      chip.className = 'wallpaper-engine-root-chip';
      var label = document.createElement('span');
      label.textContent = String(item && item.name || '导入目录');
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = '×';
      button.title = '移除此目录';
      button.setAttribute('aria-label', '移除此目录');
      button.addEventListener('click', function () { removeWallpaperEngineDirectory(item && item.id); });
      chip.appendChild(label);
      chip.appendChild(button);
      root.appendChild(chip);
    });
  }

  function createProjectCard(project) {
    var kind = projectPlaybackKind(project);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'wallpaper-engine-card';
    button.setAttribute('data-wallpaper-id', project.id);
    button.setAttribute('aria-pressed', selection.active && selection.id === project.id ? 'true' : 'false');
    button.classList.toggle('active', selection.active && selection.id === project.id);
    button.title = project.title;

    var placeholder = document.createElement('span');
    placeholder.className = 'wallpaper-engine-card-placeholder';
    placeholder.textContent = 'WE';
    button.appendChild(placeholder);

    var previewUrl = project.hasPreview ? projectMediaUrl(project, 'preview', mediaToken) : '';
    if (previewUrl) {
      var image = document.createElement('img');
      image.className = 'wallpaper-engine-card-preview';
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('load', function () { image.classList.add('loaded'); }, { once: true });
      image.src = previewUrl;
      button.appendChild(image);
    }

    var badge = document.createElement('span');
    badge.className = 'wallpaper-engine-card-kind';
    badge.textContent = playbackLabel(kind);
    button.appendChild(badge);

    var meta = document.createElement('span');
    meta.className = 'wallpaper-engine-card-meta';
    meta.textContent = project.title;
    var sub = document.createElement('small');
    sub.textContent = project.sourceLabel || project.projectType || 'Wallpaper Engine';
    meta.appendChild(sub);
    button.appendChild(meta);
    button.addEventListener('click', function () { activateProject(project); });
    return button;
  }

  function renderLibrary() {
    var grid = document.getElementById('wallpaper-engine-grid');
    if (!grid) return;
    var search = document.getElementById('wallpaper-engine-search');
    var query = String(search && search.value || '').trim().toLowerCase();
    var visible = projects.filter(function (project) {
      return !query || (project.title + ' ' + project.sourceLabel + ' ' + project.projectType).toLowerCase().includes(query);
    });
    grid.replaceChildren();
    if (libraryBusy) {
      var loading = document.createElement('div');
      loading.className = 'wallpaper-engine-empty';
      loading.textContent = '正在识别…';
      grid.appendChild(loading);
      return;
    }
    if (!visible.length) {
      var empty = document.createElement('div');
      empty.className = 'wallpaper-engine-empty';
      empty.textContent = query ? '没有匹配的壁纸' : '未识别到 Wallpaper Engine 项目';
      grid.appendChild(empty);
      return;
    }
    visible.forEach(function (project) { grid.appendChild(createProjectCard(project)); });
  }

  function updateLibrarySummary() {
    if (!librarySnapshot) {
      updateStatus('等待识别', false);
      return;
    }
    var runtime = librarySnapshot.runtime;
    var runtimeText = runtime && runtime.available === false ? ' · 未找到 Wallpaper Engine 本体' : '';
    updateStatus(
      '已识别 ' + projects.length + ' 个项目 · ' +
      Number(librarySnapshot.dynamicCount || 0) + ' 个视频 · ' +
      Number(librarySnapshot.enginePlayableCount || 0) + ' 个 Scene' + runtimeText,
      false
    );
  }

  function consumeSnapshot(snapshot) {
    librarySnapshot = snapshot;
    mediaToken = /^[a-f0-9]{48}$/i.test(String(snapshot && snapshot.mediaToken || ''))
      ? String(snapshot.mediaToken).toLowerCase() : '';
    projects = snapshot && Array.isArray(snapshot.projects)
      ? snapshot.projects.map(normalizeProject).filter(function (project) {
        return project.id && projectPlaybackKind(project);
      })
      : [];
    renderManualRoots();
    renderLibrary();
    updateLibrarySummary();
  }

  async function loadLibrary(force, showNotice) {
    var api = desktopApi();
    if (!api || typeof api.listWallpaperEngineProjects !== 'function') {
      updateStatus('仅桌面版支持本地项目识别', false);
      return [];
    }
    if (libraryBusy) return projects;
    libraryBusy = true;
    updateStatus('正在识别 Steam 创意工坊与本地项目…', true);
    renderLibrary();
    try {
      var snapshot = await api.listWallpaperEngineProjects({ force: force === true });
      if (!snapshot || snapshot.ok === false) throw new Error(snapshot && snapshot.error || '扫描失败');
      consumeSnapshot(snapshot);
      if (showNotice) notify(snapshot.count ? ('已识别 ' + snapshot.count + ' 个项目') : '没有识别到项目');
      return projects;
    } catch (error) {
      projects = [];
      librarySnapshot = null;
      mediaToken = '';
      updateStatus('识别失败：' + friendlyError(error), false);
      if (showNotice) notify('Wallpaper Engine 识别失败');
      return [];
    } finally {
      libraryBusy = false;
      renderLibrary();
      if (librarySnapshot) updateLibrarySummary();
    }
  }

  async function importWith(method, successMessage) {
    var api = desktopApi();
    if (!api || typeof api[method] !== 'function' || libraryBusy) return;
    libraryBusy = true;
    updateStatus('正在导入…', true);
    renderLibrary();
    try {
      var snapshot = await api[method]();
      if (snapshot && snapshot.canceled) return;
      if (!snapshot || snapshot.ok === false) throw new Error(snapshot && snapshot.error || '导入失败');
      consumeSnapshot(snapshot);
      notify(successMessage);
    } catch (error) {
      updateStatus('导入失败：' + friendlyError(error), false);
      notify('Wallpaper Engine 导入失败');
    } finally {
      libraryBusy = false;
      renderLibrary();
      if (librarySnapshot) updateLibrarySummary();
    }
  }

  async function openWallpaperEngineLibrary() {
    var modal = document.getElementById('wallpaper-engine-modal');
    if (modal) modal.classList.add('show');
    if (!librarySnapshot) await loadLibrary(false, false);
    else renderLibrary();
  }

  function closeWallpaperEngineLibrary() {
    var modal = document.getElementById('wallpaper-engine-modal');
    if (modal) modal.classList.remove('show');
  }

  async function refreshWallpaperEngineLibrary() {
    await loadLibrary(true, true);
  }

  function chooseWallpaperEngineDirectory() {
    return importWith('chooseWallpaperEngineDirectory', 'Wallpaper Engine 目录已导入');
  }

  function chooseWallpaperEngineProjectFile() {
    return importWith('chooseWallpaperEngineProjectFile', 'Wallpaper Engine 项目已导入');
  }

  async function removeWallpaperEngineDirectory(rootId) {
    var api = desktopApi();
    if (!api || typeof api.removeWallpaperEngineDirectory !== 'function') return;
    var snapshot = await api.removeWallpaperEngineDirectory(rootId);
    if (!snapshot || snapshot.ok === false) {
      notify('移除目录失败');
      return;
    }
    consumeSnapshot(snapshot);
    if (selection.active && !projectById(selection.id)) await deactivateWallpaperEngineBackground();
  }

  async function deactivateWallpaperEngineBackground() {
    ++activationToken;
    await releaseCurrentPlayback();
    wallpaperPlaybackSuspended = false;
    selection = normalizeSelection({});
    saveSelection();
    updateEntry();
    renderLibrary();
    updateLibrarySummary();
    notify('已恢复 Mineradio 原背景');
  }

  function updateDesktopLifecycleState(value) {
    mergeDesktopLifecycleState(value);
    queueWallpaperEnginePerformanceSync('desktop-window-state');
  }

  function bindEvents() {
    var search = document.getElementById('wallpaper-engine-search');
    if (search) search.addEventListener('input', renderLibrary);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeWallpaperEngineLibrary();
    });
    document.addEventListener('visibilitychange', function () {
      queueWallpaperEnginePerformanceSync('visibilitychange');
    });
    var api = desktopApi();
    if (api && typeof api.onStateChange === 'function') {
      desktopStateUnsubscribe = api.onStateChange(updateDesktopLifecycleState);
    }
    if (api && typeof api.getState === 'function') {
      Promise.resolve(api.getState()).then(updateDesktopLifecycleState).catch(function () {});
    }
    window.addEventListener('pagehide', function () {
      ++activationToken;
      clearLayerMedia();
      if (nativeSessionId) stopNativeSession(nativeSessionId);
      if (typeof desktopStateUnsubscribe === 'function') desktopStateUnsubscribe();
      desktopStateUnsubscribe = null;
    });
  }

  async function restoreSavedSelection() {
    updateEntry();
    if (!selection.active || !desktopApi()) return;
    await loadLibrary(false, false);
    var project = projectById(selection.id);
    if (!project) {
      selection = normalizeSelection({});
      saveSelection();
      updateEntry();
      return;
    }
    await waitForPlayerEntry();
    if (!selection.active || selection.id !== project.id) return;
    await activateProject(project, { silent: true });
  }

  window.openWallpaperEngineLibrary = openWallpaperEngineLibrary;
  window.closeWallpaperEngineLibrary = closeWallpaperEngineLibrary;
  window.refreshWallpaperEngineLibrary = refreshWallpaperEngineLibrary;
  window.chooseWallpaperEngineDirectory = chooseWallpaperEngineDirectory;
  window.chooseWallpaperEngineProjectFile = chooseWallpaperEngineProjectFile;
  window.removeWallpaperEngineDirectory = removeWallpaperEngineDirectory;
  window.deactivateWallpaperEngineBackground = deactivateWallpaperEngineBackground;
  window.restoreOriginalBackground = restoreOriginalBackground;
  window.__mineradioSyncWallpaperEngineCaptureFrameRate = function () {
    return queueWallpaperEnginePerformanceSync('resource-policy');
  };
  window.__mineradioWallpaperEngineSnapshot = function () {
    return {
      active: selection.active,
      id: selection.id,
      kind: selection.kind,
      projectCount: projects.length,
      nativeSessionId: nativeSessionId,
      captureTrackCount: captureStream && captureStream.getTracks ? captureStream.getTracks().length : 0,
      captureFps: captureFps,
      suspended: wallpaperPlaybackSuspended,
      desktopState: {
        isVisible: desktopLifecycleState.isVisible,
        isMinimized: desktopLifecycleState.isMinimized,
        isFocused: desktopLifecycleState.isFocused,
      },
      layerReady: !!(document.getElementById('wallpaper-engine-layer') && document.getElementById('wallpaper-engine-layer').classList.contains('ready')),
    };
  };

  document.addEventListener('DOMContentLoaded', function () {
    bindEvents();
    restoreSavedSelection();
  }, { once: true });
})(window);
