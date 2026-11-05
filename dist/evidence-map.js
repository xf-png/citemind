/** A provenance map of collected records, without inferred semantic links. */
import { STANCES, sourceStatus, validateResearch } from './research.js';

const questionKey = value => value.trim().replace(/\s+/g, ' ');
const counts = () => ({ unclassified: 0, support: 0, challenge: 0, context: 0 });

export function buildEvidenceMap(research, documents, { query = '', stance = 'all', status = 'all' } = {}) {
  const clean = validateResearch(research);
  if (typeof query !== 'string' || query.length > 1000) throw new TypeError('地图搜索词最多 1000 字。');
  if (stance !== 'all' && !Object.hasOwn(STANCES, stance)) throw new TypeError('地图标记筛选不正确。');
  if (!['all', 'valid', 'stale'].includes(status)) throw new TypeError('地图来源筛选不正确。');
  const questionIds = new Map(); const sourceIds = new Map();
  // Derive IDs before filtering so selection does not jump to a different node.
  clean.cards.forEach(card => {
    const key = questionKey(card.question);
    if (!questionIds.has(key)) questionIds.set(key, `q-${questionIds.size + 1}`);
    if (!sourceIds.has(card.source.id)) sourceIds.set(card.source.id, `s-${sourceIds.size + 1}`);
  });
  const needle = query.trim().toLocaleLowerCase();
  const cards = clean.cards.map(card => ({ ...card, status: sourceStatus(card.source, documents) })).filter(card =>
    (!needle || [card.question, card.note, card.source.title, documents.find(doc => doc.id === card.source.id)?.title || '', card.source.excerpt].join('\n').toLocaleLowerCase().includes(needle)) &&
    (stance === 'all' || card.stance === stance) &&
    (status === 'all' || (status === 'valid' ? card.status === 'valid' : card.status !== 'valid')));
  const questions = new Map(); const sources = new Map(); const edges = new Map();
  for (const card of cards) {
    const key = questionKey(card.question); const questionId = questionIds.get(key); const sourceId = sourceIds.get(card.source.id);
    if (!questions.has(questionId)) questions.set(questionId, { id: questionId, key, label: key || '未记录具体问题', count: 0, sourceIds: [] });
    if (!sources.has(sourceId)) sources.set(sourceId, { id: sourceId, documentId: card.source.id, label: documents.find(doc => doc.id === card.source.id)?.title || card.source.title, count: 0, stale: 0, questionIds: [] });
    const question = questions.get(questionId); const source = sources.get(sourceId);
    question.count++; source.count++; if (card.status !== 'valid') source.stale++;
    if (!question.sourceIds.includes(sourceId)) question.sourceIds.push(sourceId);
    if (!source.questionIds.includes(questionId)) source.questionIds.push(questionId);
    const edgeId = `${questionId}:${sourceId}`;
    if (!edges.has(edgeId)) edges.set(edgeId, { id: edgeId, questionId, sourceId, count: 0, stale: 0, stances: counts(), cardIds: [] });
    const edge = edges.get(edgeId); edge.count++; edge.cardIds.push(card.id); edge.stances[card.stance]++;
    if (card.status !== 'valid') edge.stale++;
  }
  return { title: clean.title, cards, questions: [...questions.values()], sources: [...sources.values()], edges: [...edges.values()], stats: { cards: cards.length, questions: questions.size, sources: sources.size, stale: cards.filter(card => card.status !== 'valid').length, connections: edges.size } };
}

export function layoutEvidenceMap(graph) {
  const height = Math.max(264, Math.max(graph.questions.length, graph.sources.length) * 72 + 32);
  const order = new Map(graph.questions.map((question, index) => [question.id, index]));
  const mean = source => source.questionIds.reduce((sum, id) => sum + order.get(id), 0) / source.questionIds.length;
  const sources = [...graph.sources].sort((a, b) => mean(a) - mean(b));
  const lane = (rows, x) => rows.map((row, index) => ({ ...row, x, y: 16 + (index + 0.5) * (height - 32) / rows.length - 28, width: 318, height: 56 }));
  const questions = lane(graph.questions, 16); const documents = lane(sources, 666);
  const nodes = new Map([...questions, ...documents].map(node => [node.id, node]));
  const edges = graph.edges.map(edge => {
    const a = nodes.get(edge.questionId); const b = nodes.get(edge.sourceId); const ay = a.y + 28; const by = b.y + 28;
    return { ...edge, path: `M 334 ${ay} C 450 ${ay}, 550 ${by}, 666 ${by}`, labelX: 500, labelY: (ay + by) / 2 };
  });
  return { width: 1000, height, questions, sources: documents, edges };
}

const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const short = (value, max) => { const chars = [...value]; return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : value; };

/** Self-contained inert SVG: no scripts, remote assets, links or foreignObject. */
export function exportEvidenceMapSvg(research, documents, filters = {}) {
  const graph = buildEvidenceMap(research, documents, filters); const layout = layoutEvidenceMap(graph);
  const height = layout.height + 184;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">${xml(graph.title)} · 证据地图</title><desc id="description">连线表示研究问题与已收集证据来源的关联，不表示支持或事实正确。来源待核对共 ${graph.stats.stale} 条。</desc>`,
    '<rect width="100%" height="100%" fill="#f8faff"/>', '<g font-family="system-ui,Segoe UI,Microsoft YaHei,sans-serif">',
    `<text x="24" y="34" font-size="21" font-weight="600" fill="#172a48">${xml(short(graph.title, 40))}</text>`,
    `<text x="24" y="60" font-size="12" fill="#687b96">CiteMind · ${graph.stats.questions} 个问题 · ${graph.stats.sources} 份来源 · ${graph.stats.cards} 条已收集证据 · ${graph.stats.stale} 条待核对</text>`,
    '<text x="24" y="96" font-size="11" fill="#5273b5">研究问题</text><text x="674" y="96" font-size="11" fill="#5273b5">资料来源</text>', '<g transform="translate(0,108)">'];
  if (!graph.cards.length) out.push('<text x="500" y="130" text-anchor="middle" font-size="15" fill="#687b96">暂无符合条件的已收集证据</text>');
  for (const edge of layout.edges) out.push(`<path d="${edge.path}" fill="none" stroke="${edge.stale ? '#c69a55' : '#9cb8ed'}" stroke-width="${Math.min(5, 1 + edge.count)}"${edge.stale ? ' stroke-dasharray="5 4"' : ''}><title>${edge.count} 条证据，${edge.stale} 条来源待核对</title></path>`);
  for (const item of [...layout.questions, ...layout.sources]) {
    const stale = item.stale > 0;
    out.push(`<g><title>${xml(item.label)} · ${item.count} 条证据${stale ? ` · ${item.stale} 条待核对` : ''}</title><rect x="${item.x}" y="${item.y}" width="318" height="56" rx="10" fill="#fff" stroke="${stale ? '#d9ba8d' : '#d8e3f4'}"/><text x="${item.x + 13}" y="${item.y + 20}" font-size="10" fill="#7890b4">${xml(item.id.toUpperCase())} · ${item.count} 条已收集证据${stale ? ` · ${item.stale} 条待核对` : ''}</text><text x="${item.x + 13}" y="${item.y + 41}" font-size="13" fill="#203b64">${xml(short(item.label, 22))}</text></g>`);
  }
  out.push('</g>', `<text x="24" y="${height - 24}" font-size="11" fill="#687b96">节点数字表示已收集证据条数；连线表示收集关联。当前筛选的图像快照，不替代完整 JSON 备份。</text>`, '</g></svg>');
  return out.join('\n');
}
