import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeDocx, makeZip, paragraph } from '../helpers/zip-fixture.mjs';

const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fixture = () => makeDocx({
  body: paragraph('采购核对记录。') + '<w:tbl><w:tr><w:tc>' + paragraph('商品') + '</w:tc><w:tc>' + paragraph('库存') + '</w:tc></w:tr><w:tr><w:tc>' + paragraph('白茶') + '</w:tc><w:tc>' + paragraph('十箱，保质期十八个月。') + '</w:tc></w:tr></w:tbl><w:p><w:r><w:t>库存以盘点为准。</w:t><w:footnoteReference w:id="7"/></w:r></w:p>',
  footnotes: '<w:footnote w:id="-1" w:type="separator"/>' + '<w:footnote w:id="7">' + paragraph('盘点日期为二〇二六年十一月六日。') + '</w:footnote>',
});
test.beforeEach(async ({ page }) => {
  page.__errors = []; page.on('pageerror', error => page.__errors.push(error.message));
  await page.goto('./'); await expect(page.locator('#question')).toBeEnabled();
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });
async function library(page) { if (!(await page.locator('#library').isVisible())) await page.locator('#nav-docs').click(); }
async function closeLibrary(page) { if (await page.locator('#library').evaluate(el => el.classList.contains('mobile-open'))) await page.locator('#nav-chat').click(); }
async function upload(page, buffer = fixture(), name = '采购核对.docx') {
  await library(page); await page.locator('#file-input').setInputFiles({ name, mimeType, buffer });
  await expect(page.locator('#toast')).toContainText('已添加 1 份');
}
async function ask(page) {
  await closeLibrary(page); await page.locator('#question').fill('白茶库存及保质期'); await page.locator('#send-button').click();
  await expect(page.locator('.answer-tools')).toBeVisible(); await expect(page.locator('.answer-body')).toContainText('十八个月');
}
async function parse(page, bytes) {
  return page.evaluate(async data => {
    const { parseDocxFile } = await import('./docx.js');
    return parseDocxFile(new File([new Uint8Array(data)], 'fixture.docx'));
  }, [...bytes]);
}

test('Word table and footnote imports produce traceable evidence and a restorable backup', async ({ page }) => {
  await upload(page); await library(page); await page.locator('#select-no-sources').click();
  await page.getByRole('checkbox', { name: '参与检索：采购核对', exact: true }).check(); await ask(page);
  await page.getByRole('button', { name: '收集本次证据', exact: true }).click(); await page.locator('#nav-research').click();
  const card = page.locator('.research-card').first(); await expect(card).toContainText('采购核对');
  await card.locator('textarea').fill('复核 Word 表格中的库存'); await card.locator('.research-source button').click();
  await expect(page.locator('#document-content mark')).toContainText('十八个月');
  await expect(page.locator('#document-content')).toContainText('盘点日期'); await expect(page.locator('#document-page')).not.toBeVisible();
  await page.locator('#document-dialog [data-close]').last().click(); await page.locator('#close-research').click(); await closeLibrary(page);
  await page.locator('#library-settings').click(); const downloading = page.waitForEvent('download'); await page.locator('#export-library').click();
  const backup = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
  const doc = backup.documents.find(row => row.title === '采购核对'); expect(doc.text).toContain('白茶\t十箱'); expect(doc.text).toContain('〔脚注 1〕'); expect(doc.pages).toBeUndefined(); expect(doc.type).toBeUndefined();
  expect(backup.research.cards[0].note).toContain('复核 Word'); expect(backup.research.cards[0].source.pageNumber).toBeUndefined();
  await page.locator('#restore-mode').selectOption('replace'); await page.locator('#backup-input').setInputFiles({ name: 'word.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('#toast')).toContainText('已恢复'); await page.locator('#library-dialog [data-close]').last().click();
  await page.locator('#nav-research').click(); await expect(page.locator('.research-card textarea').first()).toHaveValue('复核 Word 表格中的库存');
});

test('Strict Word XML, custom main parts and literal markup remain local text', async ({ page }) => {
  const requests = []; page.on('request', request => { if (request.url().includes('external-word.invalid')) requests.push(request.url()); });
  const body = paragraph('<img src=x onerror="window.__wordBad=1">') + '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>隐藏秘密</w:t></w:r><w:del><w:r><w:delText>已删除文字</w:delText></w:r></w:del><w:ins><w:r><w:t>保留修订</w:t></w:r></w:ins><w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="outside"><w:r><w:t>外链文字</w:t></w:r></w:hyperlink></w:p><w:altChunk/>';
  const result = await parse(page, makeDocx({ namespace: 'http://purl.oclc.org/ooxml/wordprocessingml/main', main: 'custom/main.xml', body, entries: [{ name: 'custom/_rels/main.xml.rels', text: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="outside" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://external-word.invalid/private" TargetMode="External"/></Relationships>' }] }));
  expect(result.text).toBe('<img src=x onerror="window.__wordBad=1">\n\n保留修订外链文字'); expect(result.warnings).toHaveLength(2); expect(requests).toEqual([]);
  await upload(page, makeDocx({ body })); await expect(page.locator('#toast')).toContainText('隐藏文字');
  await page.getByRole('button', { name: /采购核对/ }).first().click(); await expect(page.locator('#document-content')).toContainText('<img src=x');
  await expect(page.locator('#document-content img')).toHaveCount(0); expect(await page.evaluate(() => window.__wordBad)).toBeUndefined();
});

test('Damaged, empty and excessive Word content leave the existing library unchanged', async ({ page }) => {
  const invalid = [Buffer.from('not a ZIP'), makeDocx({ body: '' }), makeDocx({ body: paragraph('字'.repeat(100001)) }), makeZip([{ name: '[Content_Types].xml', text: '<!DOCTYPE Types [<!ENTITY x "payload">]><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' }])];
  for (const buffer of invalid) {
    await library(page); await page.locator('#file-input').setInputFiles({ name: '损坏.docx', mimeType, buffer });
    await expect(page.locator('#import-progress')).not.toBeVisible(); await expect(page.locator('#toast')).not.toContainText('已添加');
    await expect(page.locator('.document-row')).toHaveCount(5);
  }
  await page.locator('#file-input').setInputFiles([{ name: '有效.docx', mimeType, buffer: fixture() }, { name: '编码损坏.txt', mimeType: 'text/plain', buffer: Buffer.from([0xff, 0xfe, 0x80]) }]);
  await expect(page.locator('#toast')).toContainText('不是 UTF-8'); await expect(page.locator('.document-row')).toHaveCount(5);
});

test('Word parsing can be cancelled while reading without leaving pending work', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { parseDocxFile } = await import('./docx.js'); const controller = new AbortController(); let started = false;
    const pending = parseDocxFile({ size: 123, arrayBuffer() { started = true; return new Promise(() => {}); } }, { signal: controller.signal }).then(() => 'unexpected', error => error.name);
    controller.abort(); const during = await pending;
    const before = await parseDocxFile(new File(['x'], 'word.docx'), { signal: controller.signal }).then(() => 'unexpected', error => error.name);
    return { started, during, before };
  });
  expect(result).toEqual({ started: true, during: 'AbortError', before: 'AbortError' });
});

test('A DOCX created by python-docx imports paragraphs and table cells', async ({ page }) => {
  const bytes = await readFile(new URL('../fixtures/word-inventory.docx', import.meta.url));
  const result = await parse(page, bytes); expect(result.text).toContain('真实 Word 兼容样例'); expect(result.text).toContain('白茶\t十箱'); expect(result.text).toContain('保质期十八个月'); expect(result.text).not.toContain('不应导入');
});

test('Word imports and evidence notes work after a genuine offline reload', async ({ page, context }) => {
  test.setTimeout(120_000); await closeLibrary(page); await page.locator('#library-settings').click();
  await page.locator('#persist-toggle').check(); await expect(page.locator('#storage-status')).toContainText('已保存');
  await page.locator('#prepare-offline').click(); await expect(page.locator('#offline-status')).toContainText('已就绪', { timeout: 90_000 });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller)); await page.locator('#library-dialog [data-close]').last().click();
  await context.setOffline(true); await page.reload(); await expect(page.locator('#question')).toBeEnabled(); await upload(page); await ask(page);
  await page.getByRole('button', { name: '收集本次证据', exact: true }).click(); await page.locator('#nav-research').click();
  await page.locator('.research-card textarea').first().fill('断网导入 Word 后写下的批注'); await page.locator('#close-research').click(); await page.locator('#library-settings').click();
  await expect(page.locator('#storage-status')).toContainText('已保存'); await page.reload(); await expect(page.locator('#question')).toBeEnabled();
  await page.locator('#nav-research').click(); await expect(page.locator('.research-card textarea').first()).toHaveValue('断网导入 Word 后写下的批注');
  await page.locator('.research-source button').first().click(); await expect(page.locator('#document-content mark')).toContainText('十八个月');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
