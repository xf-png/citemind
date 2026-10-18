import assert from 'node:assert/strict';
import { validateLibrary, serializeBackup, parseBackup, persistenceEnabled, setPersistenceEnabled, readLibrary, writeLibrary } from '../dist/storage.js';
import { retrieve } from '../dist/engine.js';

let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}
const note = { id: 'notes', title: '中文知识库', text: '仓库有十箱白茶，库存仅在本机处理。' };
const envelope = documents => ({ format: 'citemind.knowledge-base', version: 1, exportedAt: '2026-10-16T08:00:00.000Z', documents });

await check('Empty library is a valid backup and its schema is explicitly versioned', () => {
  assert.deepEqual(parseBackup(serializeBackup([])), []);
  for (const change of [{ format: 'unknown' }, { version: 2 }, { version: '1' }, { exportedAt: null }, { documents: {} }]) {
    assert.throws(() => parseBackup(JSON.stringify({ ...envelope([]), ...change })));
  }
  for (const text of ['not JSON', 'null', '[]', '{}']) assert.throws(() => parseBackup(text));
  assert.throws(() => parseBackup(new String('{}')), /JSON/);
});

await check('Chinese and HTML-looking content remain inert through backup roundtrip', () => {
  globalThis.__storageInjected = false;
  const raw = [{ ...note, title: '<img src=x onerror=__storageInjected=true>中文', text: '库存：<script>globalThis.__storageInjected=true</script>白茶有十箱。' }];
  const restored = parseBackup(serializeBackup(raw));
  assert.equal(restored[0].text, raw[0].text);
  assert.equal(restored[0].title, raw[0].title);
  assert.equal(globalThis.__storageInjected, false);
  assert.equal(restored[0].chunks[0].text, raw[0].text);
  delete globalThis.__storageInjected;
});

await check('Backups omit untrusted chunks, vectors, original files, and chat history', () => {
  const raw = [{ ...note, chunks: [{ text: '伪造的引用' }], embeddings: [[1, 2]], rawPDF: 'secret', chat: ['secret'], extra: { ignored: true } }];
  const json = JSON.parse(serializeBackup(raw));
  assert.deepEqual(Object.keys(json.documents[0]).sort(), ['id', 'text', 'title']);
  const restored = parseBackup(JSON.stringify({ ...envelope(raw), chat: ['secret'] }));
  assert.deepEqual(Object.keys(restored[0]).sort(), ['chunks', 'id', 'text', 'title']);
  assert.ok(!JSON.stringify(restored).includes('伪造'));
  assert.equal(retrieve('白茶库存', restored)[0].excerpt, note.text);
});

await check('PDF roundtrip keeps exact UTF-16 page text and citation offsets', () => {
  const first = '  第一页😀，白茶库存十箱。\r\n';
  const separator = '\n\n';
  const second = '第二页记录：咖啡 e\u0301 的库存五袋。  ';
  const text = first + separator + second;
  const pages = [{ pageNumber: 1, text: first, start: 0, end: first.length }, { pageNumber: 2, text: '', start: first.length + 1, end: first.length + 1 }, { pageNumber: 3, text: second, start: first.length + separator.length, end: text.length }];
  const [doc] = parseBackup(serializeBackup([{ id: 'pdf', title: '库存.pdf', text, type: 'pdf', pages }]));
  assert.equal(doc.text, text);
  assert.deepEqual(doc.pages, pages);
  assert.ok(!doc.chunks.some(chunk => chunk.pageNumber === 2));
  const source = retrieve('咖啡库存五袋', [doc])[0];
  assert.equal(source.pageNumber, 3);
  assert.equal(doc.text.slice(source.start, source.end), source.excerpt);
  for (const chunk of doc.chunks) {
    const page = doc.pages.find(row => row.pageNumber === chunk.pageNumber);
    assert.ok(chunk.start >= page.start && chunk.end <= page.end);
    assert.equal(doc.text.slice(chunk.start, chunk.end), chunk.text);
  }
});

await check('Malformed PDF metadata is rejected before library replacement', () => {
  const base = { id: 'pdf', title: '文档.pdf', type: 'pdf', text: '第一页\n第二页', pages: [{ pageNumber: 1, text: '第一页', start: 0, end: 3 }, { pageNumber: 2, text: '第二页', start: 4, end: 7 }] };
  assert.equal(validateLibrary([base]).length, 1);
  for (const pages of [undefined, [], [null], [{ ...base.pages[0], text: '伪造' }], [{ ...base.pages[0], start: -1 }], [{ ...base.pages[0], pageNumber: 1.5 }], [base.pages[0], { ...base.pages[1], pageNumber: 1 }], [{ ...base.pages[1], start: 0 }]]) {
    assert.throws(() => parseBackup(JSON.stringify(envelope([{ ...base, pages }]))));
  }
});

await check('Library limits are enforced on raw data before indexing', () => {
  assert.throws(() => validateLibrary(Array.from({ length: 21 }, (_, i) => ({ ...note, id: `doc-${i}` }))), /20/);
  assert.throws(() => validateLibrary([{ ...note, text: '字'.repeat(100_001) }]), /100,000/);
  assert.throws(() => validateLibrary(Array.from({ length: 3 }, (_, i) => ({ ...note, id: `doc-${i}`, text: '字'.repeat(90_000) }))), /250,000/);
  assert.throws(() => parseBackup(' '.repeat(6 * 1024 * 1024 + 1)), /6 MB/);
});

await check('Invalid field types, oversized identifiers, and duplicate IDs fail cleanly', () => {
  for (const changes of [{ id: 7 }, { id: '' }, { id: 'x'.repeat(161) }, { title: {} }, { title: ' ' }, { title: 'x'.repeat(201) }, { text: null }, { type: 'html' }]) {
    assert.throws(() => validateLibrary([{ ...note, ...changes }]));
  }
  assert.throws(() => validateLibrary([note, { ...note }]), /标识重复/);
  assert.throws(() => validateLibrary([{ ...note, id: 'bad\u0000id' }]), /标识/);
  assert.throws(() => validateLibrary({ documents: [] }));
});

await check('Persistence stays off by default and cannot claim success without saved preference', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalIDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let stored;
  let opened = false;
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored ?? null, setItem: (key, value) => { assert.equal(key, 'citemind.persistence.enabled'); stored = value; } } });
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { opened = true; throw new Error('IDB must remain untouched while opted out'); } });
    assert.equal(persistenceEnabled(), false);
    assert.equal(await readLibrary(), null);
    await assert.rejects(writeLibrary([note]), /先开启/);
    assert.equal(opened, false);
    setPersistenceEnabled(true);
    assert.equal(stored, 'true');
    assert.equal(persistenceEnabled(), true);
    setPersistenceEnabled(false);
    assert.equal(stored, 'false');
    assert.throws(() => setPersistenceEnabled('true'), /布尔值/);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage disabled'); } });
    assert.equal(persistenceEnabled(), false);
    assert.throws(() => setPersistenceEnabled(true), /无法保存/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
    if (originalIDB) Object.defineProperty(globalThis, 'indexedDB', originalIDB); else delete globalThis.indexedDB;
  }
});

console.log(`${checks} storage checks passed.`);
