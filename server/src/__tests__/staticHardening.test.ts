/**
 * Unit tests for the universal white-screen fix (staticHardening.ts):
 * HTML/CSS/JS rewriting, <base> injection, 404 mirror, asset verification,
 * and the pure/idempotent invariants.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hardenStaticBundle,
  verifyReferencedAssets,
} from '../utils/staticHardening';
import { DeployFile } from '../utils/deployFiles';

function file(path: string, content: string, mimeType = 'application/octet-stream'): DeployFile {
  return { path, buffer: Buffer.from(content, 'utf8'), mimeType };
}

function text(files: DeployFile[], path: string): string {
  const f = files.find((x) => x.path === path);
  assert.ok(f, `expected ${path} in bundle`);
  return f!.buffer.toString('utf8');
}

test('HTML root-absolute asset refs become relative, <base> injected, 404 mirrored', () => {
  const out = hardenStaticBundle([
    file(
      'index.html',
      '<html><head><link rel="stylesheet" href="/assets/a.css"></head>' +
        '<body><script src="/assets/a.js"></script><a href="/about">About</a></body></html>',
      'text/html',
    ),
    file('assets/a.js', 'console.log(1)', 'text/javascript'),
    file('assets/a.css', 'body{}', 'text/css'),
  ]);
  const html = text(out, 'index.html');
  assert.match(html, /href="\.\/assets\/a\.css"/);
  assert.match(html, /src="\.\/assets\/a\.js"/);
  assert.match(html, /<a href="\/about">/); // navigation links untouched
  assert.match(html, /<base href="\.\/">/);
  assert.equal(text(out, '404.html'), html); // SPA fallback mirrors hardened index
});

test('JS literal rewrite: existence-gated, document-relative, import specifiers untouched', () => {
  const js = [
    'const logo = "/assets/logo.png";', // exists -> rewrite
    'fetch("/api/data");', // no such file -> untouched
    'import("/assets/chunk.js");', // import specifier -> untouched
    'const styles = \'/assets/app.css\';', // exists, single quotes -> rewrite
  ].join('\n');
  const out = hardenStaticBundle([
    file('index.html', '<html><head></head><body></body></html>', 'text/html'),
    file('assets/main.js', js, 'text/javascript'),
    file('assets/logo.png', 'PNG'),
    file('assets/chunk.js', '//chunk', 'text/javascript'),
    file('assets/app.css', 'body{}', 'text/css'),
  ]);
  const rewritten = text(out, 'assets/main.js');
  assert.match(rewritten, /const logo = "\.\/assets\/logo\.png";/);
  assert.match(rewritten, /fetch\("\/api\/data"\);/);
  assert.match(rewritten, /import\("\/assets\/chunk\.js"\);/);
  assert.match(rewritten, /const styles = '\.\/assets\/app\.css';/);
});

test('Vite preload base-join rewritten only in files with preload markers', () => {
  const withMarker =
    'const e="vite:preloadError";const assetsURL=function(t){return"/"+t};const f=t=>"/"+t;';
  const withoutMarker = 'const assetsURL=function(t){return"/"+t};';
  const out = hardenStaticBundle([
    file('index.html', '<html><head></head><body></body></html>', 'text/html'),
    file('assets/preload.js', withMarker, 'text/javascript'),
    file('assets/other.js', withoutMarker, 'text/javascript'),
  ]);
  assert.match(text(out, 'assets/preload.js'), /return"\.\/"\+t/);
  assert.match(text(out, 'assets/preload.js'), /=>"\.\/"\+t/);
  assert.equal(text(out, 'assets/other.js'), withoutMarker);
});

test('CSS url() rewritten relative to the stylesheet location', () => {
  const out = hardenStaticBundle([
    file('index.html', '<html><head></head><body></body></html>', 'text/html'),
    file('assets/a.css', '.x{background:url(/assets/bg.png)}', 'text/css'),
    file('assets/bg.png', 'PNG'),
  ]);
  assert.match(text(out, 'assets/a.css'), /url\(\.\.\/assets\/bg\.png\)/);
});

test('idempotent: hardening twice produces identical output', () => {
  const bundle = [
    file(
      'index.html',
      '<html><head><link rel="stylesheet" href="/assets/a.css"></head>' +
        '<body><script src="/assets/a.js"></script></body></html>',
      'text/html',
    ),
    file(
      'assets/a.js',
      'const e="vite:preloadError";const u=t=>"/"+t;const img="/assets/bg.png";',
      'text/javascript',
    ),
    file('assets/a.css', '.x{background:url(/assets/bg.png)}', 'text/css'),
    file('assets/bg.png', 'PNG'),
  ];
  const once = hardenStaticBundle(bundle);
  const twice = hardenStaticBundle(once);
  assert.equal(once.length, twice.length);
  for (let i = 0; i < once.length; i++) {
    assert.equal(twice[i].path, once[i].path);
    assert.ok(twice[i].buffer.equals(once[i].buffer), `${once[i].path} changed on re-harden`);
  }
});

test('pure: input files and buffers are not mutated', () => {
  const original = file(
    'index.html',
    '<html><head></head><body><script src="/a.js"></script></body></html>',
    'text/html',
  );
  const snapshot = Buffer.from(original.buffer);
  const input = [original, file('a.js', 'x()', 'text/javascript')];
  hardenStaticBundle(input);
  assert.ok(original.buffer.equals(snapshot));
});

test('verifyReferencedAssets flags missing render-critical assets', () => {
  const good = hardenStaticBundle([
    file(
      'index.html',
      '<html><head><link rel="stylesheet" href="/assets/a.css"></head>' +
        '<body><script src="/assets/a.js"></script></body></html>',
      'text/html',
    ),
    file('assets/a.js', 'x()', 'text/javascript'),
    file('assets/a.css', 'body{}', 'text/css'),
  ]);
  assert.deepEqual(verifyReferencedAssets(good), { ok: true, missing: [] });

  const bad = hardenStaticBundle([
    file(
      'index.html',
      '<html><head></head><body><script src="/assets/missing.js"></script></body></html>',
      'text/html',
    ),
  ]);
  const res = verifyReferencedAssets(bad);
  assert.equal(res.ok, false);
  assert.deepEqual(res.missing, ['./assets/missing.js']);
});
