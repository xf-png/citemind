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
// Keep Node imports canonical while the browser loads a complete release's
// module graph through versioned URLs, including dynamic imports and workers.
const modules = paths.filter(path => !path.includes('/') && path.endsWith('.js')).sort();
const runtimePaths = paths.filter(path => !path.includes('/') && /\.(?:js|css)$/.test(path)).sort();
const runtimeHashes = [];
for (const path of runtimePaths) {
  const bytes = (await readFile(join(root, path), 'utf8')).replace(/\r\n/g, '\n');
  runtimeHashes.push([path, createHash('sha256').update(bytes).digest('hex')]);
}
const runtimeRevision = createHash('sha256').update(JSON.stringify(runtimeHashes)).digest('hex').slice(0, 12);
const query = `v=${version}&r=${runtimeRevision}`;
const htmlQuery = query.replace(/&/g, '&amp;');
const imports = Object.fromEntries(modules.map(path => [`./${path}`, `./${path}?${query}`]));
const importMap = `<script type="importmap" id="app-imports">${JSON.stringify({ imports })}</script>`;
const indexPath = join(root, 'index.html');
const originalHTML = await readFile(indexPath, 'utf8');
let html = originalHTML.replace(/\r\n/g, '\n')
  .replace(/href="(\.\/[^"/]+\.css)(?:\?[^" ]*)?"/g, `href="$1?${htmlQuery}"`)
  .replace(/src="\.\/app\.js(?:\?[^" ]*)?"/g, `src="./app.js?${htmlQuery}"`);
if (html.includes('id="app-imports"')) html = html.replace(/<script type="importmap" id="app-imports">[\s\S]*?<\/script>/, importMap);
else html = html.replace('<script type="module"', `${importMap}\n<script type="module"`);
if (html !== originalHTML) {
  if (process.argv.includes('--check')) throw new Error('Browser asset versions are stale. Run npm run build:offline.');
  await writeFile(indexPath, html);
}
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
