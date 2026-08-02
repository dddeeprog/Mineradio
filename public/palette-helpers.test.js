const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const palette = require('./palette-helpers');

function extractFunctionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const bodyStart = source.indexOf('{', start);
  assert.notEqual(bodyStart, -1);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`Function ${name} was not closed`);
}

test('exports the shared palette helper surface', () => {
  [
    'normalizeHexColor',
    'rgbToHexColor',
    'lyricPaletteFromHex',
    'effectiveLyricPalette',
    'lyricPaletteFromImageData',
    'coverPickerSwatchColors',
    'desktopOverlayColors',
  ].forEach((name) => assert.equal(typeof palette[name], 'function'));
});

test('normalizeHexColor expands shorthand colors and applies a valid fallback', () => {
  assert.equal(palette.normalizeHexColor('#abc'), '#aabbcc');
  assert.equal(palette.normalizeHexColor(' #A1B2C3 '), '#a1b2c3');
  assert.equal(palette.normalizeHexColor('bad', '#123456'), '#123456');
  assert.equal(palette.normalizeHexColor('bad', 'also bad'), '#a9b8c8');
});

test('rgbToHexColor rounds and clamps RGB channel values', () => {
  assert.equal(palette.rgbToHexColor(0, 245.4, 212.6), '#00f5d5');
  assert.equal(palette.rgbToHexColor(-20, 300, 16), '#00ff10');
});

test('lyricPaletteFromHex returns readable lyric colors and glow', () => {
  assert.deepEqual(Object.keys(palette.lyricPaletteFromHex('#00f5d4')).sort(), [
    'glow',
    'highlight',
    'primary',
    'secondary',
    'shadow',
  ]);
  assert.match(palette.lyricPaletteFromHex('#00f5d4').primary, /^rgb\(/);
  assert.match(palette.lyricPaletteFromHex('#00f5d4').glow, /^rgba\(/);
});

test('effectiveLyricPalette applies custom highlight and unlinked glow overrides', () => {
  const result = palette.effectiveLyricPalette({
    palette: palette.lyricPaletteFromHex('#00f5d4'),
    fx: {
      lyricHighlightMode: 'custom',
      lyricHighlightColor: '#ffee99',
      lyricGlowLinked: false,
      lyricGlowColor: '#3366ff',
    },
  });

  assert.equal(result.highlight, palette.lyricPaletteFromHex('#ffee99').primary);
  assert.equal(result.glowColor, palette.lyricPaletteFromHex('#3366ff').primary);
});

test('lyricPaletteFromImageData falls back for dark low-chroma covers', () => {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 8;
    data[i + 1] = 8;
    data[i + 2] = 8;
    data[i + 3] = 255;
  }

  assert.deepEqual(
    palette.lyricPaletteFromImageData(data, 16, 16),
    palette.silverBlueLyricPalette(),
  );
});

test('coverPickerSwatchColors normalizes, deduplicates, and limits palette swatches', () => {
  assert.deepEqual(
    palette.coverPickerSwatchColors({
      coverPalette: {
        primary: '#abc',
        secondary: '#112233',
        highlight: '#223344',
      },
      fx: {
        visualTintColor: '#334455',
        uiAccentColor: '#445566',
        homeAccentColor: '#556677',
      },
    }),
    ['#aabbcc', '#112233', '#223344', '#334455', '#445566'],
  );
});

test('desktopOverlayColors preserves CSS color functions and falls back through fx', () => {
  assert.deepEqual(
    palette.desktopOverlayColors({
      palette: { primary: 'rgba(1,2,3,.4)' },
      fx: {
        lyricColor: '#111111',
        visualTintColor: '#222222',
        lyricHighlightColor: '#333333',
        lyricGlowColor: '#444444',
      },
    }),
    {
      primary: 'rgba(1,2,3,.4)',
      secondary: '#222222',
      highlight: '#333333',
      glow: 'rgba(1,2,3,.4)',
    },
  );
});

test('index loads palette helpers before the first inline script and delegates wrappers', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const scriptIndex = html.indexOf('<script src="palette-helpers.js"></script>');
  const inlineIndex = html.search(/<script>\s*try\s*\{/);

  assert.notEqual(scriptIndex, -1);
  assert.notEqual(inlineIndex, -1);
  assert.ok(scriptIndex < inlineIndex);
  assert.match(html, /var paletteHelpers = window\.MineradioPaletteHelpers \|\| \{\};/);

  [
    ['normalizeHexColor', 'normalizeHexColor'],
    ['rgbToHexColor', 'rgbToHexColor'],
    ['hexToRgb', 'hexToRgb'],
    ['lyricPaletteFromHex', 'lyricPaletteFromHex'],
    ['effectiveLyricPalette', 'effectiveLyricPalette'],
    ['coverPickerSwatchColors', 'coverPickerSwatchColors'],
    ['desktopOverlayColors', 'desktopOverlayColors'],
  ].forEach(([wrapper, helper]) => {
    assert.match(extractFunctionBlock(html, wrapper), new RegExp(`paletteHelpers\\.${helper}`));
  });
  assert.match(extractFunctionBlock(html, 'updateLyricPaletteFromCover'), /paletteHelpers\.lyricPaletteFromImageData/);
});
