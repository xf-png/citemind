import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceMap, layoutEvidenceMap, exportEvidenceMapSvg } from '../dist/evidence-map.js';

const documents = [{ id: 'one', title: '同名来源', text: '白茶库存十箱。第二条记录。' }, { id: 'two', title: '同名来源', text: '白茶库存五箱。' }, { id: 'unused', title: '未收集的资料', text: '没有收集记录。' }];
function card(id, doc, question, { excerpt = doc.text, start = 0, ...fields } = {}) {
  return { id, question, stance: 'unclassified', note: '', createdAt: '2026-11-05T12:00:00.000Z', source: { id: doc.id, title: doc.title, excerpt, chunkId: `${doc.id}:chunk-1`, start, end: start + excerpt.length }, ...fields };
}
const research = cards => ({ title: '库存研究', cards });

test('Map edges preserve collection provenance, separate equal titles, and never infer uncollected links', () => {
  const input = research([card('a', documents[0], '白茶  库存？'), card('b', documents[0], ' 白茶 库存？ ', { excerpt: '第二条记录。', start: 7, stance: 'context' }), card('c', documents[1], '白茶 库存？', { stance: 'challenge' }), card('d', documents[1], '')]);
  const before = structuredClone(input); const map = buildEvidenceMap(input, documents);
  assert.deepEqual(input, before);
  assert.deepEqual(map.stats, { cards: 4, questions: 2, sources: 2, stale: 0, connections: 3 });
  assert.deepEqual(map.sources.map(source => source.documentId), ['one', 'two']);
  assert.deepEqual(map.edges[0].cardIds, ['a', 'b']); assert.equal(map.edges[0].stances.context, 1); assert.equal(map.edges[1].stances.challenge, 1);
  assert.equal(map.questions[1].label, '未记录具体问题');
  const filtered = buildEvidenceMap(input, documents, { query: '五箱', stance: 'challenge' });
  assert.equal(filtered.sources[0].id, map.sources[1].id); assert.equal(filtered.questions[0].id, map.questions[0].id);
  assert.deepEqual(filtered.cards.map(row => row.id), ['c']);
  assert.equal(buildEvidenceMap(input, documents.map(doc => doc.id === 'one' ? { ...doc, title: '更新后的名称' } : doc), { query: '更新后的名称' }).stats.cards, 2);
});

test('Missing, changed and misplaced PDF sources remain visible and can be isolated', () => {
  const pdf = { id: 'pdf', title: 'PDF', type: 'pdf', text: '第一页。第二页。', pages: [{ pageNumber: 1, start: 0, end: 4 }, { pageNumber: 2, start: 4, end: 8 }] };
  const input = research([card('missing', { id: 'gone', title: '已删除', text: '旧记录。' }, '库存'), card('changed', documents[0], '库存', { excerpt: '不匹配原文。' }), card('pdf', pdf, '页码', { excerpt: '第二页。', start: 4, source: { id: 'pdf', title: 'PDF', excerpt: '第二页。', chunkId: 'pdf:chunk-2', start: 4, end: 8, pageNumber: 1 } }), card('valid', documents[1], '库存', { note: '复查建议' })]);
  const map = buildEvidenceMap(input, [...documents, pdf], { status: 'stale' });
  assert.equal(map.stats.cards, 3); assert.equal(map.stats.stale, 3); assert.ok(map.edges.every(edge => edge.stale === edge.count));
  assert.deepEqual(map.cards.map(row => row.status), ['missing', 'changed', 'changed']);
  assert.deepEqual(buildEvidenceMap(input, [...documents, pdf], { status: 'valid', query: '复查建议' }).cards.map(row => row.id), ['valid']);
});

test('SVG export escapes labels, has no executable elements, and respects filters', () => {
  const doc = { id: 'bad', title: '<svg onload="evil()">&\u0001', text: '原文。' };
  const input = { title: '<script>evil()</script>', cards: [card('a', doc, '<img src=x onerror="evil()">', { stance: 'support' })] };
  const svg = exportEvidenceMapSvg(input, [doc]);
  assert.ok(svg.startsWith('<svg xmlns=')); assert.ok(svg.includes('&lt;script&gt;')); assert.ok(svg.includes('&lt;svg onload=&quot;evil()&quot;&gt;&amp;'));
  assert.doesNotMatch(svg, /<script|<img|<foreignObject|<a\s|\u0001|https?:\/\/(?!www\.w3\.org)/);
  const empty = exportEvidenceMapSvg(input, [doc], { stance: 'challenge' }); assert.ok(empty.includes('暂无符合条件')); assert.ok(!empty.includes('onload'));
  assert.throws(() => buildEvidenceMap(input, [doc], { stance: '__proto__' })); assert.throws(() => buildEvidenceMap(input, [doc], { query: 'x'.repeat(1001) }));
});

test('The full 100-card limit lays out without overlapping nodes or losing edges', () => {
  const input = research(Array.from({ length: 100 }, (_, i) => card(`c${i}`, { id: `d${i}`, title: `历史资料 ${i}`, text: `摘录 ${i}。` }, `问题 ${i}`)));
  const graph = buildEvidenceMap(input, []); const layout = layoutEvidenceMap(graph);
  assert.equal(layout.edges.length, 100); assert.equal(layout.questions.length, 100); assert.equal(layout.sources.length, 100);
  for (const lane of [layout.questions, layout.sources]) lane.forEach((node, i) => { assert.ok(Number.isFinite(node.y) && node.y >= 0 && node.y + node.height <= layout.height); if (i) assert.ok(node.y >= lane[i - 1].y + lane[i - 1].height); });
  assert.deepEqual(layout, layoutEvidenceMap(graph));
  assert.equal(buildEvidenceMap(research([]), documents).edges.length, 0);
});
