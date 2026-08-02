'use strict';

const {
  buildFallbackFoliaThemeResult,
  buildFoliaThemeInput,
  normalizeFoliaThemeSettings,
  sanitizeFoliaThemeResult,
} = require('../../public/folia-theme-state');

const DEFAULT_TIMEOUT_MS = 18000;

function requireFunction(deps, name) {
  const fn = deps[name];
  if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  return fn;
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function requestWithTimeout(fetchImpl, url, options, timeoutMs) {
  timeoutMs = Math.max(3000, Math.min(45000, finiteNumber(timeoutMs, DEFAULT_TIMEOUT_MS)));
  if (typeof AbortController !== 'function') return fetchImpl(url, options || {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseAiJsonContent(content) {
  if (content && typeof content === 'object') return content;
  let text = String(content || '').trim();
  if (!text) return {};
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch (_err) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw _err;
  }
}

function openAiChatUrl(apiUrl) {
  return String(apiUrl || '').replace(/\/+$/, '') + '/chat/completions';
}

function buildThemeMessages(themeInput) {
  const schema = [
    'Return strict JSON only. No markdown.',
    'JSON shape:',
    '{',
    '  "theme": {',
    '    "dark": {"name":"","backgroundColor":"#000000","primaryColor":"#ffffff","accentColor":"#7dd3fc","secondaryColor":"#cbd5e1","fontStyle":"sans","animationIntensity":"normal"},',
    '    "light": {"name":"","backgroundColor":"#ffffff","primaryColor":"#111827","accentColor":"#2563eb","secondaryColor":"#475569","fontStyle":"sans","animationIntensity":"normal"}',
    '  },',
    '  "lyricFont": "sans|serif|mono",',
    '  "lyricColor": "#ffffff",',
    '  "lyricHighlightColor": "#7dd3fc",',
    '  "lyricGlowColor": "#7dd3fc",',
    '  "backgroundColor": "#0f172a",',
    '  "backgroundAtmosphere": "short Chinese mood label",',
    '  "commentColor": "#cbd5e1",',
    '  "particleTint": "#7dd3fc"',
    '}',
  ].join('\n');
  return [
    {
      role: 'system',
      content: 'You design Folia/Mineradio song visual themes. Choose readable, stable colors. ' + schema,
    },
    {
      role: 'user',
      content: themeInput.promptText,
    },
  ];
}

function createFoliaThemeRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const readRequestBody = requireFunction(deps, 'readRequestBody');
  const fetchImpl = deps.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const requestTimeoutMs = finiteNumber(deps.requestTimeoutMs, DEFAULT_TIMEOUT_MS);
  const logErrors = deps.logErrors !== false;

  async function handleGenerate(req, res) {
    if ((req.method || 'GET') !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return;
    }

    const body = await readRequestBody(req);
    const themeInput = buildFoliaThemeInput({
      song: body.song || {},
      lyricsLines: body.lyricsLines || body.lyrics || [],
      coverColors: body.coverColors || [],
      isPureMusic: body.isPureMusic === true,
    });
    const settings = normalizeFoliaThemeSettings(body.settings || {});
    const envKey = String(process.env.MINERADIO_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    const apiKey = settings.apiKey || envKey;

    if (!apiKey || !fetchImpl) {
      const themeResult = buildFallbackFoliaThemeResult(themeInput);
      sendJSON(res, {
        ok: true,
        generated: false,
        reason: !apiKey ? 'missing-api-key' : 'fetch-unavailable',
        themeInput,
        themeResult,
      });
      return;
    }

    try {
      const response = await requestWithTimeout(fetchImpl, openAiChatUrl(settings.apiUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.78,
          response_format: { type: 'json_object' },
          messages: buildThemeMessages(themeInput),
        }),
      }, requestTimeoutMs);

      if (!response || !response.ok) {
        throw new Error('AI_THEME_REQUEST_FAILED_' + (response && response.status ? response.status : 'UNKNOWN'));
      }

      const data = await response.json();
      const content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : data;
      const parsed = parseAiJsonContent(content);
      const themeResult = sanitizeFoliaThemeResult(Object.assign({ source: 'ai', generated: true }, parsed), themeInput);
      sendJSON(res, {
        ok: true,
        generated: true,
        provider: settings.provider,
        model: settings.model,
        themeInput,
        themeResult,
      });
    } catch (err) {
      if (logErrors) console.warn('[FoliaTheme]', err && err.message || err);
      const fallback = buildFallbackFoliaThemeResult(themeInput);
      sendJSON(res, {
        ok: false,
        generated: false,
        error: err && err.message || 'AI_THEME_FAILED',
        fallback: true,
        themeInput,
        themeResult: fallback,
      }, 200);
    }
  }

  async function handleRoute(pn, req, res, _url) {
    if (pn === '/api/folia/theme/generate') {
      await handleGenerate(req, res);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  buildThemeMessages,
  createFoliaThemeRoutes,
  parseAiJsonContent,
};
