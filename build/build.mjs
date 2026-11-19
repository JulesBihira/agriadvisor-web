// Prepares agriadvisor.co before it goes online, so phones open it fast.
//
// index.html keeps the app's readable code (and still works if opened directly).
// This script, run by GitHub on every push (.github/workflows/deploy.yml):
//   - turns the app's code into one small, ready-to-run file: /app.<id>.js
//     (React's fast "production" version + the app, compressed)
//   - removes the in-browser tools (Babel, React's slow "development" version)
//     that every phone had to download and run on every visit
//   - copies everything else (icons, privacy page, .well-known for the Android app) as it is
// Output folder: _site/  - GitHub publishes that folder.
// If anything here fails, nothing is published and the site stays as it was.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '_site');
const SKIP = new Set(['.git', '.github', 'node_modules', '_site', 'build', 'package.json',
  'package-lock.json', '.gitignore', '.netlify', '_config.yml']);
// Newer code features (?. ?? {...spread}) are rewritten so older Android phones and iPhones still run the app
const TARGET = ['es2017'];

function fail(msg) {
  console.error('\nBUILD FAILED: ' + msg + '\nNothing was published - the site stays as it was.\n');
  process.exit(1);
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, {recursive: true});
  for (const name of fs.readdirSync(src)) {
    if (src === ROOT && SKIP.has(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

let vendorCode = null;
async function vendor() {
  if (vendorCode) return vendorCode;
  const result = await esbuild.build({
    stdin: {
      contents: "import React from 'react';\nimport * as ReactDOMClient from 'react-dom/client';\n" +
                "window.React = React;\nwindow.ReactDOM = ReactDOMClient;\n",
      resolveDir: ROOT,
      loader: 'js',
    },
    bundle: true,
    minify: true,
    format: 'iife',
    target: TARGET,
    write: false,
    legalComments: 'eof',
    define: {'process.env.NODE_ENV': '"production"'},
    logLevel: 'silent',
  });
  vendorCode = result.outputFiles[0].text;
  return vendorCode;
}

const kb = (n) => (n / 1024).toFixed(0) + ' KB';

async function buildPage(file) {
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const open = '<script type="text/babel">';
  const a = html.indexOf(open);
  if (a < 0) return false;                                    // plain page: copied as it is
  if (html.indexOf(open, a + 1) >= 0) fail(file + ' has more than one text/babel script.');
  const b = html.indexOf('</script>', a);
  if (b < 0) fail(file + ': the text/babel script is not closed.');
  const jsx = html.slice(a + open.length, b);

  let app;
  try {
    app = (await esbuild.transform(jsx, {loader: 'jsx', minify: true, target: TARGET, legalComments: 'eof'})).code;
  } catch (e) {
    fail(file + ': the app code has an error:\n' + e.message);
  }
  const code = (await vendor()) + '\n' + app;
  const id = crypto.createHash('sha256').update(code).digest('hex').slice(0, 10);
  const name = 'app.' + id + '.js';
  fs.writeFileSync(path.join(OUT, name), code);

  // The raw app code and the in-browser tools are no longer needed
  html = html.slice(0, a) + html.slice(b + '</script>'.length);
  html = html.replace(/[ \t]*<script src="https:\/\/unpkg\.com\/(?:react|react-dom|@babel\/standalone)(?:@[^/"]*)?\/[^"]*"><\/script>[ \t]*\r?\n?/g, '');
  if (/unpkg\.com\/(react|react-dom|@babel)/.test(html)) fail(file + ': could not remove the React/Babel script tags.');
  if (!html.includes('</head>')) fail(file + ': no </head> found.');
  html = html.replace('</head>', '<script defer src="/' + name + '"></script>\n</head>');
  fs.writeFileSync(path.join(OUT, file), html);

  console.log(file + ': app code ' + kb(jsx.length) + ' -> ' + name + ' ' + kb(code.length) +
              ' (React included); page ' + kb(html.length));
  return true;
}

fs.rmSync(OUT, {recursive: true, force: true});
copyTree(ROOT, OUT);
let built = 0;
for (const file of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  if (await buildPage(file)) built++;
}
if (!built) fail('no page with a text/babel script was found (expected index.html).');
if (!fs.existsSync(path.join(OUT, '.well-known', 'assetlinks.json'))) {
  console.warn('Warning: .well-known/assetlinks.json is missing - the Android app needs it.');
}
console.log('Ready to publish: _site/');
