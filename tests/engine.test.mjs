import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A data URL keeps the browser ESM engine testable without imposing package.json
// module settings on an unrelated parent workspace.
const moduleText = await readFile(new URL('../dist/engine.js', import.meta.url), 'utf8');
const { DEMO_DOCS, prepareDocuments, retrieve, answerQuestion, configureEmbedder } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString('base64')}`);
let checks = 0;
function check(name, fn) { return Promise.resolve().then(fn).then(() => { checks++; console.log(`PASS ${name}`); }); }

await check('Chinese retrieval ranks the matching privacy evidence', () => {
  const results = retrieve('文档会被上传到服务器吗？', DEMO_DOCS);
  assert.equal(results[0].id, 'privacy');
  assert.ok(results[0].excerpt.includes('不会上传'));
});

await check('Queries depend on document content rather than canned answers', async () => {
  const docs = [{ id: 'tea', title: '库存', text: '仓库仅有白茶和红茶，白茶库存为十箱。' }];
  const result = await answerQuestion({ question: '白茶库存是多少？', documents: docs });
  assert.ok(result.answer.includes('十箱'));
  assert.equal(result.sources[0].id, 'tea');
  assert.ok(!result.answer.includes('浏览器'));
});

await check('Every answer citation points at an actual returned source', async () => {
  const result = await answerQuestion({ question: '如何避免 AI 编造答案？', documents: DEMO_DOCS });
  assert.ok(result.sources.length > 0);
  assert.equal(result.sources[0].id, 'retrieval');
  assert.match(result.answer, /避免 AI 编造答案的核心做法是把输出限制为检索到的原文/);
  assert.ok(!result.answer.includes('第一阶段交付'));
  assert.ok(!result.answer.includes('证据是一个面向个人资料'));
  for (const match of result.answer.matchAll(/\[(\d+)\]/g)) assert.ok(result.sources[Number(match[1]) - 1]);
  for (const source of result.sources) {
    const doc = prepareDocuments(DEMO_DOCS).find(item => item.id === source.id);
    assert.ok(doc.text.includes(source.excerpt));
    assert.ok(doc.chunks.some(chunk => chunk.chunkId === source.chunkId));
  }
});

await check('Empty, absent, and unrelated questions yield no fabricated evidence', async () => {
  assert.equal((await answerQuestion({ question: '   ', documents: DEMO_DOCS })).sources.length, 0);
  assert.equal((await answerQuestion({ question: '白茶库存', documents: [] })).sources.length, 0);
  const unrelated = await answerQuestion({ question: '巴西足球队昨晚比分是多少？', documents: DEMO_DOCS });
  assert.equal(unrelated.sources.length, 0);
  assert.match(unrelated.answer, /没有找到/);
});

await check('Chunking retains original offsets and always makes progress', () => {
  const raw = [{ id: 'long', title: '长资料', text: '这里记录资料分块的原文。'.repeat(400) }];
  const doc = prepareDocuments(raw)[0];
  assert.ok(doc.chunks.length > 4);
  for (const chunk of doc.chunks) {
    assert.equal(doc.text.slice(chunk.start, chunk.end), chunk.text);
    assert.ok(chunk.text.length <= 420);
  }
  assert.equal(raw[0].chunks, undefined);
});

await check('Duplicate IDs are made distinct and stale chunks are ignored', () => {
  const docs = [{ id: 'same', title: '茶叶', text: '白茶库存十箱。', chunks: [{ text: '假引用' }] }, { id: 'same', title: '设备', text: '打印机库存五台。' }];
  const prepared = prepareDocuments(docs);
  assert.notEqual(prepared[0].id, prepared[1].id);
  assert.ok(retrieve('打印机库存', docs)[0].excerpt.includes('五台'));
  assert.ok(!JSON.stringify(retrieve('白茶库存', docs)).includes('假引用'));
});

await check('Text payloads remain inert plain strings, never executed', async () => {
  globalThis.__injected = false;
  const text = '仓库信息：<script>globalThis.__injected=true</script>白茶库存十箱。';
  const result = await answerQuestion({ question: '白茶库存', documents: [{ id: 'safe', title: '<img src=x>', text }] });
  assert.equal(globalThis.__injected, false);
  assert.ok(result.sources[0].excerpt.includes('<script>'));
});

await check('Semantic mode requires a real embedder and never silently downgrades', async () => {
  configureEmbedder(null);
  await assert.rejects(answerQuestion({ question: '白茶库存', documents: DEMO_DOCS, mode: 'semantic' }), /尚未加载/);
});

await check('Injected semantic embeddings are used and corpus vectors are cached', async () => {
  const calls = [];
  const embed = async texts => {
    calls.push([...texts]);
    return texts.map(text => /水果|苹果/u.test(text) ? [1, 0] : [0, 1]);
  };
  configureEmbedder(embed);
  const documents = [{ id: 'fruit', title: '水果清单', text: '新鲜苹果有五个。' }, { id: 'tools', title: '设备清单', text: '螺丝刀有三把。' }];
  const one = await answerQuestion({ question: '水果还剩多少？', documents, mode: 'semantic' });
  assert.equal(one.mode, 'semantic');
  assert.equal(one.sources[0].id, 'fruit');
  assert.ok(!one.sources.some(source => source.id === 'tools'));
  const callsAfterOne = calls.length;
  await answerQuestion({ question: '苹果数量？', documents, mode: 'semantic' });
  assert.equal(calls.length, callsAfterOne + 1);
  configureEmbedder(null);
});

await check('Broken embedding output yields a visible error', async () => {
  configureEmbedder(async () => [[Number.NaN]]);
  await assert.rejects(answerQuestion({ question: '检索', documents: DEMO_DOCS, mode: 'semantic' }), /向量/);
  configureEmbedder(null);
});

await check('English technical terms and zero-limit guard behave predictably', () => {
  assert.equal(retrieve('Recall@K MRR', DEMO_DOCS)[0].id, 'evaluation');
  assert.equal(retrieve('浏览器', DEMO_DOCS, { limit: 1 }).length, 1);
});

function pdfDocument(pageTexts) {
  let text = '';
  const pages = pageTexts.map((pageText, index) => {
    if (index) text += '\n\n';
    const start = text.length;
    text += pageText;
    return { pageNumber: index + 1, text: pageText, start, end: text.length };
  });
  return { id: 'manual', title: '设备手册.pdf', text, type: 'pdf', pages };
}

await check('PDF text and empty-page metadata survive without shifting offsets', () => {
  const raw = pdfDocument([`  Cafe\u0301 研究记录\r\n${'这一页介绍设备安装。'.repeat(60)}  `, '', '  激光打印机库存为五台。\r\n  ']);
  const doc = prepareDocuments([raw])[0];
  assert.equal(doc.text, raw.text);
  assert.deepEqual(doc.pages, raw.pages);
  assert.notEqual(doc.pages, raw.pages);
  assert.ok(doc.chunks.length > 2);
  assert.ok(!doc.chunks.some(chunk => chunk.pageNumber === 2));
  for (const chunk of doc.chunks) {
    const page = doc.pages.find(item => item.pageNumber === chunk.pageNumber);
    assert.ok(chunk.start >= page.start && chunk.end <= page.end);
    assert.equal(raw.text.slice(chunk.start, chunk.end), chunk.text);
  }
  assert.deepEqual(prepareDocuments([doc])[0].pages, raw.pages);
});

await check('PDF citations point to the exact page and original text offsets', async () => {
  const raw = pdfDocument(['  设备安装说明。\r\n', '', '  激光打印机库存为五台。\r\n  ']);
  const lexical = await answerQuestion({ question: '激光打印机库存是多少？', documents: [raw] });
  assert.ok(lexical.answer.includes('五台'));
  for (const source of lexical.sources) {
    assert.equal(source.pageNumber, 3);
    assert.equal(raw.text.slice(source.start, source.end), source.excerpt);
  }
  configureEmbedder(async texts => texts.map(() => [1, 0]));
  const semantic = await answerQuestion({ question: '激光打印机库存是多少？', documents: [raw], mode: 'semantic' });
  assert.equal(semantic.sources[0].pageNumber, 3);
  assert.equal(semantic.sources[0].excerpt, '激光打印机库存为五台。');
  assert.equal(raw.text.slice(semantic.sources[0].start, semantic.sources[0].end), semantic.sources[0].excerpt);
  configureEmbedder(null);
});

await check('Inconsistent PDF page metadata is rejected instead of mis-cited', () => {
  const raw = pdfDocument(['第一页。', '第二页。']);
  const changedText = structuredClone(raw);
  changedText.pages[0].text = '被改写。';
  assert.throws(() => prepareDocuments([changedText]), /PDF/);
  const overlapping = structuredClone(raw);
  overlapping.pages[1].start = 0;
  assert.throws(() => prepareDocuments([overlapping]), /PDF/);
  const duplicateNumber = structuredClone(raw);
  duplicateNumber.pages[1].pageNumber = 1;
  assert.throws(() => prepareDocuments([duplicateNumber]), /PDF/);
  const missingFirstPage = structuredClone(raw);
  missingFirstPage.pages[0].pageNumber = 3;
  assert.throws(() => prepareDocuments([missingFirstPage]), /PDF/);
  const inventedPage = structuredClone(raw);
  inventedPage.pages[1].pageNumber = 999;
  assert.throws(() => prepareDocuments([inventedPage]), /PDF/);
  assert.throws(() => prepareDocuments([pdfDocument(Array.from({ length: 81 }, () => '页内文字。'))]), /PDF/);
  const uncovered = structuredClone(raw);
  uncovered.text += '未映射到页码的事实。';
  assert.throws(() => prepareDocuments([uncovered]), /PDF/);
});

await check('Sentence embeddings resolve paraphrases and outrank broad chunk introductions', async () => {
  const question = 'How much is admission?';
  const alternate = 'What does entry cost?';
  const answer = '成人门票价格为一百二十元。';
  const intro = '这个旅行助手帮助游客规划游览行程。';
  const future = '未来计划增加在线购票和行程分享。';
  const documents = [{ id: 'intro', title: '旅行助手', text: intro }, { id: 'tickets', title: '票务说明', text: answer }, { id: 'plans', title: '迭代计划', text: future }];
  const calls = [];
  const vector = cosine => [cosine, Math.sqrt(1 - cosine ** 2)];
  configureEmbedder(async texts => {
    calls.push([...texts]);
    return texts.map(text => {
      if (text === question || text === alternate) return [1, 0];
      if (text.includes('\n')) return vector(text.includes(intro) ? 0.95 : text.includes(answer) ? 0.74 : 0.79);
      if (text === answer) return vector(0.98);
      return vector(text === intro ? 0.55 : 0.57);
    });
  });
  const result = await answerQuestion({ question, documents, mode: 'semantic' });
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, 'tickets');
  assert.equal(result.sources[0].excerpt, answer);
  assert.ok(result.answer.includes(answer));
  assert.ok(!result.answer.includes(intro));
  assert.ok(calls.some(batch => batch.includes(answer)));
  const before = calls.length;
  await answerQuestion({ question: alternate, documents, mode: 'semantic' });
  assert.equal(calls.length, before + 1, 'Only the new query should require embedding; chunk and sentence vectors are cached.');
  configureEmbedder(null);
});

await check('Semantic chunk matches alone cannot force unrelated sentence citations', async () => {
  const question = 'Can I return a damaged item?';
  const documents = [{ id: 'office', title: '办公说明', text: '办公室的会议室每周需要提前预约。' }];
  configureEmbedder(async texts => texts.map(text => text === question || text.includes('\n') ? [1, 0] : [0, 1]));
  const result = await answerQuestion({ question, documents, mode: 'semantic' });
  assert.equal(result.sources.length, 0);
  assert.match(result.answer, /没有找到/);
  configureEmbedder(null);
});

console.log(`${checks} checks passed.`);
