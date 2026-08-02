(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MineradioPaletteHelpers = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function clampRange(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = 0;
    return Math.max(min, Math.min(max, value));
  }

  function normalizeHexColor(value, fallback) {
    var hex = String(value || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(hex)) {
      hex = '#' + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2) + hex.charAt(3) + hex.charAt(3);
    }
    fallback = /^#[0-9a-f]{6}$/i.test(String(fallback || '')) ? String(fallback).toLowerCase() : '#a9b8c8';
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : fallback;
  }

  function rgbToHexColor(r, g, b) {
    function part(value) {
      return Math.max(0, Math.min(255, Math.round(value || 0))).toString(16).padStart(2, '0');
    }
    return '#' + part(r) + part(g) + part(b);
  }

  function hexToRgb(hex) {
    hex = normalizeHexColor(hex).slice(1);
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h, s: s, l: l };
  }

  function hslToRgb(h, s, l) {
    function hueToRgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var r;
    var g;
    var b;
    if (s === 0) {
      r = g = b = l;
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  function rgbCss(color, alpha) {
    if (alpha == null) return 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
    return 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',' + alpha + ')';
  }

  function lyricPaletteFromHex(hex) {
    var color = hexToRgb(hex);
    var hsl = rgbToHsl(color.r, color.g, color.b);
    var neutral = hsl.s < 0.035;
    var s = neutral ? 0 : clampRange(hsl.s * 1.08, 0.14, 0.92);
    var l = hsl.l;
    if (l < 0.11) l = 0.15 + l * 1.18;
    else if (l < 0.28) l = 0.21 + (l - 0.11) * 1.18;
    else l = clampRange(l, 0.30, 0.82);
    l = clampRange(l, 0.14, 0.84);
    var primary = hslToRgb(hsl.h, s, l);
    var secondary = hslToRgb(
      (hsl.h + 0.055) % 1,
      neutral ? 0 : clampRange(s * 0.88, 0.12, 0.78),
      clampRange(l + (l < 0.38 ? 0.10 : -0.08), 0.18, 0.76),
    );
    var highlight = hslToRgb(
      (hsl.h + 0.018) % 1,
      neutral ? 0 : clampRange(s * 0.72, 0.10, 0.70),
      clampRange(l + 0.22, 0.38, 0.92),
    );
    var darkText = l < 0.40;
    return {
      primary: rgbCss(primary),
      secondary: rgbCss(secondary),
      highlight: rgbCss(highlight),
      shadow: darkText ? 'rgba(0,6,10,0.46)' : 'rgba(248,253,255,0.34)',
      glow: rgbCss(primary, 0.26),
    };
  }

  function silverBlueLyricPalette() {
    return {
      primary: '#d8f1ff',
      secondary: '#9db8cf',
      highlight: '#eef7ff',
      shadow: 'rgba(0,7,12,0.48)',
      glow: 'rgba(138,190,255,0.26)',
    };
  }

  function lyricTextPaletteFromHsl(hsl, avgL, chroma) {
    hsl = hsl || { h: 0, s: 0, l: 0 };
    avgL = Number(avgL) || 0;
    chroma = Number(chroma) || 0;
    if (avgL < 0.16 || chroma < 0.08) return silverBlueLyricPalette();
    var hue = hsl.h;
    if (avgL < 0.30 && (hue < 0.06 || hue > 0.86 || (hue > 0.75 && hue < 0.86))) return silverBlueLyricPalette();
    if (avgL > 0.82 && chroma < 0.12) {
      return {
        primary: '#064b5b',
        secondary: '#168c88',
        highlight: '#315f68',
        shadow: 'rgba(255,255,255,0.48)',
        glow: 'rgba(143,233,255,0.14)',
      };
    }
    var lightText = avgL < 0.52;
    var s = Math.max(0.42, Math.min(0.78, hsl.s + 0.16));
    var c1 = hslToRgb(hsl.h, s, lightText ? 0.74 : 0.34);
    var c2 = hslToRgb((hsl.h + 0.08) % 1, Math.max(0.36, s - 0.10), lightText ? 0.62 : 0.46);
    return {
      primary: rgbCss(c1),
      secondary: rgbCss(c2),
      highlight: rgbCss(hslToRgb((hsl.h + 0.03) % 1, Math.max(0.28, s - 0.18), lightText ? 0.86 : 0.58)),
      shadow: lightText ? 'rgba(0,6,10,0.44)' : 'rgba(248,253,255,0.40)',
      glow: rgbCss(c1, lightText ? 0.24 : 0.14),
    };
  }

  function effectiveLyricPalette(input) {
    input = input || {};
    var fx = input.fx || {};
    var src = input.palette || input.coverPalette || input.stagePalette || {};
    var out = {
      primary: src.primary || '#d6f8ff',
      secondary: src.secondary || '#9cffdf',
      highlight: src.highlight || '#eef7ff',
      shadow: src.shadow || 'rgba(2,8,12,0.42)',
      glow: src.glow || 'rgba(143,233,255,0.34)',
    };
    if (fx.lyricHighlightMode === 'custom') {
      var hi = lyricPaletteFromHex(fx.lyricHighlightColor);
      out.highlight = hi.primary;
      if (fx.lyricGlowLinked !== false) {
        out.glowColor = hi.secondary || hi.primary;
        out.glow = hi.glow || out.glow;
      }
    }
    if (fx.lyricGlowLinked === false) {
      var glowPal = lyricPaletteFromHex(fx.lyricGlowColor || '#9db8cf');
      out.glowColor = glowPal.primary;
      out.glow = glowPal.glow || out.glow;
    }
    if (!out.glowColor) out.glowColor = out.secondary;
    return out;
  }

  function lyricPaletteFromImageData(imageData, width, height) {
    if (!imageData || !width || !height) return null;
    var sumR = 0;
    var sumG = 0;
    var sumB = 0;
    var count = 0;
    var best = { score: -1, r: 143, g: 233, b: 255 };
    for (var y = 0; y < height; y += 8) {
      for (var x = 0; x < width; x += 8) {
        var di = (y * width + x) * 4;
        var r = imageData[di];
        var g = imageData[di + 1];
        var b = imageData[di + 2];
        var a = imageData[di + 3] / 255;
        if (a < 0.5) continue;
        var lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        var maxC = Math.max(r, g, b);
        var minC = Math.min(r, g, b);
        var chroma = (maxC - minC) / 255;
        var edgePenalty = Math.abs(lum - 0.5);
        var score = chroma * 1.6 + (0.5 - edgePenalty) * 0.45;
        sumR += r; sumG += g; sumB += b; count += 1;
        if (lum > 0.08 && lum < 0.92 && score > best.score) best = { score: score, r: r, g: g, b: b };
      }
    }
    if (!count) return null;
    var avgL = (sumR / count * 0.299 + sumG / count * 0.587 + sumB / count * 0.114) / 255;
    return lyricTextPaletteFromHsl(rgbToHsl(best.r, best.g, best.b), avgL, Math.max(0, best.score));
  }

  function coverPickerSwatchColors(input) {
    input = input || {};
    var pal = input.coverPalette || input.palette || {};
    var fx = input.fx || {};
    var list = [pal.primary, pal.secondary, pal.highlight, fx.visualTintColor, fx.uiAccentColor, fx.homeAccentColor]
      .map(function(color) { return normalizeHexColor(color || '', ''); })
      .filter(function(color) { return /^#[0-9a-f]{6}$/i.test(color); });
    var seen = {};
    return list.filter(function(color) {
      if (seen[color]) return false;
      seen[color] = true;
      return true;
    }).slice(0, 5);
  }

  function desktopOverlayColorValue(value, fallback) {
    var raw = String(value || '').trim();
    fallback = String(fallback || '#d6f8ff').trim();
    if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) return normalizeHexColor(raw, fallback);
    if (/^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw;
    return normalizeHexColor(raw, fallback);
  }

  function desktopOverlayColors(input) {
    input = input || {};
    var pal = input.palette || {};
    var fx = input.fx || {};
    return {
      primary: desktopOverlayColorValue(pal.primary || fx.lyricColor || '#d6f8ff', '#d6f8ff'),
      secondary: desktopOverlayColorValue(pal.secondary || fx.visualTintColor || '#9cffdf', '#9cffdf'),
      highlight: desktopOverlayColorValue(pal.highlight || fx.lyricHighlightColor || '#fff0b8', '#fff0b8'),
      glow: desktopOverlayColorValue(pal.glowColor || pal.secondary || pal.primary || fx.lyricGlowColor || '#9cffdf', '#9cffdf'),
    };
  }

  return {
    clampRange: clampRange,
    normalizeHexColor: normalizeHexColor,
    rgbToHexColor: rgbToHexColor,
    hexToRgb: hexToRgb,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    rgbCss: rgbCss,
    lyricPaletteFromHex: lyricPaletteFromHex,
    silverBlueLyricPalette: silverBlueLyricPalette,
    lyricTextPaletteFromHsl: lyricTextPaletteFromHsl,
    effectiveLyricPalette: effectiveLyricPalette,
    lyricPaletteFromImageData: lyricPaletteFromImageData,
    coverPickerSwatchColors: coverPickerSwatchColors,
    desktopOverlayColorValue: desktopOverlayColorValue,
    desktopOverlayColors: desktopOverlayColors,
  };
});
