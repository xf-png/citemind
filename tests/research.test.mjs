import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DOCS, prepareDocuments, retrieve, answerQuestion, configureEmbedder } from '../dist/engine.js';
import { emptyResearch, validateResearch, collectEvidence, sourceStatus, mergeResearch, compareDocuments, exportResearchMarkdown, exportComparisonMarkdown } from '../dist/research.js';
import { serializeBackup, parseWorkspaceBackup } from '../dist/storage.js';

const documents = prepareDocuments([
  { id: 'a', title: '甲方方案', text: '白茶库存为十箱。资料只在浏览器保存，不会上传服务器。' },
  { id: 'b', title: '乙方方案', text: '白茶库存为五箱。资料保存在远程服务器。' },
]);
const source = retrieve('白茶库存', documents)[0];
const collected = () => collectEvidence(emptyResearch(), source, '白茶库存多少？', documents);

test('Scope is enforced before ranking, including an explicitly empty selection', async () => {
  assert.ok(retrieve('白茶库存', documents, { documentIds: ['b'] }).every(row => row.id === 'b'));
  assert.deepEqual(retrieve('白茶库存', documents, { documentIds: [] }), []);
  assert.deepEqual(retrieve('白茶库存', documents, { documentIds: ['unknown'] }), []);
  const result = await answerQuestion({ question: '白茶库存', documents, documentIds: ['b'] });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, 'b');
  assert.ok(!result.answer.includes('十箱'));
  assert.equal((await answerQuestion({ question: '白茶库存', documents, documentIds: [] })).sources.length, 0);
  assert.throws(() => retrieve('白茶', documents, { documentIds: null }), /检索范围/);
});

test('Semantic search never embeds excluded documents', async () => {
  const seen = [];
  configureEmbedder(async texts => { seen.push(...texts); return texts.map(() => [1, 0]); });
  try {
    const result = await answerQuestion({ question: '白茶库存', documents, documentIds: ['b'], mode: 'semantic' });
    assert.ok(result.sources.every(row => row.id === 'b'));
    assert.ok(!seen.some(text => text.includes('十箱') || text.includes('甲方')));
  } finally { configureEmbedder(null); }
});

test('Collection is immutable, deduplicated by exact anchor, and rejects forged quotes', () => {
  const empty = emptyResearch();
  const notes = collectEvidence(empty, source, '库存', documents);
  assert.equal(empty.cards.length, 0);
  assert.equal(notes.cards.length, 1);
  assert.equal(collectEvidence(notes, { ...source, score: 0.99 }, '第二次提问', documents).cards.length, 1);
  assert.throws(() => collectEvidence(notes, { ...source, excerpt: '伪造', end: source.start + 2 }, '库存', documents), /重新检索/);
  assert.throws(() => collectEvidence(notes, source, '库存', []), /重新检索/);
});

test('Evidence explicitly distinguishes missing sources from changed text or PDF pages', () => {
  assert.equal(sourceStatus(source, documents), 'valid');
  assert.equal(sourceStatus(source, []), 'missing');
  assert.equal(sourceStatus(source, documents.map(doc => ({ ...doc, text: '改动' + doc.text }))), 'changed');
  const first = '第一页无库存。'; const second = '第二页白茶库存十箱。'; const text = first + '\n' + second;
  const pdf = prepareDocuments([{ id: 'pdf', title: '分页资料', type: 'pdf', text, pages: [{ pageNumber: 1, text: first, start: 0, end: first.length }, { pageNumber: 2, text: second, start: first.length + 1, end: text.length }] }]);
  const cite = retrieve('白茶库存', pdf)[0];
  assert.equal(cite.pageNumber, 2);
  assert.equal(sourceStatus(cite, pdf), 'valid');
  assert.equal(sourceStatus({ ...cite, pageNumber: 1 }, pdf), 'changed');
  assert.equal(sourceStatus({ ...source, pageNumber: 1 }, documents), 'changed');
});

test('Backups preserve notes and source anchors while accepting old v1 backups', () => {
  const research = collected(); research.cards[0].note = '需要核实盘点日期'; research.cards[0].stance = 'challenge';
  const restored = parseWorkspaceBackup(serializeBackup(documents, research));
  assert.deepEqual(restored.research, research);
  assert.equal(sourceStatus(restored.research.cards[0].source, restored.documents), 'valid');
  const old = JSON.parse(serializeBackup(documents)); delete old.research;
  assert.deepEqual(parseWorkspaceBackup(JSON.stringify(old)).research, emptyResearch());
  assert.deepEqual(Object.keys(restored.research.cards[0].source).sort(), ['chunkId', 'end', 'excerpt', 'id', 'start', 'title']);
});

test('Imported notes enforce limits and whitelist fields without trusting anchors', () => {
  const notes = collected(); notes.cards[0].html = '<script>secret</script>';
  const clean = validateResearch(notes); assert.equal(clean.cards[0].html, undefined);
  for (const change of [{ note: 'a'.repeat(2001) }, { stance: '__proto__' }, { id: '' }, { createdAt: 'yesterday' }]) {
    assert.throws(() => validateResearch({ ...notes, cards: [{ ...notes.cards[0], ...change }] }));
  }
  assert.throws(() => validateResearch({ ...notes, cards: [...notes.cards, ...notes.cards] }), /重复/);
  assert.throws(() => validateResearch({ ...notes, title: 'a'.repeat(161) }));
  assert.throws(() => validateResearch({ ...notes, cards: Array.from({ length: 101 }, (_, i) => ({ ...notes.cards[0], id: String(i) })) }), /100/);
  const imported = validateResearch({ ...notes, cards: [{ ...notes.cards[0], source: { ...source, excerpt: 'X'.repeat(source.excerpt.length) } }] });
  assert.equal(sourceStatus(imported.cards[0].source, documents), 'changed');
});

test('Merging maps references to the merged document and retains existing annotations', () => {
  const notes = collected(); notes.cards[0].note = '已有笔记';
  const incoming = collected(); incoming.cards[0].note = '导入的笔记';
  assert.equal(mergeResearch(notes, incoming).cards.length, 1);
  assert.equal(mergeResearch(notes, incoming).cards[0].note, '已有笔记');
  const merged = mergeResearch(emptyResearch(), incoming, new Map([[source.id, 'remapped']]));
  assert.equal(merged.cards[0].source.id, 'remapped');
  assert.equal(merged.cards[0].source.chunkId, 'remapped:chunk-1');
  assert.equal(incoming.cards[0].source.id, source.id);
});

test('Comparison retains separate source claims, true gaps, scope, and exact citations', () => {
  const matrix = compareDocuments({ questions: ['白茶库存多少？', '白茶库存多少？', '火星轨道倾角'], documents, documentIds: ['a', 'b'] });
  assert.equal(matrix.rows.length, 2); assert.equal(matrix.rows[0].cells.length, 2);
  assert.ok(matrix.rows[0].cells[0].sources[0].excerpt.includes('十箱'));
  assert.ok(matrix.rows[0].cells[1].sources[0].excerpt.includes('五箱'));
  assert.ok(matrix.rows[1].cells.every(cell => cell.sources.length === 0));
  for (const row of matrix.rows) for (const cell of row.cells) for (const cite of cell.sources) assert.equal(sourceStatus(cite, documents), 'valid');
  assert.deepEqual(compareDocuments({ questions: ['库存'], documents, documentIds: ['b'] }).documents.map(d => d.id), ['b']);
  assert.throws(() => compareDocuments({ questions: ['库存'], documents, documentIds: [] }), /勾选/);
  assert.throws(() => compareDocuments({ questions: Array(7).fill('库存'), documents, documentIds: ['a'] }), /1–6/);
});

test('Markdown reports escape HTML, preserve provenance and disclose stale quotes', () => {
  const notes = collected(); notes.title = '<img src=x>'; notes.cards[0].note = '[click](javascript:alert(1))\n# injected';
  const report = exportResearchMarkdown(notes, []);
  assert.ok(!report.includes('<img'));
  assert.ok(!report.includes('[click](javascript:'));
  assert.ok(!report.includes('\n# injected'));
  assert.match(report, /来源已移除/); assert.match(report, /UTF-16/); assert.match(report, /个人笔记/);
  const comparison = compareDocuments({ questions: ['白茶库存', '火星轨道'], documents, documentIds: ['a'] });
  const exported = exportComparisonMarkdown(comparison, documents);
  assert.match(exported, /十箱/); assert.match(exported, /未找到足够相关/); assert.match(exported, /不自动构成共识或矛盾/);
});

test('Comparison uses shared statistics and exact sentences, rather than generic document mentions', () => {
  const matrix = compareDocuments({ questions: ['文档会被上传吗？'], documents: DEMO_DOCS, documentIds: DEMO_DOCS.map(doc => doc.id) });
  const privacy = matrix.rows[0].cells.find(cell => cell.documentId === 'privacy');
  assert.equal(privacy.sources.length, 1);
  assert.match(privacy.sources[0].excerpt, /不会上传/);
  assert.ok(privacy.sources[0].excerpt.length < 180);
  assert.equal(sourceStatus(privacy.sources[0], prepareDocuments(DEMO_DOCS)), 'valid');
  assert.equal(matrix.rows[0].cells.find(cell => cell.documentId === 'evaluation').sources.length, 0);
});
