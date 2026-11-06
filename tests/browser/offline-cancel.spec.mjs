import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serveDist } from './helpers/serve-dist.mjs';

const manifest = JSON.parse((await readFile(new URL('../../dist/sw.js', import.meta.url), 'utf8')).match(/^const PACKAGE = (.+);$/m)[1]);
const model = manifest.assets.find(asset => asset.path.startsWith('models/') && asset.bytes > 1024 * 1024);
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function begin(page, url) { await page.goto(url); await expect(page.locator('#question')).toBeEnabled(); await page.locator('#question').fill('取消下载也要保留的草稿'); await page.locator('#library-settings').click(); await page.locator('#persist-toggle').check(); await expect(page.locator('#storage-status')).toContainText('已保存'); }
async function prepare(page) { await page.locator('#prepare-offline').click(); await expect(page.locator('#offline-status')).toContainText('已就绪', { timeout: 90_000 }); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller)); }

test('A slow initial package reports its active component, can be cancelled, and retries cleanly', async ({ page }) => {
  test.setTimeout(120_000); const pause = gate(); let hold = true; let blocked = 0;
  const server = await serveDist(async (path, bytes) => { if (hold && path === `/${model.path}`) { blocked++; await pause.promise; } return bytes; });
  try {
    await begin(page, server.url); await page.evaluate(async () => { await caches.open('unrelated-workspace'); }); await page.locator('#prepare-offline').click();
    await expect.poll(() => blocked).toBeGreaterThan(0); await expect(page.locator('#offline-status')).toContainText('中文 AI 模型'); await expect(page.locator('#cancel-offline')).toBeEnabled();
    await page.locator('#library-dialog [data-close]').last().click(); await page.locator('#question').fill('文档会被上传到服务器吗？'); await page.locator('#send-button').click(); await expect(page.locator('.answer-body')).toContainText('不会上传');
    await page.locator('#question').fill('取消下载也要保留的草稿'); await page.locator('#library-settings').click();
    await page.locator('#cancel-offline').click(); await expect(page.locator('#toast')).toContainText('已取消本次准备'); await expect(page.locator('#prepare-offline')).toBeEnabled(); await expect(page.locator('#cancel-offline')).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['unrelated-workspace']); await expect(page.locator('#storage-status')).toContainText('已保存');
    hold = false; pause.release(); await prepare(page); await expect(page.locator('#offline-status')).toContainText(`${manifest.assets.length} 项资源`);
    await page.locator('#library-dialog [data-close]').last().click(); await expect(page.locator('#question')).toHaveValue('取消下载也要保留的草稿'); await expect(page.locator('.document-row')).toHaveCount(5);
  } finally { pause.release(); await server.close(); }
});

test('Cancelling an update preserves the active offline package, saved notes and current draft', async ({ page, context }) => {
  test.setTimeout(120_000); let upgraded = false; let blocked = 0; const pause = gate();
  const changedEngine = Buffer.concat([await readFile(new URL('../../dist/engine.js', import.meta.url)), Buffer.from('\n// cancel update fixture\n')]);
  const server = await serveDist(async (path, bytes) => {
    if (!upgraded) return bytes;
    if (path === '/engine.js') { blocked++; await pause.promise; return changedEngine; }
    if (path !== '/sw.js') return bytes;
    return Buffer.from(bytes.toString().replace(/^const PACKAGE = (.+);$/m, (line, json) => {
      const next = JSON.parse(json); next.version = 'cancel-upgrade-test'; next.revision += '-cancel'; const asset = next.assets.find(row => row.path === 'engine.js'); next.bytes += changedEngine.length - asset.bytes; asset.bytes = changedEngine.length; asset.sha256 = createHash('sha256').update(changedEngine).digest('hex'); return `const PACKAGE = ${JSON.stringify(next)};`;
    }));
  });
  try {
    await begin(page, server.url); await prepare(page); const previous = await page.evaluate(() => caches.keys()); await page.locator('#library-dialog [data-close]').last().click();
    await page.locator('#question').fill('文档会被上传到服务器吗？'); await page.locator('#send-button').click(); await expect(page.locator('.answer-tools')).toBeVisible(); await page.getByRole('button', { name: '收集本次证据', exact: true }).click(); await page.locator('#nav-research').click(); await page.locator('.research-card textarea').first().fill('取消更新后仍要保留的研究笔记'); await page.locator('#close-research').click();
    await page.locator('#question').fill('取消更新时的未发送草稿'); await page.locator('#library-settings').click(); await expect(page.locator('#storage-status')).toContainText('已保存');
    upgraded = true; await page.locator('#prepare-offline').click(); await expect.poll(() => blocked).toBeGreaterThan(0); await expect(page.locator('#cancel-offline')).toBeEnabled(); await page.locator('#cancel-offline').click();
    await expect(page.locator('#toast')).toContainText('已取消本次准备'); await expect(page.locator('#prepare-offline')).toBeEnabled(); await expect(page.locator('#offline-status')).toContainText('已就绪'); await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(previous);
    await page.locator('#library-dialog [data-close]').last().click(); await expect(page.locator('#question')).toHaveValue('取消更新时的未发送草稿');
    await context.setOffline(true); await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await page.locator('#nav-research').click(); await expect(page.locator('.research-card textarea').first()).toHaveValue('取消更新后仍要保留的研究笔记');
  } finally { pause.release(); await server.close(); }
});
