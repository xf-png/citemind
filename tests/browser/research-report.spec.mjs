import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const date = '2026-11-06T00:00:00.000Z';
const doc = { id: 'source', title: '库存记录', text: '白茶库存十箱。\n仅全文包含的内部说明。' };
function card(id = 'card', source = doc, note = '复核采购表格', stance = 'support') {
  const excerpt = source.text.split('\n')[0];
  return { id, question: '白茶库存', stance, note, createdAt: date, source: { id: source.id, title: source.title, excerpt, start: 0, end: excerpt.length, chunkId: `${source.id}:chunk-1` } };
}
test.beforeEach(async ({ page }) => { page.__errors = []; page.on('pageerror', error => page.__errors.push(error.message)); await page.goto('./'); await expect(page.locator('#question')).toBeEnabled(); });
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });
async function restore(page, documents = [doc], cards = [card()], title = '库存研究报告') {
  await page.locator('#library-settings').click(); await page.locator('#restore-mode').selectOption('replace');
  await page.locator('#backup-input').setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'citemind.knowledge-base', version: 1, exportedAt: date, documents, research: { title, cards } })) });
  await expect(page.locator('#toast')).toContainText('已恢复'); await page.locator('#library-dialog [data-close]').last().click(); await page.locator('#nav-research').click();
}
async function preview(page) { await page.locator('#export-report').click(); await expect(page.locator('#report-dialog')).toBeVisible(); return page.frameLocator('#report-preview'); }
async function downloadReport(page) {
  const downloading = page.waitForEvent('download'); await page.locator('#download-report').click(); const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.html$/); return readFile(await download.path(), 'utf8');
}

test('Report preview makes full-text inclusion explicit and downloaded HTML works offline', async ({ page, context }, testInfo) => {
  await restore(page); await page.locator('#research-search').fill('隐藏当前卡片'); await expect(page.locator('.research-card')).toHaveCount(0);
  const frame = await preview(page); await expect(frame.locator('h1')).toHaveText('库存研究报告'); await expect(frame.locator('blockquote')).toHaveText('白茶库存十箱。');
  await expect(page.locator('#report-scope')).toContainText('1 条证据'); await expect(page.locator('#report-include-sources')).not.toBeChecked();
  const minimal = await downloadReport(page); expect(minimal).toContain('复核采购表格'); expect(minimal).not.toContain('仅全文包含的内部说明');
  await page.locator('#report-include-sources').check(); await expect(page.locator('#report-scope')).toContainText('可能含未摘录的内容'); await expect(frame.locator('.full-source')).toContainText('内部说明');
  const html = await downloadReport(page); const path = testInfo.outputPath('portable.html'); await writeFile(path, html);
  await context.setOffline(true); const standalone = await context.newPage(); const network = [];
  standalone.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await standalone.goto(pathToFileURL(path).href); await expect(standalone.locator('h1')).toHaveText('库存研究报告');
  await standalone.getByRole('link', { name: '核对完整提取文字中的高亮' }).click(); await expect(standalone.locator('.full-source mark')).toHaveText('白茶库存十箱。'); expect(standalone.url()).toContain('#quote-1');
  expect(await standalone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(network).toEqual([]); await standalone.close();
});

test('Report content stays inert and changed PDF anchors keep warnings instead of false links', async ({ page }) => {
  const evil = '<img src="https://outside-report.invalid/x" onerror="window.__reportBad=1">';
  const pdf = { id: 'pdf', title: evil, type: 'pdf', text: '第一页。\n白茶十箱。', pages: [{ pageNumber: 1, text: '第一页。', start: 0, end: 4 }, { pageNumber: 2, text: '白茶十箱。', start: 5, end: 10 }] };
  const good = card('good', pdf, evil); Object.assign(good.source, { excerpt: '白茶十箱。', start: 5, end: 10, pageNumber: 2 });
  const stale = structuredClone(good); stale.id = 'stale'; stale.source.pageNumber = 1;
  const missing = card('missing', { id: 'removed', title: '已移除资料', text: '历史库存。' }); const network = [];
  page.on('request', request => { if (request.url().includes('outside-report.invalid')) network.push(request.url()); });
  await restore(page, [pdf], [good, stale, missing], evil); const frame = await preview(page); await page.locator('#report-include-sources').check();
  await expect(frame.locator('h1')).toHaveText(evil); await expect(frame.locator('img,script,object,embed')).toHaveCount(0);
  await expect(frame.locator('.notice.warning')).toContainText('2 条摘录'); await expect(frame.getByRole('link', { name: '核对完整提取文字中的高亮' })).toHaveCount(1);
  await expect(frame.locator('.position').first()).toContainText('PDF 第 2 页'); await expect(frame.locator('#quote-2,#quote-3')).toHaveCount(0);
  expect(await page.evaluate(() => window.__reportBad)).toBeUndefined(); expect(network).toEqual([]);
});

test('A prepared offline app generates fresh reports and resets full-text inclusion each time', async ({ page, context }) => {
  test.setTimeout(120_000); await restore(page); await page.locator('#close-research').click(); await page.locator('#library-settings').click();
  await page.locator('#persist-toggle').check(); await expect(page.locator('#storage-status')).toContainText('已保存');
  await page.locator('#prepare-offline').click(); await expect(page.locator('#offline-status')).toContainText('已就绪', { timeout: 90_000 }); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true); await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await page.locator('#nav-research').click();
  let frame = await preview(page); await expect(frame.locator('.note')).toContainText('复核采购表格'); await page.locator('#report-include-sources').check(); await page.locator('#close-report').click();
  await page.locator('.research-card textarea').fill('断网后补充的新结论'); frame = await preview(page); await expect(page.locator('#report-include-sources')).not.toBeChecked(); await expect(frame.locator('.note')).toContainText('断网后补充的新结论');
  const html = await downloadReport(page); expect(html).toContain('断网后补充的新结论'); expect(html).not.toContain('仅全文包含的内部说明');
  await page.locator('#close-report').click(); await expect(page.locator('#research-dialog')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
