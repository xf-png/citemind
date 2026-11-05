import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('Build fingerprints change with runtime bytes, reject stale output, and preserve vendor bytes', async () => {
  const base = await realpath(tmpdir()); const fixture = await mkdtemp(join(base, 'citemind-build-test-'));
  const run = (...args) => promisify(execFile)(process.execPath, [join(fixture, 'tools/build-offline.mjs'), ...args], { cwd: fixture });
  const vendor = Buffer.from([0, 255, 13, 10, 17]);
  async function revision() {
    const html = await readFile(join(fixture, 'dist/index.html'), 'utf8');
    const map = JSON.parse(html.match(/id="app-imports">([^<]+)/)[1]);
    const urls = Object.values(map.imports).map(path => new URL(path, 'https://example.test/app/'));
    assert.ok(urls.every(url => url.searchParams.get('v') === '9.9.9'));
    const revisions = new Set(urls.map(url => url.searchParams.get('r'))); assert.equal(revisions.size, 1);
    return [...revisions][0];
  }
  try {
    await mkdir(join(fixture, 'tools')); await mkdir(join(fixture, 'dist/vendor'), { recursive: true });
    await Promise.all([
      copyFile(new URL('../tools/build-offline.mjs', import.meta.url), join(fixture, 'tools/build-offline.mjs')),
      copyFile(new URL('../tools/offline-worker.template.js', import.meta.url), join(fixture, 'tools/offline-worker.template.js')),
      writeFile(join(fixture, 'package.json'), JSON.stringify({ version: '9.9.9' })),
      writeFile(join(fixture, 'dist/index.html'), '<link rel="stylesheet" href="./styles.css">\r\n<script type="module" src="./app.js"></script>\r\n'),
      writeFile(join(fixture, 'dist/app.js'), "import './engine.js';\r\n"), writeFile(join(fixture, 'dist/engine.js'), 'export const value = 1;\r\n'),
      writeFile(join(fixture, 'dist/styles.css'), 'body { color: blue; }\r\n'), writeFile(join(fixture, 'dist/vendor/bytes.bin'), vendor),
    ]);
    await run(); const first = await revision(); const generated = await readFile(join(fixture, 'dist/sw.js'));
    await run('--check'); await run(); assert.deepEqual(await readFile(join(fixture, 'dist/sw.js')), generated);
    await writeFile(join(fixture, 'dist/engine.js'), 'export const value = 2;\n');
    await assert.rejects(run('--check'), /Browser asset versions are stale/); await run(); const second = await revision(); assert.notEqual(first, second);
    await writeFile(join(fixture, 'dist/styles.css'), 'body { color: red; }\n'); await run(); assert.notEqual(await revision(), second);
    await run('--check'); assert.deepEqual(await readFile(join(fixture, 'dist/vendor/bytes.bin')), vendor);
  } finally {
    const target = await realpath(fixture);
    if (dirname(target) !== base || !basename(target).startsWith('citemind-build-test-')) throw new Error('Unexpected fixture cleanup path');
    await rm(target, { recursive: true, force: true });
  }
});
