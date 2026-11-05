import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportSnapshot, exportResearchHtml } from '../dist/research-report.js';

const date = '2026-11-06T00:00:00.000Z';
const doc = { id: 'a', title: '库存资料', text: '白茶库存十箱，保质期十八个月。正文未收集的内容。' };
function card(id, start, end, question = '库存', source = doc, note = '需要核对') {
  return { id, question, stance: 'context', note, createdAt: date, source: { id: source.id, title: source.title, excerpt: source.text.slice(start, end), start, end, chunkId: `${source.id}:chunk-1` } };
}
const research = { title: '库存核对', cards: [card('one', 0, 7), card('two', 4, 15, ' 库存 ')] };

test('Report snapshots group questions, preserve separate sources and retain stale records', () => {
  const missing = { id: 'missing', title: doc.title, text: '旧记录。' };
  const changed = card('changed', 0, 7); changed.source.excerpt = '现已变动的记录';
  const input = { title: '核对', cards: [...research.cards, card('old', 0, missing.text.length, '历史', missing), changed] };
  const before = JSON.stringify(input); const snapshot = buildReportSnapshot(input, [doc]);
  assert.deepEqual(snapshot.stats, { cards: 4, questions: 2, sources: 2, stale: 2 });
  assert.deepEqual(snapshot.cards.map(row => row.status), ['valid', 'valid', 'missing', 'changed']);
  assert.equal(snapshot.groups[0].cards.length, 3); assert.equal(JSON.stringify(input), before);
});

test('Portable report omits uncollected text by default and includes only cited sources on opt-in', () => {
  const unrelated = { id: 'private', title: '无关资料', text: '不应混入报告的秘密。' };
  const minimal = exportResearchHtml(research, [doc, unrelated], { exportedAt: date });
  assert.ok(minimal.includes('仅含已收集摘录与个人笔记')); assert.ok(!minimal.includes('正文未收集的内容')); assert.ok(!minimal.includes(unrelated.text));
  const complete = exportResearchHtml(research, [doc, unrelated], { includeSources: true, exportedAt: date });
  assert.ok(complete.includes('正文未收集的内容')); assert.ok(!complete.includes(unrelated.text));
  assert.match(complete, /id="quote-1"/); assert.match(complete, /id="quote-2"/); assert.match(complete, /href="#quote-2"/);
  // Overlapping excerpts highlight a shared source once; no duplicated text or nested marks.
  const full = complete.match(/<div class="full-source">([\s\S]*?)<\/div>/)[1];
  assert.equal(full.replace(/<[^>]*>/g, ''), doc.text); assert.ok(!full.includes('<mark><mark>'));
});

test('Untrusted report labels cannot introduce markup, navigation or scripts', () => {
  const evil = '</title><script>window.bad=1</script><img src="https://outside.invalid/x">';
  const item = card('evil', 0, 7, evil, { ...doc, title: evil }, evil); const html = exportResearchHtml({ title: evil, cards: [item] }, [doc], { exportedAt: date });
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script')); assert.ok(!html.includes('<img')); assert.ok(!html.includes('href="https:'));
  assert.match(html, /default-src 'none'/); assert.match(html, /base-uri 'none'/); assert.match(html, /form-action 'none'/);
  assert.throws(() => exportResearchHtml(research, [doc], { includeSources: 'yes' }), TypeError);
  assert.throws(() => exportResearchHtml(research, [doc], { exportedAt: 'yesterday' }), TypeError);
});

test('Missing or changed anchors never gain a full-source link, while actual PDF pages remain explicit', () => {
  const pdf = { id: 'pdf', title: '分页资料', type: 'pdf', text: '第一页。\n白茶十箱。', pages: [{ pageNumber: 1, text: '第一页。', start: 0, end: 4 }, { pageNumber: 2, text: '白茶十箱。', start: 5, end: 10 }] };
  const correct = card('pdf-quote', 5, 10, '库存', pdf); correct.source.pageNumber = 2;
  const badPage = structuredClone(correct); badPage.id = 'bad-page'; badPage.source.pageNumber = 1;
  const html = exportResearchHtml({ title: '分页', cards: [correct, badPage] }, [pdf], { includeSources: true, exportedAt: date });
  assert.ok(html.includes('PDF 第 2 页')); assert.ok(html.includes('页码已变动')); assert.ok(html.includes('href="#quote-1"')); assert.ok(!html.includes('href="#quote-2"')); assert.ok(!html.includes('id="quote-2"'));
});
