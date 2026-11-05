import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  page.__errors = []; page.on('pageerror', error => page.__errors.push(error.message));
  await page.goto('./'); await expect(page.locator('#question')).toBeEnabled();
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });

function evidence(id, doc, excerpt, question, stance = 'unclassified', note = '', pageNumber) {
  const start = doc.text.indexOf(excerpt);
  return { id, question, stance, note, createdAt: '2026-11-05T12:00:00.000Z', source: { id: doc.id, title: doc.title, excerpt, start, end: start + excerpt.length, chunkId: `${doc.id}:chunk-1`, ...(pageNumber ? { pageNumber } : {}) } };
}
const alpha = { id: 'alpha', title: '隐私设计', text: '文档不会上传，处理在浏览器进行。引用位置必须核对原文。' };
const beta = { id: 'beta', title: '复核意见', text: '复杂排版需要人工复核。' };
const missing = { id: 'missing', title: '已移除的历史资料', text: '历史记录。' };
const cards = [evidence('a', alpha, '文档不会上传，处理在浏览器进行。', '文档在哪里处理？', 'support'), evidence('b', alpha, '引用位置必须核对原文。', '如何复核证据？', 'context'), evidence('c', beta, beta.text, '如何复核证据？', 'challenge', '双栏 PDF 需要再核对'), evidence('d', missing, missing.text, '如何复核证据？', 'unclassified', '保留失效来源的批注')];
async function restore(page, documents = [alpha, beta], rows = cards) {
  await page.locator('#library-settings').click(); await page.locator('#restore-mode').selectOption('replace');
  const backup = { format: 'citemind.knowledge-base', version: 1, exportedAt: '2026-11-05T12:00:00.000Z', documents, research: { title: '资料隐私与复核研究', cards: rows } };
  await page.locator('#backup-input').setInputFiles({ name: 'map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('#toast')).toContainText('已恢复'); await page.locator('#library-dialog [data-close]').last().click();
}
async function openMap(page) { await page.locator('#nav-research').click(); await page.locator('#tab-map').click(); }

test('Map nodes reveal exact records; filters and an SVG snapshot preserve the displayed scope', async ({ page }) => {
  await restore(page); await openMap(page);
  await expect(page.locator('#map-summary')).toHaveText('2 个问题 · 3 份来源 · 4 条证据 · 1 条待核对');
  await expect(page.locator('.map-node')).toHaveCount(5); await page.locator('.map-node.question').filter({ hasText: '如何复核证据' }).click();
  await expect(page.locator('.map-evidence')).toHaveCount(3); await expect(page.locator('#map-details')).toContainText('双栏 PDF'); await expect(page.locator('.map-node[aria-pressed=true]')).toHaveCount(1);
  await page.locator('.map-node.source').filter({ hasText: '复核意见' }).click(); await expect(page.locator('.map-evidence')).toHaveCount(1); await expect(page.locator('.map-evidence blockquote')).toHaveText(beta.text);
  await page.locator('#map-stance').selectOption('challenge'); await expect(page.locator('#map-summary')).toHaveText('1 个问题 · 1 份来源 · 1 条证据 · 0 条待核对');
  const downloading = page.waitForEvent('download'); await page.locator('#export-evidence-map').click(); const svg = await readFile(await (await downloading).path(), 'utf8');
  expect(svg).toContain('复核意见'); expect(svg).not.toContain('已移除的历史资料');
  expect(await page.evaluate(svg => { const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); return { errors: doc.querySelectorAll('parsererror').length, scripts: doc.querySelectorAll('script,foreignObject').length }; }, svg)).toEqual({ errors: 0, scripts: 0 });
  await page.locator('#map-search').fill('不存在的关键词'); await expect(page.locator('.map-empty')).toBeVisible(); await expect(page.locator('#export-evidence-map')).toBeDisabled();
  expect(await page.locator('#map-panel').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('Tabs and nodes work with the keyboard; editing a connected record updates its map', async ({ page }) => {
  await restore(page); await page.locator('#nav-research').click(); await page.locator('#research-filter').selectOption('support'); await page.locator('#tab-notes').focus(); await page.keyboard.press('End');
  await expect(page.locator('#tab-map')).toBeFocused(); await expect(page.locator('#map-panel')).toBeVisible();
  const source = page.locator('.map-node.source').filter({ hasText: '复核意见' }); await source.focus(); await page.keyboard.press('Enter'); await expect(source).toHaveAttribute('aria-pressed', 'true'); await expect(source).toBeFocused();
  await page.locator('#map-details').getByRole('button', { name: '编辑笔记' }).click(); await expect(page.locator('#tab-notes')).toHaveAttribute('aria-selected', 'true');
  const note = page.locator('[data-card-id="c"] textarea'); await expect(note).toBeFocused(); await note.fill('核对完成后再决定是否采纳');
  await page.locator('#tab-map').click(); await expect(page.locator('#map-details')).toContainText('核对完成后再决定是否采纳');
  await page.locator('#tab-map').focus(); await page.keyboard.press('ArrowRight'); await expect(page.locator('#tab-notes')).toBeFocused(); await page.keyboard.press('ArrowLeft'); await expect(page.locator('#tab-map')).toBeFocused();
});

test('Stale source nodes retain notes and never open a false source location', async ({ page }) => {
  await restore(page); await openMap(page); await page.locator('#map-status').selectOption('stale');
  await expect(page.locator('#map-summary')).toHaveText('1 个问题 · 1 份来源 · 1 条证据 · 1 条待核对'); await expect(page.locator('.map-node.source.stale')).toHaveCount(1);
  await page.locator('.map-node.source').click(); await expect(page.locator('#map-details')).toContainText('保留失效来源的批注'); await expect(page.locator('#map-details')).toContainText('来源已移除'); await expect(page.locator('#map-details').getByRole('button', { name: '查看原文 ↗' })).toBeDisabled();
});

test('Untrusted titles stay text and PDF map evidence opens its actual second page', async ({ page }) => {
  const excerpt = '白茶库存十箱。'; const text = '第一页。\n' + excerpt;
  const doc = { id: 'pdf', title: '<svg onload="window.__bad=true">', type: 'pdf', text, pages: [{ pageNumber: 1, text: '第一页。', start: 0, end: 4 }, { pageNumber: 2, text: excerpt, start: 5, end: text.length }] };
  await restore(page, [doc], [evidence('pdf-card', doc, excerpt, '<img onerror="window.__bad=true">', 'support', '', 2)]); await openMap(page);
  await expect(page.locator('.map-node.source')).toContainText('<svg onload='); await expect(page.locator('#map-canvas img')).toHaveCount(0); await page.locator('.map-node.source').click();
  await page.locator('#map-details').getByRole('button', { name: '查看原文 ↗' }).click(); await expect(page.locator('#document-page')).toHaveValue('2'); await expect(page.locator('#document-content mark')).toHaveText(excerpt); expect(await page.evaluate(() => window.__bad)).toBeUndefined();
});

test('Selection stays with the same question and source when earlier records are removed', async ({ page }) => {
  await restore(page); await openMap(page); await page.locator('.map-node.question').filter({ hasText: '如何复核证据' }).click();
  await page.locator('[data-map-card="c"]').getByRole('button', { name: '编辑笔记' }).click(); await page.locator('[data-card-id="a"]').getByRole('button', { name: '移除证据：隐私设计', exact: true }).click();
  await page.locator('#tab-map').click(); await expect(page.locator('#map-detail-heading')).toHaveText('如何复核证据？'); await expect(page.locator('.map-evidence')).toHaveCount(3);
  await page.locator('.map-node.source').filter({ hasText: '复核意见' }).click(); await page.locator('#map-details').getByRole('button', { name: '编辑笔记' }).click();
  await page.locator('[data-card-id="b"]').getByRole('button', { name: '移除证据：隐私设计', exact: true }).click(); await page.locator('#tab-map').click();
  await expect(page.locator('#map-detail-heading')).toHaveText('复核意见'); await expect(page.locator('.map-evidence')).toHaveCount(1); await expect(page.locator('.map-evidence blockquote')).toHaveText(beta.text);
});
