/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlaybackSourceMatch = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var VERSION_QUALIFIERS = Object.freeze([
    Object.freeze({ name: 'live', pattern: /\blive(?:\s+version)?\b/i }),
    Object.freeze({ name: 'remix', pattern: /\bremix(?:ed)?(?:\s+version)?\b/i }),
    Object.freeze({ name: 'acoustic', pattern: /\bacoustic(?:\s+version)?\b/i }),
    Object.freeze({ name: 'instrumental', pattern: /\binstrumental(?:\s+version)?\b|伴奏(?:版)?/i }),
  ]);

  function normalizeMatchText(text) {
    return String(text || '').toLowerCase()
      .replace(/[（(【\[].*?[）)】\]]/g, '')
      .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|]+/g, '');
  }

  function artistNameParts(song) {
    var parts = [];
    if (song && Array.isArray(song.artists)) {
      song.artists.forEach(function(artist) {
        if (artist && artist.name) parts.push(artist.name);
      });
    }
    if (song && song.artist) {
      String(song.artist)
        .split(/\s*\/\s*|\s*,\s*|、|&| feat\.? | ft\.? /i)
        .forEach(function(name) {
          if (name && name.trim()) parts.push(name.trim());
        });
    }
    return parts.map(normalizeMatchText).filter(function(name, index, names) {
      return name && names.indexOf(name) === index;
    });
  }

  function titleVersionParts(title) {
    var parts = [];
    var bracketPattern = /\(([^)]*)\)|（([^）]*)）|\[([^\]]*)\]|【([^】]*)】/g;
    var match;
    while ((match = bracketPattern.exec(String(title || ''))) !== null) {
      var content = match.slice(1).find(function(value) {
        return typeof value === 'string';
      }) || '';
      VERSION_QUALIFIERS.forEach(function(qualifier) {
        if (qualifier.pattern.test(content) && parts.indexOf(qualifier.name) < 0) {
          parts.push(qualifier.name);
        }
      });
    }
    return parts.sort();
  }

  function hasSameParts(sourceParts, candidateParts) {
    return sourceParts.length === candidateParts.length
      && sourceParts.every(function(part) {
        return candidateParts.indexOf(part) >= 0;
      });
  }

  function isSameTitleArtist(source, candidate) {
    if (!source || !candidate) return false;
    var sourceTitle = source.name || source.title;
    var candidateTitle = candidate.name || candidate.title;
    if (
      normalizeMatchText(sourceTitle)
      !== normalizeMatchText(candidateTitle)
    ) return false;
    if (!hasSameParts(
      titleVersionParts(sourceTitle),
      titleVersionParts(candidateTitle),
    )) return false;
    var sourceArtists = artistNameParts(source);
    var candidateArtists = artistNameParts(candidate);
    if (!sourceArtists.length || !candidateArtists.length) return false;
    return hasSameParts(sourceArtists, candidateArtists);
  }

  return Object.freeze({
    normalizeMatchText: normalizeMatchText,
    artistNameParts: artistNameParts,
    isSameTitleArtist: isSameTitleArtist,
  });
});
