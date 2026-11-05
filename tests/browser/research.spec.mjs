import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.__errors = errors;
  await page.goto('./'); await expect(page.locator('#question')).toBeEnabled();
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });

async function library(page) {
  if (!(await page.locator('#library').isVisible())) await page.locator('#nav-docs').click();
}
async function closeLibrary(page) {
  if (await page.locator('#library').evaluate(el => el.classList.contains('mobile-open'))) await page.locator('#nav-chat').click();
}
async function ask(page, question = '文档会被上传到服务器吗？') {
  await closeLibrary(page); await page.locator('#question').fill(question); await page.locator('#send-button').click();
  await expect(page.locator('.answer-tools').last()).toBeVisible();
}
async function board(page) { await closeLibrary(page); await page.locator('#nav-research').click(); await expect(page.locator('#research-dialog')).toBeVisible(); }
async function settings(page) { await closeLibrary(page); await page.locator('#library-settings').click(); }
async function addText(page, title, text) {
  await library(page); await page.locator('#paste-open').click(); await page.locator('#paste-title').fill(title); await page.locator('#paste-content').fill(text); await page.locator('#paste-form button[type=submit]').click();
  await expect(page.locator('#paste-dialog')).not.toBeVisible();
}
function backup(documents, research) { return JSON.stringify({ format: 'citemind.knowledge-base', version: 1, exportedAt: '2026-11-05T12:00:00.000Z', documents, ...(research ? { research } : {}) }); }
async function restore(page, text, mode = 'replace') {
  await settings(page); await page.locator('#restore-mode').selectOption(mode);
  await page.locator('#backup-input').setInputFiles({ name: 'research.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#toast')).toContainText(mode === 'replace' ? '已恢复' : '已合并'); await page.locator('#library-dialog [data-close]').last().click();
}

test('Source selection limits answers and an empty selection cannot query', async ({ page }) => {
  await library(page); await page.locator('#select-no-sources').click(); await closeLibrary(page);
  await page.locator('#question').fill('资料隐私'); await page.locator('#send-button').click(); await expect(page.locator('#toast')).toContainText('至少勾选一份'); await expect(page.locator('.message')).toHaveCount(0);
  await library(page); await page.locator('#document-search').fill('隐私'); await expect(page.locator('.document-row')).toHaveCount(1);
  await page.getByRole('checkbox', { name: '参与检索：数据与隐私说明', exact: true }).check();
  await expect(page.locator('#source-scope-count')).toHaveText('已选 1 / 5'); await page.locator('#document-search').clear();
  await ask(page); await expect(page.locator('.source-count')).toContainText('检索 1 份资料');
  await page.getByRole('button', { name: '收集本次证据', exact: true }).click(); await board(page);
  const cards = page.locator('.research-card'); expect(await cards.count()).toBeGreaterThan(0); await expect(cards.first()).toContainText('数据与隐私说明');
});

test('Collect, annotate, label, filter, undo and export evidence with provenance', async ({ page }) => {
  await ask(page); await page.getByRole('button', { name: '收集本次证据', exact: true }).click();
  await page.getByRole('button', { name: '收集本次证据', exact: true }).click(); await board(page);
  const count = await page.locator('.research-card').count(); expect(count).toBeGreaterThan(0);
  await page.locator('#research-title').fill('隐私研究'); await page.locator('#research-title').press('Tab');
  const first = page.locator('.research-card').first(); await first.locator('textarea').fill('需要核对浏览器保存的边界'); await first.locator('select').selectOption('challenge');
  await page.locator('#research-filter').selectOption('challenge'); await expect(page.locator('.research-card')).toHaveCount(1);
  await page.locator('#research-search').fill('不存在的词'); await expect(page.locator('.research-empty')).toContainText('没有符合条件'); await page.locator('#research-search').clear();
  const downloading = page.waitForEvent('download'); await page.locator('#export-research').click(); const download = await downloading;
  const text = await readFile(await download.path(), 'utf8'); expect(text).toContain('隐私研究'); expect(text).toContain('UTF-16'); expect(text).toContain('需要核对浏览器保存的边界'); expect(text).toContain('存疑 / 反例');
  await page.locator('.research-card').first().getByRole('button', { name: /移除证据/ }).click(); await expect(page.locator('.research-card')).toHaveCount(0); await page.locator('#undo-evidence').click(); await expect(page.locator('.research-card')).toHaveCount(1);
  await page.locator('#research-filter').selectOption('all'); await expect(page.locator('.research-card')).toHaveCount(count);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Opt-in persistence restores notes and opting out clears saved workspace', async ({ page }) => {
  await ask(page); await page.getByRole('button', { name: '收集本次证据', exact: true }).click(); await board(page);
  await page.locator('.research-card textarea').first().fill('刷新之后仍要在'); await page.locator('#close-research').click();
  await settings(page); await page.locator('#persist-toggle').check(); await expect(page.locator('#storage-status')).toContainText('已保存'); await page.locator('#library-dialog [data-close]').last().click();
  await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await board(page); await expect(page.locator('.research-card textarea').first()).toHaveValue('刷新之后仍要在');
  await page.locator('.research-card textarea').first().fill('再次编辑，保存最新笔记'); await page.locator('#close-research').click(); await settings(page); await expect(page.locator('#storage-status')).toContainText('已保存');
  await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await board(page); await expect(page.locator('.research-card textarea').first()).toHaveValue('再次编辑，保存最新笔记');
  await page.locator('#close-research').click(); await settings(page); await page.locator('#persist-toggle').uncheck(); await expect(page.locator('#storage-status')).toContainText('尚未开启');
  await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await board(page); await expect(page.locator('.research-card')).toHaveCount(0);
});

test('Complete JSON backup restores research artifacts and documents together', async ({ page }) => {
  await ask(page); await page.getByRole('button', { name: '收集本次证据', exact: true }).click(); await board(page);
  await page.locator('.research-card textarea').first().fill('备份中的个人批注'); const count = await page.locator('.research-card').count(); await page.locator('#close-research').click();
  await settings(page); const downloading = page.waitForEvent('download'); await page.locator('#export-library').click(); const download = await downloading;
  const text = await readFile(await download.path(), 'utf8'); expect(JSON.parse(text).research.cards.length).toBe(count); await page.locator('#library-dialog [data-close]').last().click();
  await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await restore(page, text); await board(page);
  await expect(page.locator('.research-card')).toHaveCount(count); await expect(page.locator('.research-card textarea').first()).toHaveValue('备份中的个人批注');
});

test('Comparison exposes different claims and empty cells, and pins traceable excerpts', async ({ page }) => {
  await addText(page, '甲方库存', '白茶库存为十箱。'); await addText(page, '乙方库存', '白茶库存为五箱。');
  await library(page); await page.locator('#select-no-sources').click(); await page.getByRole('checkbox', { name: '参与检索：甲方库存', exact: true }).check(); await page.getByRole('checkbox', { name: '参与检索：乙方库存', exact: true }).check();
  await board(page); await page.locator('#tab-compare').click(); await page.locator('#compare-questions').fill('白茶库存多少？\n火星轨道倾角'); await page.locator('#run-comparison').click();
  await expect(page.locator('#compare-status')).toContainText('2 个问题 × 2 份资料'); await expect(page.locator('#compare-status')).toContainText('2 格待补充');
  await expect(page.locator('.comparison-table')).toContainText('十箱'); await expect(page.locator('.comparison-table')).toContainText('五箱'); await expect(page.locator('.comparison-gap')).toHaveCount(2);
  await page.locator('.comparison-table .pin-evidence').first().click(); await expect(page.locator('.comparison-table .pin-evidence').first()).toHaveText('已收集 ✓');
  const downloading = page.waitForEvent('download'); await page.locator('#export-comparison').click(); const report = await readFile(await (await downloading).path(), 'utf8'); expect(report).toContain('十箱'); expect(report).toContain('五箱'); expect(report).toContain('未找到足够相关');
  await page.locator('#tab-notes').click(); await expect(page.locator('.research-card')).toHaveCount(1); await expect(page.locator('.research-card')).toContainText('白茶库存多少');
});

test('Removed source leaves an explicit warning and preserves notes', async ({ page }) => {
  await restore(page, backup([{ id: 'only', title: '库存', text: '白茶库存十箱。' }])); await ask(page, '白茶库存'); await page.getByRole('button', { name: '收集本次证据', exact: true }).click();
  await board(page); await page.locator('.research-card textarea').fill('保留这条研究记录'); await page.locator('#close-research').click(); await library(page); await page.locator('.document-item').click(); await page.locator('#remove-document').click();
  await board(page); await expect(page.locator('.research-card')).toContainText('来源已移除'); await expect(page.locator('.research-card textarea')).toHaveValue('保留这条研究记录'); await expect(page.locator('.research-source button')).toBeDisabled();
});

test('Imported HTML remains text and PDF evidence opens at the correct page', async ({ page }) => {
  const text = '无库存。\n白茶库存十箱。'; const excerpt = '白茶库存十箱。'; const start = text.indexOf(excerpt);
  const doc = { id: 'pdf', title: '<img src=x onerror="window.__bad=true">', type: 'pdf', text, pages: [{ pageNumber: 1, text: '无库存。', start: 0, end: 4 }, { pageNumber: 2, text: excerpt, start, end: text.length }] };
  const research = { title: 'PDF 研究', cards: [{ id: 'c1', question: '库存', stance: 'unclassified', note: '<script>window.__bad=true</script>', createdAt: '2026-11-05T12:00:00.000Z', source: { id: 'pdf', title: doc.title, excerpt, chunkId: 'pdf:chunk-2', start, end: text.length, pageNumber: 2 } }] };
  await restore(page, backup([doc], research)); await board(page); await expect(page.locator('.research-card')).toContainText('<img src=x'); await expect(page.locator('.research-card img')).toHaveCount(0);
  await page.locator('.research-source button').click(); await expect(page.locator('#document-dialog')).toBeVisible(); await expect(page.locator('#document-page')).toHaveValue('2'); await expect(page.locator('#document-content mark')).toHaveText(excerpt); expect(await page.evaluate(() => window.__bad)).toBeUndefined();
});

test('Merging an ID collision keeps each quote linked to its own document', async ({ page }) => {
  await restore(page, backup([{ id: 'collision', title: '原有库存', text: '红茶有二十箱。' }]));
  const text = '白茶有十箱。'; const doc = { id: 'collision', title: '导入库存', text };
  const research = { title: '导入研究', cards: [{ id: 'card', question: '白茶库存', stance: 'context', note: '导入记录', createdAt: '2026-11-05T12:00:00.000Z', source: { id: doc.id, title: doc.title, excerpt: text, chunkId: 'collision:chunk-1', start: 0, end: text.length } }] };
  await restore(page, backup([doc], research), 'merge'); await board(page); await expect(page.locator('.research-card')).toContainText('可核对原文'); await page.locator('.research-source button').click(); await expect(page.locator('#document-title')).toHaveText('导入库存'); await expect(page.locator('#document-content mark')).toHaveText(text);
});
