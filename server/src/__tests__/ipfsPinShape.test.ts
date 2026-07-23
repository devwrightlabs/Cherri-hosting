/**
 * Tests for the Pinata pin-request shape (fix for 400 "More than one file
 * and/or directory was provided for pinning").
 *
 * Invariant: a directory pin must send every file under ONE shared root
 * directory via form-data's `filepath` option — never a loose list of
 * root-level filenames.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePinRootName,
  normalizeBundlePath,
  buildDirectoryEntries,
} from '../services/ipfs';

const file = (path: string) => ({
  buffer: Buffer.from('x'),
  path,
  mimeType: 'text/plain',
});

test('all entries share exactly one root directory segment', () => {
  const entries = buildDirectoryEntries(
    [file('index.html'), file('404.html'), file('assets/app.js')],
    'My Site',
  );
  const roots = new Set(entries.map((e) => e.filepath.split('/')[0]));
  assert.equal(roots.size, 1, 'must be a single directory upload');
  assert.deepEqual(
    entries.map((e) => e.filepath),
    ['My-Site/index.html', 'My-Site/404.html', 'My-Site/assets/app.js'],
  );
});

test('a one-file bundle is still a single-directory upload (the real 400 case)', () => {
  const entries = buildDirectoryEntries([file('index.html')], 'tiny');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].filepath, 'tiny/index.html');
});

test('nested paths keep their structure under the root', () => {
  const entries = buildDirectoryEntries(
    [file('deep/nested/dir/page.html')],
    'proj',
  );
  assert.equal(entries[0].filepath, 'proj/deep/nested/dir/page.html');
});

test('root name is sanitized to one clean path segment', () => {
  assert.equal(sanitizePinRootName('My Cool Site!'), 'My-Cool-Site');
  assert.equal(sanitizePinRootName('a/b/c'), 'a-b-c');
  assert.equal(sanitizePinRootName('../../etc'), 'etc');
  assert.equal(sanitizePinRootName('   '), 'site');
  assert.equal(sanitizePinRootName(''), 'site');
  // Never contains a separator — must stay a single segment.
  assert.ok(!sanitizePinRootName('π sites/深い').includes('/'));
});

test('bundle paths are normalized (leading ./, /, backslashes, empty segments)', () => {
  assert.equal(normalizeBundlePath('./index.html'), 'index.html');
  assert.equal(normalizeBundlePath('/assets/app.js'), 'assets/app.js');
  assert.equal(normalizeBundlePath('a\\b\\c.txt'), 'a/b/c.txt');
  assert.equal(normalizeBundlePath('a//b///c'), 'a/b/c');
});

test('two inputs collapsing to the same path fail honestly instead of silently dropping a file', () => {
  assert.throws(
    () => buildDirectoryEntries([file('./index.html'), file('index.html')], 'proj'),
    /resolve to the same path/,
  );
});

test('traversal and empty paths are rejected, never sent to Pinata', () => {
  assert.equal(normalizeBundlePath('../secret'), null);
  assert.equal(normalizeBundlePath('a/../../b'), null);
  assert.equal(normalizeBundlePath(''), null);
  assert.equal(normalizeBundlePath('./'), null);
  assert.throws(
    () => buildDirectoryEntries([file('../escape.html')], 'proj'),
    /can't be published safely/,
  );
});
