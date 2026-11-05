/** Local research artifacts. Quotes retain immutable UTF-16 source anchors. */
import { prepareDocuments, retrieveByDocument } from './engine.js';

export const STANCES = Object.freeze({ unclassified: '待整理', support: '支持', challenge: '存疑 / 反例', context: '背景' });
const MAX_CARDS = 100;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function string(value, max, label, empty = true) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new TypeError(`${label}格式不正确或超过 ${max} 字。`);
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError('证据收集时间不正确。');
  return value;
}

export function emptyResearch() { return { title: '我的研究笔记', cards: [] }; }

function validateSource(source) {
  if (!record(source)) throw new TypeError('证据来源格式不正确。');
  const clean = {
    id: string(source.id, 160, '来源标识', false),
    title: string(source.title, 200, '来源名称', false),
    excerpt: string(source.excerpt, 420, '原文摘录', false),
    chunkId: string(source.chunkId, 200, '片段标识', false),
    start: source.start, end: source.end,
  };
  if (!Number.isInteger(clean.start) || !Number.isInteger(clean.end) || clean.start < 0 || clean.end > 250_000 || clean.end - clean.start !== clean.excerpt.length) throw new TypeError('证据位置与摘录长度不一致。');
  if (source.pageNumber !== undefined) {
    if (!Number.isInteger(source.pageNumber) || source.pageNumber < 1 || source.pageNumber > 80) throw new TypeError('证据页码不正确。');
    clean.pageNumber = source.pageNumber;
  }
  return clean;
}

/** Whitelist portable fields; an imported quote is checked against sources later. */
export function validateResearch(value) {
  if (value === undefined) return emptyResearch();
  if (!record(value) || !Array.isArray(value.cards)) throw new TypeError('研究笔记格式不正确。');
  if (value.cards.length > MAX_CARDS) throw new RangeError('最多收集 100 条证据，请先导出整理。');
  const ids = new Set();
  const cards = value.cards.map(card => {
    if (!record(card) || !Object.hasOwn(STANCES, card.stance)) throw new TypeError('证据标记不正确。');
    const id = string(card.id, 160, '证据标识', false);
    if (ids.has(id)) throw new TypeError('证据标识重复。');
    ids.add(id);
    return { id, question: string(card.question, 1000, '研究问题'), note: string(card.note, 2000, '个人笔记'), stance: card.stance, createdAt: timestamp(card.createdAt), source: validateSource(card.source) };
  });
  return { title: string(value.title, 160, '笔记名称', false), cards };
}

export function sourceStatus(source, documents) {
  const doc = documents.find(row => row.id === source.id);
  if (!doc) return 'missing';
  if (doc.text.slice(source.start, source.end) !== source.excerpt) return 'changed';
  if (doc.type === 'pdf') {
    const page = doc.pages?.find(row => row.pageNumber === source.pageNumber);
    if (!page || source.start < page.start || source.end > page.end) return 'changed';
  } else if (source.pageNumber !== undefined) return 'changed';
  return 'valid';
}

export function sourceKey(source) { return JSON.stringify([source.id, source.start, source.end, source.excerpt, source.pageNumber ?? null]); }

export function collectEvidence(research, source, question, documents) {
  const clean = validateResearch(research);
  const anchor = validateSource(source);
  if (sourceStatus(anchor, documents) !== 'valid') throw new Error('来源已移除或变动，请重新检索后收集。');
  if (clean.cards.some(card => sourceKey(card.source) === sourceKey(anchor))) return clean;
  if (clean.cards.length >= MAX_CARDS) throw new RangeError('最多收集 100 条证据，请先导出整理。');
  clean.cards.push({ id: globalThis.crypto.randomUUID(), question: string(question, 1000, '研究问题'), note: '', stance: 'unclassified', createdAt: new Date().toISOString(), source: anchor });
  return clean;
}

/** Merge preserves existing notes and remaps source IDs when documents collide. */
export function mergeResearch(current, incoming, idMap = new Map()) {
  const merged = validateResearch(current);
  const restored = validateResearch(incoming);
  const ids = new Set(merged.cards.map(card => card.id));
  const anchors = new Set(merged.cards.map(card => sourceKey(card.source)));
  for (const card of restored.cards) {
    const previousId = card.source.id;
    card.source.id = idMap.get(previousId) || previousId;
    if (card.source.id !== previousId && card.source.chunkId.startsWith(`${previousId}:chunk-`)) card.source.chunkId = card.source.id + card.source.chunkId.slice(previousId.length);
    const key = sourceKey(card.source);
    if (anchors.has(key)) continue;
    if (ids.has(card.id)) card.id = globalThis.crypto.randomUUID();
    ids.add(card.id); anchors.add(key); merged.cards.push(card);
  }
  return validateResearch(merged);
}

const md = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*{}\[\]()#+.!_|~]/g, '\\$&').replace(/\r?\n/g, ' ');
const quote = text => String(text).split(/\r?\n/).map(line => `> ${md(line)}`).join('\n');
const statusLabels = { valid: '已对照当前原文', missing: '来源已移除，保留收集时的摘录', changed: '来源已变动，待重新核对' };
function provenance(source, documents) {
  return `${md(source.title)}${source.pageNumber ? ` · PDF 第 ${source.pageNumber} 页` : ''} · 原文位置 ${source.start}–${source.end}（UTF-16，起点从 0 计） · ${statusLabels[sourceStatus(source, documents)]}`;
}

export function exportResearchMarkdown(research, documents) {
  const clean = validateResearch(research);
  const lines = [`# ${md(clean.title)}`, '', 'CiteMind 研究笔记 · 原文摘录与个人整理。支持、存疑等标记由用户填写，不是自动事实判定。', ''];
  for (const [index, card] of clean.cards.entries()) {
    lines.push(`## ${index + 1}. ${md(card.question || '收集的证据')}`, '', `人工标记：${STANCES[card.stance]}`, '', quote(card.source.excerpt), '', `来源：${provenance(card.source, documents)}`, `片段：${md(card.source.chunkId)} · 收集于 ${card.createdAt}`, '', `个人笔记：${md(card.note || '尚未填写')}`, '');
  }
  return lines.join('\n');
}

/** Independent keyword searches per source expose gaps instead of inventing comparisons. */
export function compareDocuments({ questions, documents, documentIds } = {}) {
  if (!Array.isArray(questions) || !questions.length || questions.length > 6) throw new RangeError('请输入 1–6 个问题，每行一个。');
  const unique = [...new Set(questions.map(q => string(q, 200, '对照问题', false).trim()))];
  if (!Array.isArray(documentIds) || !documentIds.every(id => typeof id === 'string')) throw new TypeError('请选择参与对照的资料。');
  const selected = prepareDocuments(documents).filter(doc => documentIds.includes(doc.id));
  if (!selected.length) throw new Error('请先勾选至少一份资料。');
  return { documents: selected.map(({ id, title }) => ({ id, title })), rows: unique.map(question => ({ question, cells: retrieveByDocument(question, selected) })) };
}

export function exportComparisonMarkdown(comparison, documents) {
  const lines = ['# CiteMind · 资料对照', '', '每个问题分别在每份资料内进行快速检索。空白表示未找到足够相关的片段，不代表该资料一定没有答案；相近或不同的摘录不自动构成共识或矛盾。', ''];
  for (const row of comparison.rows) {
    lines.push(`## ${md(row.question)}`, '');
    for (const [index, cell] of row.cells.entries()) {
      lines.push(`### ${md(comparison.documents[index].title)}`, '');
      if (!cell.sources.length) lines.push('未找到足够相关的片段。', '');
      for (const source of cell.sources) lines.push(quote(source.excerpt), '', `来源：${provenance(source, documents)}`, '');
    }
  }
  return lines.join('\n');
}
