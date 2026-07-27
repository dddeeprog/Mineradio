/*
 * Cappella conversation model adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricCappellaState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MAX_VISIBLE_MESSAGES = 20;
  var WIDTH_LOOKAHEAD_SECONDS = 0.2;
  var DEFAULT_FADE_SECONDS = 0.22;
  var AVATAR_FILES = [
    'avatar2.png', 'avatar3.png', 'avatar4.png', 'avatar5.png', 'avatar6.png',
    'avatar8.png', 'avatar9.png', 'avatar10.png', 'avatar11.png', 'avatar12.png',
    'avatar13.png', 'avatar14.png', 'avatar15.png', 'avatar16.png', 'avatar17.png',
  ];
  var EMOJI_FILES = [
    'happy1.png', 'love1.png', 'normal1.png', 'sleepy1.png', 'sleepy2.png',
    'sleepy3.png', 'vibe1.png', 'vibe2.png', 'vibe3.png',
  ];

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function hash32(value) {
    var hash = 2166136261;
    value = String(value || '');
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededUnit() {
    return hash32(Array.prototype.join.call(arguments, '|')) / 4294967295;
  }

  function keyFor(type, documentId, line, suffix) {
    return type + ':' + hash32([
      documentId,
      line && line.index,
      line && line.startTime,
      line && line.endTime,
      line && line.fullText,
      suffix || '',
    ].join('|')).toString(36);
  }

  function formatTimestamp(seconds) {
    var total = Math.max(0, Math.floor(finite(seconds, 0)));
    var minutes = Math.floor(total / 60);
    var remaining = total % 60;
    return minutes + ':' + String(remaining).padStart(2, '0');
  }

  function collectAgentSenders(lines) {
    var ids = [];
    lines.forEach(function(line) {
      var id = String(line.agentId || '').trim();
      if (id && ids.indexOf(id) < 0) ids.push(id);
    });
    if (ids.length < 2) return null;
    var senders = Object.create(null);
    ids.forEach(function(id, index) {
      senders[id] = index === 0
        ? { side: 'right', avatarIndex: AVATAR_FILES.length - 1 }
        : { side: 'left', avatarIndex: (index - 1) % Math.max(1, AVATAR_FILES.length - 1) };
    });
    return senders;
  }

  function buildFallbackSenders(lines, seed) {
    var sequence = ['left', 'right', 'left', 'right', 'right'];
    var cursor = 0;
    var leftAvatar = 0;
    var previous = null;
    return lines.map(function(line, index) {
      var compactLength = Array.from(line.fullText.replace(/\s/g, '')).length;
      var forceRight = (index + 1) % 5 === 0;
      var carry = !forceRight && compactLength <= 12 && previous && seededUnit('carry', seed, line.startTime, index) <= 0.68;
      var side = forceRight ? 'right' : sequence[cursor % sequence.length];
      if (!forceRight && !carry && seededUnit('flip', seed, line.startTime, index) < 0.18) side = side === 'left' ? 'right' : 'left';
      var sender = carry ? previous : {
        side: side,
        avatarIndex: side === 'right' ? AVATAR_FILES.length - 1 : leftAvatar % Math.max(1, AVATAR_FILES.length - 1),
      };
      if (!carry) {
        cursor = forceRight ? 0 : cursor + 1;
        if (sender.side === 'left') leftAvatar += 1;
      }
      previous = forceRight ? null : sender;
      return sender;
    });
  }

  function pickAsset(files, basePath, seed) {
    if (!files.length) return '';
    var index = hash32(seed) % files.length;
    return basePath.replace(/\/$/, '') + '/' + files[index];
  }

  function pickAssetUrl(urls, files, basePath, seed) {
    if (Array.isArray(urls) && urls.length) return urls[hash32(seed) % urls.length];
    return pickAsset(files, basePath, seed);
  }

  function characterPlan(line) {
    var characters = (line.graphemes || []).map(function(item) { return item.char; });
    var revealTimes = (line.graphemes || []).map(function(item) { return finite(item.startTime, line.startTime); });
    var fadeDurations = (line.graphemes || []).map(function(item) {
      return Math.max(0.04, finite(item.endTime, item.startTime + DEFAULT_FADE_SECONDS) - finite(item.startTime, line.startTime));
    });
    var timestampReadyTime = revealTimes.reduce(function(latest, time, index) {
      return Math.max(latest, time + (fadeDurations[index] || DEFAULT_FADE_SECONDS));
    }, line.startTime);
    return {
      characters: characters,
      revealTimes: revealTimes,
      fadeDurations: fadeDurations,
      timestampReadyTime: timestampReadyTime,
    };
  }

  function buildCappellaModel(document, options) {
    options = options || {};
    document = document || { id: 'lyrics', title: '', artist: '', lines: [] };
    var lines = Array.isArray(document.lines) ? document.lines : [];
    var seed = String(options.seed || document.id || document.title || 'cappella');
    var agentSenders = collectAgentSenders(lines);
    var fallbackSenders = buildFallbackSenders(lines, seed);
    var avatarBasePath = options.avatarBasePath || 'folia-native/assets/cappella/avatar';
    var emojiBasePath = options.emojiBasePath || 'folia-native/assets/cappella/emo';
    var avatarUrls = Array.isArray(options.avatarUrls) ? options.avatarUrls : [];
    var emojiUrls = Array.isArray(options.emojiUrls) ? options.emojiUrls : [];
    var messages = [{
      key: 'title:' + hash32(document.id || document.title).toString(36),
      kind: 'title',
      lineIndex: -1,
      side: 'right',
      avatarIndex: AVATAR_FILES.length - 1,
      avatarUrl: pickAssetUrl(avatarUrls, AVATAR_FILES, avatarBasePath, seed + '|title'),
      text: document.title || 'Mineradio',
      timestamp: '',
    }];

    lines.forEach(function(line, index) {
      var sender = agentSenders && agentSenders[line.agentId] || fallbackSenders[index];
      var avatarUrl = pickAssetUrl(avatarUrls, AVATAR_FILES, avatarBasePath, [seed, sender.side, sender.avatarIndex].join('|'));
      var interlude = /^(?:\.{3,}|…{2,})$/.test(String(line.fullText || '').replace(/\s/g, ''));
      if (interlude) {
        messages.push({
          key: keyFor('emoji', document.id, line),
          kind: 'emoji',
          line: line,
          lineIndex: index,
          side: sender.side,
          avatarIndex: sender.avatarIndex,
          avatarUrl: avatarUrl,
          assetUrl: pickAssetUrl(emojiUrls, EMOJI_FILES, emojiBasePath, [seed, line.startTime, index].join('|')),
          text: '',
          timestamp: formatTimestamp(line.startTime),
        });
        return;
      }
      var plan = characterPlan(line);
      messages.push({
        key: keyFor('lyric', document.id, line),
        kind: 'lyric',
        line: line,
        lineIndex: index,
        side: sender.side,
        avatarIndex: sender.avatarIndex,
        avatarUrl: avatarUrl,
        text: line.fullText,
        timestamp: formatTimestamp(line.startTime),
        characters: plan.characters,
        revealTimes: plan.revealTimes,
        fadeDurations: plan.fadeDurations,
        timestampReadyTime: plan.timestampReadyTime,
      });
    });

    return {
      documentId: document.id,
      title: document.title,
      seed: seed,
      messages: messages,
    };
  }

  function countAtTime(times, now) {
    var low = 0;
    var high = times.length;
    while (low < high) {
      var middle = (low + high) >> 1;
      if (times[middle] <= now) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function estimatedHeight(message, active) {
    if (message.kind === 'title') return 48;
    if (message.kind === 'emoji') return active ? 184 : 132;
    var rows = Math.max(1, Math.ceil(Array.from(message.text || '').length / 18));
    return rows * (active ? 34 : 26) + (active ? 48 : 38);
  }

  function resolveCappellaFrame(model, frame, options) {
    options = options || {};
    model = model || { messages: [] };
    frame = frame || { now: 0, lineIndex: -1 };
    var now = finite(frame.now, 0);
    var lineIndex = Math.floor(finite(frame.lineIndex, -1));
    var maxMessages = Math.max(2, Math.min(MAX_VISIBLE_MESSAGES, Math.floor(finite(options.maxMessages, MAX_VISIBLE_MESSAGES))));
    var viewportHeight = Math.max(240, finite(options.viewportHeight, frame.viewport && frame.viewport.height || 900));
    var candidates = model.messages.filter(function(message) {
      return message.kind === 'title' || message.lineIndex <= lineIndex;
    });
    var availableHeight = Math.max(200, viewportHeight - 240);
    var usedHeight = 0;
    var selected = [];
    for (var index = candidates.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
      var message = candidates[index];
      var active = message.lineIndex === lineIndex;
      var height = estimatedHeight(message, active);
      if (selected.length >= 2 && usedHeight + height > availableHeight) break;
      usedHeight += height;
      selected.unshift(message);
    }
    return {
      messages: selected.map(function(message) {
        var role = message.lineIndex === lineIndex ? 'active' : (message.lineIndex < lineIndex ? 'passed' : 'upcoming');
        var visibleCharacterCount = message.kind === 'lyric'
          ? (role === 'passed' ? message.characters.length : countAtTime(message.revealTimes, now))
          : 0;
        return Object.assign({}, message, {
          role: role,
          visibleCharacterCount: visibleCharacterCount,
          targetCharacterCount: message.kind === 'lyric' ? countAtTime(message.revealTimes.map(function(time) { return time - WIDTH_LOOKAHEAD_SECONDS; }), now) : 0,
          timestampVisible: message.kind === 'lyric'
            ? now >= message.timestampReadyTime
            : message.kind === 'emoji' && now >= message.line.endTime,
        });
      }),
      activeLineIndex: lineIndex,
    };
  }

  function prepareCappellaBubbleMetrics(line, options) {
    options = options || {};
    var fontSize = Math.max(1, finite(options.fontSize, 18));
    var lineHeight = Math.max(fontSize, finite(options.lineHeight, fontSize * 1.45));
    var maxTextWidth = Math.max(1, finite(options.maxTextWidth, 480));
    var paddingX = Math.max(0, finite(options.paddingX, 18));
    var paddingY = Math.max(0, finite(options.paddingY, 14));
    var wrapSafety = clamp(options.wrapSafety, 0.7, 1, 0.88);
    var measureText = typeof options.measureText === 'function' ? options.measureText : function(text) { return Array.from(text).length * fontSize; };
    var characters = (line.graphemes || []).map(function(item) { return item.char; });
    var revealTimes = (line.graphemes || []).map(function(item) { return finite(item.startTime, line.startTime); });
    var fullTextWidth = Math.max(fontSize, finite(measureText(characters.join('')), fontSize));
    var lineCount = fullTextWidth > maxTextWidth ? 2 : 1;
    var fitScale = Math.min(1, maxTextWidth * lineCount * wrapSafety / fullTextWidth);
    var fittedFontSize = fontSize * fitScale;
    var fittedLineHeight = lineHeight * fitScale;
    var fixedSize = {
      width: Math.ceil(maxTextWidth + paddingX * 2 + 2),
      height: Math.ceil(lineCount * fittedLineHeight + paddingY * 2 + 2),
    };
    var sizes = Array.from({ length: characters.length + 1 }, function() {
      return { width: fixedSize.width, height: fixedSize.height };
    });
    return {
      characters: characters,
      sizes: sizes,
      revealTimes: revealTimes,
      lineCount: lineCount,
      fontSize: fittedFontSize,
      lineHeight: fittedLineHeight,
      bubbleTargetTimes: revealTimes.map(function(time) { return time - WIDTH_LOOKAHEAD_SECONDS; }),
    };
  }

  return {
    MAX_VISIBLE_MESSAGES: MAX_VISIBLE_MESSAGES,
    AVATAR_FILES: AVATAR_FILES.slice(),
    EMOJI_FILES: EMOJI_FILES.slice(),
    buildCappellaModel: buildCappellaModel,
    resolveCappellaFrame: resolveCappellaFrame,
    prepareCappellaBubbleMetrics: prepareCappellaBubbleMetrics,
    countAtTime: countAtTime,
    formatTimestamp: formatTimestamp,
  };
});
