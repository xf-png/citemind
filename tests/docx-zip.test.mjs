import test from 'node:test';
import assert from 'node:assert/strict';
import { openDocxArchive, DOCX_LIMITS } from '../dist/docx-zip.js';
import { makeZip } from './helpers/zip-fixture.mjs';

test('ZIP reader handles stored, DEFLATE and data-descriptor entries with native CRC agreement', async () => {
  const archive = openDocxArchive(makeZip([{ name: 'stored.xml', text: '中文与 emoji 📚', method: 0 }, { name: 'compressed.xml', text: '真实压缩内容。'.repeat(100) }, { name: 'descriptor.xml', text: '流式写入', flags: 0x808 }], { comment: 'archive comment' }));
  assert.equal(new TextDecoder().decode(await archive.read('stored.xml')), '中文与 emoji 📚');
  assert.equal(new TextDecoder().decode(await archive.read('compressed.xml')), '真实压缩内容。'.repeat(100));
  assert.equal(new TextDecoder().decode(await archive.read('descriptor.xml')), '流式写入'); assert.equal(await archive.read('absent.xml'), null);
});

test('ZIP reader rejects truncated records and detects damaged stored bytes', async () => {
  const zip = makeZip([{ name: 'document.xml', text: 'original', method: 0 }]);
  for (const length of [0, 10, zip.length - 1, zip.length - 23]) assert.throws(() => openDocxArchive(zip.subarray(0, length)), { name: 'DocxImportError' });
  const bad = Buffer.from(zip); bad[30 + Buffer.byteLength('document.xml')] ^= 1;
  await assert.rejects(openDocxArchive(bad).read('document.xml'), { code: 'DOCX_CHECKSUM' });
});

test('ZIP reader rejects encryption, ZIP64, path aliases and duplicate part names', () => {
  assert.throws(() => openDocxArchive(makeZip([{ name: 'a', text: 'x', flags: 0x801 }])), { code: 'DOCX_ENCRYPTED' });
  const zip64 = makeZip([{ name: 'a', text: 'x' }]); zip64.writeUInt32LE(0xffffffff, zip64.length - 22 + 16); assert.throws(() => openDocxArchive(zip64), { code: 'DOCX_UNSUPPORTED' });
  for (const name of ['../document.xml', '/document.xml', 'word\\document.xml', 'word/./document.xml']) assert.throws(() => openDocxArchive(makeZip([{ name, text: 'x' }])), { name: 'DocxImportError' });
  assert.throws(() => openDocxArchive(makeZip([{ name: 'a', text: 'x' }, { name: 'a', text: 'y' }])), { name: 'DocxImportError' });
});

test('ZIP limits cover declared totals and actual inflation, including forged small declarations', async () => {
  assert.throws(() => openDocxArchive(makeZip([{ name: 'a', text: 'x', declaredSize: DOCX_LIMITS.expanded + 1 }])), { code: 'DOCX_EXPANDED_LIMIT' });
  assert.throws(() => openDocxArchive(makeZip(Array.from({ length: DOCX_LIMITS.entries + 1 }, (_, index) => ({ name: `part${index}`, text: '' })))), { code: 'DOCX_ENTRY_LIMIT' });
  const archive = openDocxArchive(makeZip([{ name: 'forged.xml', text: 'x'.repeat(200000), declaredSize: 10 }]));
  await assert.rejects(archive.read('forged.xml', 1024), { code: 'DOCX_XML_LIMIT' });
  await assert.rejects(openDocxArchive(makeZip([{ name: 'large.xml', text: 'x'.repeat(4096) }])).read('large.xml', 1024), { code: 'DOCX_XML_LIMIT' });
});

test('ZIP access respects cancellation before opening and while inflating a part', async () => {
  const zip = makeZip([{ name: 'part.xml', text: 'x'.repeat(200000) }]); const cancelled = new AbortController(); cancelled.abort();
  assert.throws(() => openDocxArchive(zip, { signal: cancelled.signal }), { name: 'AbortError' });
  const controller = new AbortController(); const promise = openDocxArchive(zip, { signal: controller.signal }).read('part.xml'); controller.abort(); await assert.rejects(promise, { name: 'AbortError' });
});
