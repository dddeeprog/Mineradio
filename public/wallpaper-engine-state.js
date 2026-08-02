(function wallpaperEngineStateModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioWallpaperEngineState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWallpaperEngineState() {
  'use strict';

  const PROJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
  const MEDIA_TOKEN_PATTERN = /^[a-f0-9]{48}$/i;
  const PLAYBACK_KINDS = new Set(['engine', 'video', 'image', 'preview']);

  function cleanText(value, maxLength = 160) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function normalizeId(value) {
    const id = String(value || '').trim().toLowerCase();
    return PROJECT_ID_PATTERN.test(id) ? id : '';
  }

  function normalizeKind(value) {
    const kind = String(value || '').trim().toLowerCase();
    return PLAYBACK_KINDS.has(kind) ? kind : '';
  }

  function normalizeProject(value) {
    const source = value && typeof value === 'object' ? value : {};
    const id = normalizeId(source.id);
    const projectType = cleanText(source.projectType, 32)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    const mediaType = ['video', 'image'].includes(String(source.mediaType || '').toLowerCase())
      ? String(source.mediaType).toLowerCase()
      : '';

    return {
      id,
      title: cleanText(source.title) || '未命名壁纸',
      projectType,
      mediaType,
      playable: source.playable === true,
      enginePlayable: source.enginePlayable === true,
      previewOnly: source.previewOnly === true,
      hasPreview: source.hasPreview === true,
      previewAnimated: source.previewAnimated === true,
      mediaAnimated: source.mediaAnimated === true,
      source: cleanText(source.source, 32),
      sourceLabel: cleanText(source.sourceLabel, 80),
      workshopId: /^\d{5,32}$/.test(String(source.workshopId || '').trim())
        ? String(source.workshopId).trim()
        : '',
      updatedAt: Math.max(0, Number.isFinite(Number(source.updatedAt)) ? Math.trunc(Number(source.updatedAt)) : 0),
    };
  }

  function projectPlaybackKind(value) {
    const project = normalizeProject(value);
    if (project.enginePlayable) return 'engine';
    if (project.playable && project.mediaType === 'video') return 'video';
    if (project.playable && project.mediaType === 'image') return 'image';
    if (project.hasPreview) return 'preview';
    return '';
  }

  function projectMediaUrl(value, kind, token) {
    const project = normalizeProject(value);
    const mediaKind = kind === 'media' || kind === 'preview' ? kind : '';
    const mediaToken = String(token || '').trim().toLowerCase();
    if (!project.id || !mediaKind || !MEDIA_TOKEN_PATTERN.test(mediaToken)) return '';
    return `mineradio-wallpaper://${mediaKind}/${project.id}?v=${project.updatedAt}&token=${mediaToken}`;
  }

  function normalizeSelection(value) {
    const source = value && typeof value === 'object' ? value : {};
    const id = normalizeId(source.id);
    const kind = normalizeKind(source.kind);
    if (source.active !== true || !id || !kind) {
      return { active: false, id: '', title: '', kind: '' };
    }
    return {
      active: true,
      id,
      title: cleanText(source.title),
      kind,
    };
  }

  function wallpaperEnginePerformancePolicy(value) {
    const source = value && typeof value === 'object' ? value : {};
    const suspended = source.hidden === true
      || source.isVisible === false
      || source.isMinimized === true
      || source.locked === true
      || source.systemSuspended === true;
    if (suspended) return { suspended: true, fps: 0 };

    const requested = Number(source.governorFps);
    const governed = Number.isFinite(requested) && requested > 0
      ? Math.max(15, Math.min(60, Math.round(requested)))
      : 60;
    return {
      suspended: false,
      fps: source.isFocused === false ? Math.min(24, governed) : governed,
    };
  }

  return {
    normalizeProject,
    normalizeSelection,
    projectPlaybackKind,
    projectMediaUrl,
    wallpaperEnginePerformancePolicy,
  };
});
