import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

/** Isolated, loopback-only static origin for failure and update scenarios. */
export async function serveDist(transform = (path, bytes) => bytes, { cacheControl = () => 'no-store' } = {}) {
  const root = fileURLToPath(new URL('../../../dist/', import.meta.url));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost'); const path = decodeURIComponent(url.pathname);
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
      const bytes = await transform(path, await readFile(file), url);
      if (bytes === null) { response.writeHead(503).end(); return; }
      const mime = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cacheControl(path, url) }); response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
