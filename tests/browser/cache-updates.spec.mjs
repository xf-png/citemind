import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serveDist } from './helpers/serve-dist.mjs';

const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

test('A current release bypasses stale unversioned modules and styles in the browser cache', async ({ page }) => {
  const requests = []; const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const server = await serveDist((path, bytes, url) => {
    requests.push({ path, query: url.search });
    if (path === '/' && url.searchParams.has('prime')) return Buffer.from('<!doctype html><title>Cache primer</title><p>Preparing an older browser cache</p>');
    if (!url.search && path === '/research-ui.js') return Buffer.from('throw new Error("stale cached research module");');
    if (!url.search && path === '/styles.css') return Buffer.from('body { display: none !important; }');
    return bytes;
  }, { cacheControl: (path, url) => !url.search && ['/research-ui.js', '/styles.css'].includes(path) ? 'public, max-age=31536000' : 'no-store' });
  try {
    await page.goto(server.url + '?prime');
    const primed = await page.evaluate(async () => Promise.all(['./research-ui.js', './styles.css'].map(async url => (await fetch(url)).text())));
    expect(primed[0]).toContain('stale cached'); expect(primed[1]).toContain('display: none');
    const start = requests.length; await page.goto(server.url); await expect(page.locator('#question')).toBeVisible(); await expect(page.locator('#question')).toBeEnabled();
    await page.locator('#nav-research').click(); await page.locator('#tab-map').click(); await expect(page.locator('#map-panel')).toBeVisible();
    const modules = requests.slice(start).filter(row => /^\/[^/]+\.(js|css)$/.test(row.path));
    expect(modules.some(row => row.path === '/evidence-map-ui.js')).toBe(true); expect(modules.some(row => row.path === '/styles.css')).toBe(true);
    expect(modules.every(row => new URLSearchParams(row.query).get('v') === version)).toBe(true);
    const revisions = new Set(modules.map(row => new URLSearchParams(row.query).get('r'))); expect(revisions.size).toBe(1); expect([...revisions][0]).toMatch(/^[0-9a-f]{12}$/); expect(errors).toEqual([]);
  } finally { await server.close(); }
});
