/** Reproducible, synthetic benchmark against this repository's v1.2 engine. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { retrieve as current, prepareDocuments } from '../dist/engine.js';

const reference = 'b002cf8515b468bc76a35d8c1a8bbba6b595bd33';
const source = execFileSync('git', ['show', `${reference}:dist/engine.js`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const { retrieve: baseline } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const topics = ['白茶库存十箱', '机器人电池维护', '资料隐私浏览器', '模型向量检索', '证据引用页码', '合同付款日期', '服务器备份恢复', '课程复习安排', '产品上线流程', '实验评估指标'];
const documents = Array.from({ length: 20 }, (_, index) => ({
  id: `doc-${index}`, title: `研究资料 ${index + 1} · ${topics[index % topics.length]}`,
  text: Array.from({ length: 140 }, (_, paragraph) => `第 ${paragraph + 1} 条记录：${topics[index % topics.length]}。方案 ${index + 1} 需要人工核对来源，记录实际操作和约束。${topics[(index + paragraph + 1) % topics.length]}。\n`).join(''),
}));
const questions = [...topics.map(topic => `${topic}如何处理？`), '未知行星的轨道倾角', 'source citation PDF', '隐私和备份如何核对？'];
const summary = rows => rows.map(({ id, chunkId, excerpt, score, start, end, pageNumber }) => ({ id, chunkId, excerpt, score, start, end, pageNumber }));

// Verify ordering, exact scores, text, IDs, and offsets, not only the top result.
for (const question of questions) assert.deepEqual(summary(current(question, documents)), summary(baseline(question, documents)), question);
const changed = documents.map(doc => ({ ...doc })); changed[0].text = '白茶库存已改为三箱。'; changed[0].title = '最新盘点';
for (const docs of [changed, documents.slice(0, 4), documents.toReversed(), documents]) {
  for (const question of questions.slice(0, 4)) assert.deepEqual(summary(current(question, docs)), summary(baseline(question, docs)), 'cache invalidation');
}

function measure(fn, rounds) {
  const samples = [];
  for (let round = 0; round < rounds; round++) for (const question of questions) {
    const started = performance.now(); fn(question, documents); samples.push(performance.now() - started);
  }
  const sorted = samples.toSorted((a, b) => a - b);
  return { samples: samples.length, medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)), p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(3)) };
}
current(questions[0], documents);
const baselineResult = measure(baseline, 3);
const currentResult = measure(current, 3);
const report = {
  measuredAt: new Date().toISOString(), runtime: process.version, platform: process.platform, baselineCommit: reference,
  corpus: { documents: documents.length, characters: documents.reduce((sum, doc) => sum + doc.text.length, 0), chunks: prepareDocuments(documents).reduce((sum, doc) => sum + doc.chunks.length, 0) },
  workload: 'Synthetic Chinese corpus, 13 fixed queries × 3 rounds per engine; warm lexical index. Does not measure model inference, browser startup or retrieval accuracy.',
  equivalentResults: true, equivalenceChecks: questions.length + 4 * 4, baseline: baselineResult, current: currentResult,
  medianSpeedup: Number((baselineResult.medianMs / currentResult.medianMs).toFixed(2)),
};
await mkdir(new URL('../qa/', import.meta.url), { recursive: true });
await writeFile(new URL('../qa/retrieval-benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
