import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const paths = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const name = relative(root, path).split(sep).join('/');
      if (name !== 'sw.js') paths.push(name);
    }
  }
}
await walk(root);
const assets = [];
for (const path of paths.sort()) {
  // Canonical LF for first-party text, consistent with Git's checked-in bytes.
  // Third-party resources remain byte-identical to their integrity manifests.
  let bytes = await readFile(join(root, path));
  const firstParty = !/^(vendor|models|licenses)\//.test(path) && /\.(?:js|css|html|svg|json|md|webmanifest)$/.test(path);
  if (firstParty) {
    const normalized = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
    if (!normalized.equals(bytes)) {
      if (process.argv.includes('--check')) throw new Error(`Expected LF line endings: ${path}`);
      await writeFile(join(root, path), normalized);
    }
    bytes = normalized;
  }
  assets.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const revision = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 16);
const manifest = { version, revision, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), assets };
const template = (await readFile(new URL('./offline-worker.template.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const output = template.replace('__CITEMIND_OFFLINE_PACKAGE__', JSON.stringify(manifest));
const destination = join(root, 'sw.js');
if (process.argv.includes('--check')) {
  const actual = (await readFile(destination, 'utf8')).replace(/\r\n/g, '\n');
  if (actual !== output) throw new Error('Offline package is stale. Run npm run build:offline and commit dist/sw.js.');
} else await writeFile(destination, output);
console.log(JSON.stringify({ version, revision, resources: assets.length, bytes: manifest.bytes, checked: process.argv.includes('--check') }));
