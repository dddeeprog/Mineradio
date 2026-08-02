/*
 * Classic three-character lyric grouping adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var layout = root && root.MineradioNativeLyricLayout;
  if (typeof module === 'object' && module.exports) layout = require('./layout');
  var api = factory(layout || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricClassicThreeGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(layout) {
  'use strict';

  var MAX_BODY_SIZE = 4;
  var MAX_JOIN_GAP = 0.12;
  var CJK_REGEX = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  var SENTENCE_PUNCTUATION_REGEX = /[。！？!?；;.]/u;
  var PUNCTUATION_REGEX = /^[\p{P}\p{Z}\s]+$/u;

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function isCombiningCodePoint(char) {
    return /\p{M}/u.test(char)
      || /[\ufe00-\ufe0f]/u.test(char)
      || /[\u{1f3fb}-\u{1f3ff}]/u.test(char)
      || char === '\u20e3';
  }

  function splitGraphemesFallback(text) {
    var codePoints = Array.from(String(text || ''));
    var result = [];
    var regionalCount = 0;
    for (var index = 0; index < codePoints.length; index += 1) {
      var char = codePoints[index];
      var previous = result[result.length - 1];
      var previousEndsWithJoiner = previous && previous.charAt(previous.length - 1) === '\u200d';
      var isRegional = /[\u{1f1e6}-\u{1f1ff}]/u.test(char);
      if (previous && (isCombiningCodePoint(char) || char === '\u200d' || previousEndsWithJoiner)) {
        result[result.length - 1] += char;
      } else if (previous && isRegional && regionalCount % 2 === 1) {
        result[result.length - 1] += char;
      } else {
        result.push(char);
      }
      regionalCount = isRegional ? regionalCount + 1 : 0;
    }
    return result;
  }

  function splitGraphemes(text) {
    text = String(text || '');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), function(item) {
          return item.segment;
        });
      } catch (error) {
        // The deterministic fallback also keeps common joined emoji intact.
      }
    }
    return splitGraphemesFallback(text);
  }

  function isBodyGrapheme(char) {
    return !PUNCTUATION_REGEX.test(String(char || ''));
  }

  function countBody(graphemes) {
    return graphemes.reduce(function(count, item) {
      var char = typeof item === 'string' ? item : item.char;
      return count + (isBodyGrapheme(char) ? 1 : 0);
    }, 0);
  }

  function hasSentencePunctuation(text) {
    return SENTENCE_PUNCTUATION_REGEX.test(String(text || ''));
  }

  function hasCjk(text) {
    return CJK_REGEX.test(String(text || ''));
  }

  function balancedSliceSizes(count, maxSize) {
    count = Math.max(0, Math.floor(finite(count, 0)));
    maxSize = Math.max(1, Math.floor(finite(maxSize, 1)));
    if (!count) return [];
    var groupCount = Math.ceil(count / maxSize);
    var quotient = Math.floor(count / groupCount);
    var remainder = count % groupCount;
    return Array.from({ length: groupCount }, function(_, index) {
      return quotient + (index < remainder ? 1 : 0);
    });
  }

  function evenTimings(chars, startTime, endTime, wordIndex) {
    var duration = Math.max(0, endTime - startTime);
    return chars.map(function(char, index) {
      return {
        char: char,
        startTime: startTime + duration * index / Math.max(1, chars.length),
        endTime: index === chars.length - 1
          ? endTime
          : startTime + duration * (index + 1) / Math.max(1, chars.length),
        wordIndex: wordIndex,
      };
    });
  }

  function wordTimings(word, wordIndex) {
    var chars = splitGraphemes(word && word.text);
    var startTime = finite(word && word.startTime, 0);
    var endTime = Math.max(startTime, finite(word && word.endTime, startTime));
    var timings = [];
    if (typeof layout.buildWordGraphemeTimings === 'function') {
      try {
        timings = layout.buildWordGraphemeTimings(word, wordIndex);
      } catch (error) {
        timings = [];
      }
    }
    var previousEnd = startTime;
    var valid = Array.isArray(timings) && timings.length === chars.length;
    if (valid) {
      valid = timings.every(function(timing, index) {
        var timingStart = Number(timing && timing.startTime);
        var timingEnd = Number(timing && timing.endTime);
        var currentValid = timing && timing.char === chars[index]
          && isFinite(timingStart) && isFinite(timingEnd)
          && timingStart >= startTime && timingEnd <= endTime
          && timingStart >= previousEnd && timingEnd >= timingStart;
        previousEnd = timingEnd;
        return currentValid;
      });
    }
    if (!valid) return evenTimings(chars, startTime, endTime, wordIndex);
    return timings.map(function(timing, index) {
      return {
        char: chars[index],
        startTime: Number(timing.startTime),
        endTime: Number(timing.endTime),
        wordIndex: wordIndex,
      };
    });
  }

  function ownerFromParts(text, words, graphemes, flags) {
    flags = flags || {};
    var first = graphemes[0];
    var last = graphemes[graphemes.length - 1];
    var firstWord = words[0];
    var lastWord = words[words.length - 1];
    var startTime = first ? first.startTime : finite(firstWord && firstWord.startTime, 0);
    var endTime = last ? last.endTime : finite(lastWord && lastWord.endTime, startTime);
    return {
      text: text,
      words: words.slice(),
      graphemes: graphemes.slice(),
      startTime: startTime,
      endTime: Math.max(startTime, endTime),
      bodyGraphemeCount: countBody(graphemes),
      isCjk: hasCjk(text),
      isSticky: Boolean(flags.isSticky),
      isVisualSlice: Boolean(flags.isVisualSlice),
      isSemantic: Boolean(flags.isSemantic),
      hardBefore: Boolean(flags.hardBefore),
      hardAfter: Boolean(flags.hardAfter || hasSentencePunctuation(text)),
    };
  }

  function mergeOwners(owners) {
    var first = owners[0];
    var last = owners[owners.length - 1];
    return ownerFromParts(
      owners.map(function(owner) { return owner.text; }).join(''),
      owners.reduce(function(words, owner) { return words.concat(owner.words); }, []),
      owners.reduce(function(graphemes, owner) { return graphemes.concat(owner.graphemes); }, []),
      {
        isSticky: owners.some(function(owner) { return owner.isSticky; }),
        isVisualSlice: owners.some(function(owner) { return owner.isVisualSlice; }),
        isSemantic: owners.some(function(owner) { return owner.isSemantic; }),
        hardBefore: first.hardBefore,
        hardAfter: last.hardAfter,
      }
    );
  }

  function wordOwner(word, wordIndex, flags) {
    return ownerFromParts(String(word && word.text || ''), [word], wordTimings(word, wordIndex), flags);
  }

  function visualSliceOwners(word, wordIndex, flags) {
    var timings = wordTimings(word, wordIndex);
    var bodyCount = countBody(timings);
    var sizes = balancedSliceSizes(bodyCount, MAX_BODY_SIZE);
    var owners = [];
    var timingIndex = 0;
    sizes.forEach(function(size, sliceIndex) {
      var bodySeen = 0;
      var slice = [];
      while (timingIndex < timings.length && bodySeen < size) {
        var timing = timings[timingIndex++];
        slice.push(timing);
        if (isBodyGrapheme(timing.char)) bodySeen += 1;
      }
      while (timingIndex < timings.length && !isBodyGrapheme(timings[timingIndex].char)) {
        slice.push(timings[timingIndex++]);
      }
      owners.push(ownerFromParts(
        slice.map(function(timing) { return timing.char; }).join(''),
        [word],
        slice,
        {
          isSticky: flags && flags.isSticky && sliceIndex === sizes.length - 1,
          isVisualSlice: true,
          hardBefore: true,
          hardAfter: true,
        }
      ));
    });
    return owners;
  }

  function comparePartitionSizes(left, right) {
    if (left === right) return 0;
    var previousComparison = comparePartitionSizes(left.previous, right.previous);
    if (previousComparison) return previousComparison;
    if (left.size === right.size) return 0;
    return left.size > right.size ? -1 : 1;
  }

  function candidateHasPreferredSizes(previous, size, existing) {
    var previousComparison = comparePartitionSizes(previous, existing.previous);
    if (previousComparison) return previousComparison < 0;
    return size > existing.size;
  }

  function compareCompletedPartitions(left, right, totalSize) {
    if (left.groupCount !== right.groupCount) return left.groupCount < right.groupCount ? -1 : 1;
    var leftRange = left.maximum - left.minimum;
    var rightRange = right.maximum - right.minimum;
    if (leftRange !== rightRange) return leftRange < rightRange ? -1 : 1;
    var leftDeviation = left.groupCount * left.squaredSum - totalSize * totalSize;
    var rightDeviation = right.groupCount * right.squaredSum - totalSize * totalSize;
    if (leftDeviation !== rightDeviation) return leftDeviation < rightDeviation ? -1 : 1;
    return comparePartitionSizes(left, right);
  }

  function bestPartition(owners) {
    var states = Array.from({ length: owners.length + 1 }, function() { return new Map(); });
    states[0].set(0, {
      previous: null,
      start: 0,
      end: 0,
      size: 0,
      groupCount: 0,
      minimum: 5,
      maximum: 0,
      squaredSum: 0,
    });
    for (var start = 0; start < owners.length; start += 1) {
      states[start].forEach(function(state) {
        var size = 0;
        for (var end = start; end < owners.length; end += 1) {
          size += owners[end].bodyGraphemeCount;
          if (size > MAX_BODY_SIZE) break;
          var groupCount = state.groupCount + 1;
          var minimum = Math.min(state.minimum, size);
          var maximum = Math.max(state.maximum, size);
          var squaredSum = state.squaredSum + size * size;
          var key = (groupCount * 6 + minimum) * 5 + maximum;
          var existing = states[end + 1].get(key);
          if (!existing || squaredSum < existing.squaredSum || (
            squaredSum === existing.squaredSum
              && candidateHasPreferredSizes(state, size, existing)
          )) {
            states[end + 1].set(key, {
              previous: state,
              start: start,
              end: end + 1,
              size: size,
              groupCount: groupCount,
              minimum: minimum,
              maximum: maximum,
              squaredSum: squaredSum,
            });
          }
        }
      });
    }
    var best = null;
    var totalSize = owners.reduce(function(sum, owner) {
      return sum + owner.bodyGraphemeCount;
    }, 0);
    states[owners.length].forEach(function(candidate) {
      if (!best || compareCompletedPartitions(candidate, best, totalSize) < 0) {
        best = candidate;
      }
    });
    var ranges = [];
    while (best && best.previous) {
      ranges.push([best.start, best.end]);
      best = best.previous;
    }
    ranges.reverse();
    return ranges.map(function(range) {
      return mergeOwners(owners.slice(range[0], range[1]));
    });
  }

  function canJoin(left, right) {
    if (!left || !right || left.isVisualSlice || right.isVisualSlice) return false;
    if (!left.isCjk || !right.isCjk || left.hardAfter || right.hardBefore) return false;
    if (left.bodyGraphemeCount + right.bodyGraphemeCount > MAX_BODY_SIZE) return false;
    return right.startTime - left.endTime <= MAX_JOIN_GAP;
  }

  function partitionOrdinaryRuns(owners) {
    var result = [];
    var run = [];
    function flush() {
      if (run.length) Array.prototype.push.apply(result, bestPartition(run));
      run = [];
    }
    owners.forEach(function(owner) {
      var previous = run[run.length - 1];
      var eligible = owner.isCjk && !owner.isSemantic && !owner.isVisualSlice && owner.bodyGraphemeCount > 0;
      if (!eligible || (previous && !canJoin(previous, owner))) flush();
      if (eligible) run.push(owner);
      else result.push(owner);
    });
    flush();
    return result;
  }

  function mergeOneBodyCjk(owners) {
    var result = [];
    for (var index = 0; index < owners.length; index += 1) {
      var current = owners[index];
      if (current.bodyGraphemeCount === 1 && current.isCjk && !current.isVisualSlice) {
        var next = owners[index + 1];
        if (canJoin(current, next)) {
          result.push(mergeOwners([current, next]));
          index += 1;
          continue;
        }
        var previous = result[result.length - 1];
        if (index === owners.length - 1 && canJoin(previous, current)) {
          result[result.length - 1] = mergeOwners([previous, current]);
          continue;
        }
      }
      result.push(current);
    }
    return result;
  }

  function attachZeroBodyOwners(owners) {
    var result = [];
    owners.forEach(function(owner) {
      var previous = result[result.length - 1];
      if (owner.bodyGraphemeCount === 0 && previous) {
        var attached = mergeOwners([previous, owner]);
        attached.isSticky = true;
        result[result.length - 1] = attached;
      } else {
        result.push(owner);
      }
    });
    return result;
  }

  function unitOwners(unit, lineWords) {
    var words = Array.isArray(unit.words) ? unit.words : [];
    var wordOwners = [];
    words.forEach(function(word) {
      var wordIndex = lineWords.indexOf(word);
      var owner = wordOwner(word, wordIndex, { isSticky: unit.isSticky });
      if (owner.isCjk && owner.bodyGraphemeCount > MAX_BODY_SIZE) {
        Array.prototype.push.apply(wordOwners, visualSliceOwners(word, wordIndex, { isSticky: unit.isSticky }));
      } else {
        wordOwners.push(owner);
      }
    });
    wordOwners = attachZeroBodyOwners(wordOwners);
    if (!wordOwners.length) {
      return [ownerFromParts(String(unit.text || ''), [], [], {
        isSticky: unit.isSticky,
        isSemantic: unit.isSemantic,
      })];
    }
    if (!hasCjk(unit.text) && unit.isSticky) {
      var parserOwner = mergeOwners(wordOwners);
      parserOwner.isSticky = Boolean(unit.isSticky || parserOwner.isSticky);
      return [parserOwner];
    }
    if (unit.isSemantic && wordOwners.every(function(owner) { return !owner.isVisualSlice; })) {
      var semanticOwners = [];
      var semanticRun = [];
      function flushSemanticRun() {
        if (!semanticRun.length) return;
        var bodyCount = semanticRun.reduce(function(sum, owner) {
          return sum + owner.bodyGraphemeCount;
        }, 0);
        var planned = bodyCount <= MAX_BODY_SIZE
          ? [mergeOwners(semanticRun)]
          : bestPartition(semanticRun);
        planned.forEach(function(owner) {
          owner.isSemantic = true;
          owner.isSticky = Boolean(unit.isSticky || owner.isSticky);
          semanticOwners.push(owner);
        });
        semanticRun = [];
      }
      wordOwners.forEach(function(owner) {
        var previous = semanticRun[semanticRun.length - 1];
        if (previous && !canJoin(previous, owner)) flushSemanticRun();
        semanticRun.push(owner);
      });
      flushSemanticRun();
      return semanticOwners;
    }
    return wordOwners;
  }

  function freezeGroup(owner, lineIndex, groupIndex) {
    var words = Object.freeze(owner.words.slice());
    var graphemes = Object.freeze(owner.graphemes.map(function(item) {
      var timing = {
        char: item.char,
        startTime: item.startTime,
        endTime: item.endTime,
      };
      if (typeof item.wordIndex === 'number' && item.wordIndex >= 0) timing.wordIndex = item.wordIndex;
      return Object.freeze(timing);
    }));
    return Object.freeze({
      key: 'classic-three:' + finite(lineIndex, 0) + ':' + groupIndex,
      text: owner.text,
      words: words,
      graphemes: graphemes,
      startTime: owner.startTime,
      endTime: owner.endTime,
      bodyGraphemeCount: owner.bodyGraphemeCount,
      isCjk: owner.isCjk,
      isSticky: owner.isSticky,
      isVisualSlice: owner.isVisualSlice,
    });
  }

  function buildClassicThreeGroups(line, options) {
    var requiredLayoutApis = ['buildPostLyricLayoutUnits', 'buildWordGraphemeTimings'];
    var missingLayoutApis = requiredLayoutApis.filter(function(name) {
      return typeof layout[name] !== 'function';
    });
    if (missingLayoutApis.length) {
      throw new Error(
        'MineradioNativeLyricClassicThreeGroups requires MineradioNativeLyricLayout APIs: '
          + missingLayoutApis.join(', ')
      );
    }
    line = line || { index: 0, fullText: '', words: [] };
    options = options || {};
    var lineWords = Array.isArray(line.words) ? line.words : [];
    var units = layout.buildPostLyricLayoutUnits(line, {
      semantic: true,
      sticky: true,
      segmentWords: options.segmentWords,
    });
    var owners = units.reduce(function(result, unit) {
      return result.concat(unitOwners(unit, lineWords));
    }, []);
    owners = attachZeroBodyOwners(owners);
    owners = partitionOrdinaryRuns(owners);
    owners = mergeOneBodyCjk(owners);
    return Object.freeze(owners.map(function(owner, index) {
      return freezeGroup(owner, line.index, index);
    }));
  }

  return {
    buildClassicThreeGroups: buildClassicThreeGroups,
    balancedSliceSizes: balancedSliceSizes,
  };
});
