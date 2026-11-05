import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serveDist } from './helpers/serve-dist.mjs';

const resourceCount = JSON.parse((await readFile(new URL('../../dist/sw.js', import.meta.url), 'utf8')).match(/^const PACKAGE = (.+);$/m)[1]).assets.length;

test.beforeEach(async ({ page }) => { await page.goto('./'); await expect(page.locator('#question')).toBeEnabled(); });
async function settings(page) { await page.locator('#library-settings').click(); }
async function closeSettings(page) { await page.locator('#library-dialog [data-close]').last().click(); }
async function prepare(page) {
  await page.locator('#prepare-offline').click();
  await expect(page.locator('#offline-status')).toContainText('已就绪', { timeout: 90_000 });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator('#prepare-offline')).toBeEnabled();
}

test('Offline is opt-in; a prepared workspace survives an offline reload', async ({ page, context }) => {
  test.setTimeout(120_000);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await settings(page); await page.locator('#persist-toggle').check(); await expect(page.locator('#storage-status')).toContainText('已保存'); await prepare(page); await closeSettings(page);
  await context.setOffline(true); await page.reload(); await expect(page.locator('#question')).toBeEnabled();
  await page.locator('#question').fill('文档会被上传到服务器吗？'); await page.locator('#send-button').click(); await expect(page.locator('.answer-body')).toContainText('不会上传');
  await page.getByRole('button', { name: '收集本次证据', exact: true }).click(); await page.locator('#nav-research').click(); await expect(page.locator('.research-card')).toHaveCount(1);
  await page.locator('.research-card textarea').fill('断网时整理的研究笔记'); await page.locator('#close-research').click(); await settings(page); await expect(page.locator('#storage-status')).toContainText('已保存'); await closeSettings(page);
  await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await page.locator('#nav-research').click(); await expect(page.locator('.research-card textarea')).toHaveValue('断网时整理的研究笔记');
});

test('Clearing the offline package preserves the knowledge store and unrelated caches', async ({ page }) => {
  test.setTimeout(120_000);
  await settings(page); await page.locator('#persist-toggle').check(); await expect(page.locator('#storage-status')).toContainText('已保存'); await prepare(page);
  await page.evaluate(async () => { const cache = await caches.open('unrelated-test-app'); await cache.put(new URL('./unrelated', location.href), new Response('keep')); });
  await page.locator('#clear-offline').click(); await expect(page.locator('#offline-status')).toContainText('已移除');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  const names = await page.evaluate(() => caches.keys()); expect(names).toEqual(['unrelated-test-app']);
  await expect(page.locator('#persist-toggle')).toBeChecked(); await expect(page.locator('#storage-status')).toContainText('已保存'); await closeSettings(page);
  await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await expect(page.locator('#storage-label')).toContainText('已保存在此浏览器');
});

test('An incomplete cache can be repaired instead of claiming offline readiness', async ({ page }) => {
  test.setTimeout(120_000);
  await settings(page); await prepare(page);
  await page.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith('citemind-offline-')) await caches.delete(name); });
  await closeSettings(page); await settings(page); await expect(page.locator('#offline-status')).toContainText('不完整');
  await prepare(page); await expect(page.locator('#offline-status')).toContainText(`${resourceCount} 项资源`);
});

test('The real local embedding model loads and retrieves evidence without network', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-layout', 'Real inference is verified once on desktop Chrome.');
  test.setTimeout(150_000);
  await settings(page); await prepare(page); await closeSettings(page); await context.setOffline(true); await page.reload(); await expect(page.locator('#question')).toBeEnabled();
  await page.locator('#model-open').click(); await page.locator('#mode-ai').click();
  await expect(page.locator('#model-label')).toHaveText('本地 AI 已就绪', { timeout: 120_000 });
  await page.locator('#question').fill('文档会被上传到服务器吗？'); await page.locator('#send-button').click(); await expect(page.locator('.answer-tools')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.answer-head small')).toContainText('AI 语义检索'); await expect(page.locator('.answer-body')).toContainText('不会上传');
});

test('A corrupted resource cannot create a ready offline package', async ({ page }) => {
  const server = await serveDist((path, bytes) => path === '/engine.js' ? Buffer.concat([bytes, Buffer.from('\n// altered resource')]) : bytes);
  try {
    await page.goto(server.url); await expect(page.locator('#question')).toBeEnabled(); await settings(page); await page.locator('#prepare-offline').click();
    await expect(page.locator('#toast')).toContainText('离线包未能完成', { timeout: 20_000 }); await expect(page.locator('#prepare-offline')).toBeEnabled();
    expect(await page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('citemind-offline-')))).toEqual([]);
    await expect(page.locator('#offline-status')).not.toContainText('已就绪');
  } finally { await server.close(); }
});

test('An update reuses verified model bytes and waits for existing pages to close', async ({ page, context }) => {
  test.setTimeout(120_000);
  let upgraded = false; let modelRequests = 0; let engineRequests = 0;
  const server = await serveDist((path, bytes) => {
    if (!upgraded) return bytes;
    if (path.startsWith('/models/')) { modelRequests++; return null; }
    if (path === '/engine.js') engineRequests++;
    if (path !== '/sw.js') return bytes;
    return Buffer.from(bytes.toString().replace(/^const PACKAGE = (.+);$/m, (line, json) => {
      const manifest = JSON.parse(json); manifest.version = '1.4.1-test'; manifest.revision += '-upgrade-test';
      return `const PACKAGE = ${JSON.stringify(manifest)};`;
    }));
  });
  let reopened;
  try {
    await page.goto(server.url); await expect(page.locator('#question')).toBeEnabled(); await settings(page); await prepare(page); await closeSettings(page);
    await page.locator('#question').fill('尚未保存的升级检验草稿');
    await page.evaluate(async () => {
      const name = (await caches.keys()).find(name => name.startsWith('citemind-offline-'));
      const cache = await caches.open(name); await cache.put(new URL('./engine.js', location.href), new Response('// invalid cached bytes'));
    });
    upgraded = true; await settings(page); await page.locator('#prepare-offline').click();
    await expect(page.locator('#offline-status')).toContainText('新版离线包 1.4.1-test 已准备', { timeout: 90_000 });
    await expect(page.locator('#prepare-offline')).toBeEnabled(); await expect(page.locator('#question')).toHaveValue('尚未保存的升级检验草稿');
    expect(modelRequests).toBe(0); expect(engineRequests).toBe(1);
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
    await page.close(); reopened = await context.newPage(); await reopened.goto(server.url); await expect(reopened.locator('#question')).toBeEnabled();
    await expect.poll(() => reopened.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('citemind-offline-')))).toEqual([expect.stringContaining('1.4.1-test')]);
    await settings(reopened); await expect(reopened.locator('#offline-status')).toContainText('离线包 1.4.1-test 已就绪');
  } finally { if (reopened) await reopened.close(); await server.close(); }
});

test('A real two-page PDF imports offline and its citation opens the correct page', async ({ page, context }) => {
  test.setTimeout(120_000);
  const stream = text => `BT /F1 16 Tf 50 750 Td (${text}) Tj ET`;
  const one = stream('Warehouse inventory report.'); const two = stream('Tea stock has ten boxes.');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${one.length} >>\nstream\n${one}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${two.length} >>\nstream\n${two}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await settings(page); await prepare(page); await closeSettings(page); await context.setOffline(true); await page.reload(); await expect(page.locator('#question')).toBeEnabled();
  await page.locator('#file-input').setInputFiles({ name: 'offline-inventory.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
  await expect(page.locator('#toast')).toContainText('已添加 1 份资料', { timeout: 30_000 });
  await page.locator('#question').fill('tea stock boxes'); await page.locator('#send-button').click(); await expect(page.locator('.answer-tools')).toBeVisible(); await expect(page.locator('.answer-body')).toContainText('ten boxes');
  await page.locator('.citation').first().click(); await expect(page.locator('#document-title')).toHaveText('offline-inventory'); await expect(page.locator('#document-page')).toHaveValue('2'); await expect(page.locator('#document-content mark')).toContainText('ten boxes');
});

test('Removing a waiting update also stops the active worker without recreating caches', async ({ page }) => {
  test.setTimeout(120_000);
  let upgraded = false;
  const server = await serveDist((path, bytes) => upgraded && path === '/sw.js' ? Buffer.from(bytes.toString().replace(/"version":"[^"]+"/, '"version":"1.4.1-test"')) : bytes);
  try {
    await page.goto(server.url); await expect(page.locator('#question')).toBeEnabled(); await settings(page); await prepare(page);
    upgraded = true; await page.locator('#prepare-offline').click(); await expect(page.locator('#offline-status')).toContainText('新版离线包 1.4.1-test 已准备', { timeout: 90_000 }); await expect(page.locator('#prepare-offline')).toBeEnabled();
    await page.locator('#clear-offline').click(); await expect(page.locator('#offline-status')).toContainText('已移除');
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(await page.evaluate(async () => (await fetch('./engine.js?after-removal')).ok)).toBe(true);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
  } finally { await server.close(); }
});

test('A failed update keeps the active offline workspace usable and the current draft intact', async ({ page, context }) => {
  test.setTimeout(120_000);
  let upgraded = false;
  const updatedEngine = Buffer.concat([await readFile(new URL('../../dist/engine.js', import.meta.url)), Buffer.from('\n// new release bytes\n')]);
  const server = await serveDist((path, bytes) => {
    if (!upgraded) return bytes;
    if (path === '/engine.js') return Buffer.from('// incomplete new download');
    if (path !== '/sw.js') return bytes;
    return Buffer.from(bytes.toString().replace(/^const PACKAGE = (.+);$/m, (line, json) => {
      const manifest = JSON.parse(json); manifest.version = 'failed-update-test'; manifest.revision += '-failed-update';
      const engine = manifest.assets.find(asset => asset.path === 'engine.js'); engine.bytes = updatedEngine.length; engine.sha256 = createHash('sha256').update(updatedEngine).digest('hex');
      return `const PACKAGE = ${JSON.stringify(manifest)};`;
    }));
  });
  try {
    await page.goto(server.url); await expect(page.locator('#question')).toBeEnabled(); await settings(page); await prepare(page); await closeSettings(page);
    const previousCaches = await page.evaluate(() => caches.keys()); await page.locator('#question').fill('尚未提交的研究草稿');
    upgraded = true; await settings(page); await page.locator('#prepare-offline').click();
    await expect(page.locator('#toast')).toContainText('离线包未能完成', { timeout: 30_000 }); await expect(page.locator('#prepare-offline')).toBeEnabled(); await expect(page.locator('#offline-status')).toContainText('已就绪');
    await expect(page.locator('#question')).toHaveValue('尚未提交的研究草稿'); expect(await page.evaluate(() => caches.keys())).toEqual(previousCaches);
    expect(await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); return Boolean(reg.active) && !reg.waiting; })).toBe(true);
    await closeSettings(page); await context.setOffline(true); await page.reload(); await expect(page.locator('#question')).toBeEnabled();
    await page.locator('#question').fill('文档会被上传到服务器吗？'); await page.locator('#send-button').click(); await expect(page.locator('.answer-body')).toContainText('不会上传');
  } finally { await server.close(); }
});
