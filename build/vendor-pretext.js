'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const foliaNodeModules = path.join(repoRoot, 'third_party', 'folia-major', 'node_modules');
const pretextRoot = path.join(foliaNodeModules, '@chenglou', 'pretext');
const pretextPackage = JSON.parse(fs.readFileSync(path.join(pretextRoot, 'package.json'), 'utf8'));
const esbuild = require(path.join(foliaNodeModules, 'esbuild'));
const outputDir = path.join(repoRoot, 'public', 'vendor');
const bundlePath = path.join(outputDir, 'pretext-0.0.7.iife.min.js');
const licensePath = path.join(outputDir, 'pretext-0.0.7.LICENSE');

if (pretextPackage.version !== '0.0.7') {
  throw new Error(`Expected @chenglou/pretext 0.0.7, found ${pretextPackage.version}`);
}

fs.mkdirSync(outputDir, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'pretext-entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'MineradioPretext',
  target: ['es2019'],
  outfile: bundlePath,
  legalComments: 'none',
  banner: { js: '/*! @chenglou/pretext 0.0.7 | MIT | https://github.com/chenglou/pretext */' },
});
fs.copyFileSync(path.join(pretextRoot, 'LICENSE'), licensePath);

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

process.stdout.write(JSON.stringify({
  bundle: { file: path.relative(repoRoot, bundlePath), sha256: digest(bundlePath) },
  license: { file: path.relative(repoRoot, licensePath), sha256: digest(licensePath) },
}, null, 2) + '\n');
