/** Portable, script-free research reports. Every user value becomes escaped text. */
import { prepareDocuments } from './engine.js';
import { STANCES, validateResearch, sourceStatus } from './research.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const labels = { valid: '导出时与当前文字一致', missing: '来源已移除，摘录尚未核对', changed: '来源或页码已变动，摘录尚未核对' };
const position = source => `${source.pageNumber ? `PDF 第 ${source.pageNumber} 页 · ` : ''}UTF-16 位置 ${source.start}–${source.end}（从 0 计，终点不含）`;
const key = question => question.replace(/\s+/gu, ' ').trim() || '收集的证据';

export function buildReportSnapshot(research, documents) {
  const clean = validateResearch(research); const docs = prepareDocuments(documents); const groups = new Map(); const sources = new Map();
  const cards = clean.cards.map((card, index) => {
    const row = { ...card, number: index + 1, status: sourceStatus(card.source, docs) };
    if (!sources.has(card.source.id)) sources.set(card.source.id, { number: sources.size + 1, title: card.source.title, document: docs.find(doc => doc.id === card.source.id), cards: [] });
    const source = sources.get(card.source.id); source.cards.push(row); row.sourceNumber = source.number;
    const question = key(card.question); if (!groups.has(question)) groups.set(question, { question, number: groups.size + 1, cards: [] }); groups.get(question).cards.push(row);
    return row;
  });
  return { title: clean.title, groups: [...groups.values()], sources: [...sources.values()], cards, stats: { cards: cards.length, questions: groups.size, sources: sources.size, stale: cards.filter(card => card.status !== 'valid').length } };
}

/** Mark every matching quote, including overlaps, without repeating the source. */
function markedText(document, cards) {
  const valid = cards.filter(card => card.status === 'valid');
  const points = [...new Set([0, document.text.length, ...valid.flatMap(card => [card.source.start, card.source.end])])].sort((a, b) => a - b);
  let html = '';
  for (let index = 0; index < points.length; index++) {
    const at = points[index];
    for (const card of valid.filter(card => card.source.start === at)) html += `<span id="quote-${card.number}" class="anchor"></span>`;
    if (index === points.length - 1) continue;
    const next = points[index + 1]; const text = escape(document.text.slice(at, next));
    html += valid.some(card => card.source.start <= at && card.source.end >= next) ? `<mark>${text}</mark>` : text;
  }
  return html;
}

const css = `:root{color-scheme:light;--ink:#1d314b;--muted:#65758b;--blue:#285ee7;--line:#dde5ef}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f4f6fa;color:var(--ink);font:15px/1.8 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1040px;margin:auto;padding:48px 42px 64px;background:#fff;min-height:100vh}h1{font-size:38px;line-height:1.4;margin:12px 0 20px;letter-spacing:-.8px}h2{font-size:24px;line-height:1.6;margin:0 0 20px}h3{font-size:17px;line-height:1.7;margin:0}h1,h2,h3,p,li,dd,dt,blockquote,summary{overflow-wrap:anywhere}.eyebrow{font-size:11px;letter-spacing:2px;color:var(--blue);font-weight:700}.lede{font-size:16px;color:var(--muted);max-width:760px}.meta{font-size:12px;color:var(--muted)}a{color:#2354c0;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #83a9ff;outline-offset:4px}.stats{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:12px;margin:28px 0}.stats div{padding:18px 22px}.stats div+div{border-left:1px solid var(--line)}.stats b{display:block;font-size:26px}.stats span{font-size:12px;color:var(--muted)}.notice{border-left:3px solid #9cbaef;padding:12px 18px;background:#f5f8fe;font-size:13px;color:#4b607f}.warning{border-color:#c79145;background:#fff9ef;color:#835e2d}.toc{padding:20px 24px;border:1px solid var(--line);border-radius:12px;margin:28px 0}.toc h2{font-size:16px;margin-bottom:8px}.toc ol{margin:0;padding-left:22px}.toc li{margin:5px 0}.question{padding-top:36px;border-top:1px solid var(--line);margin-top:36px}.card{border:1px solid var(--line);border-radius:12px;padding:24px;margin:18px 0;break-inside:avoid}.card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.badge{display:inline-block;border:1px solid #dce6f7;background:#f3f7ff;color:#47658f;border-radius:18px;padding:2px 10px;font-size:11px;white-space:nowrap}.badge.challenge{border-color:#e4ceaa;background:#fff9ef;color:#936b36}.badge.support{border-color:#cbe0d5;background:#f2f8f4;color:#4b795b}blockquote{white-space:pre-wrap;margin:18px 0;border-left:3px solid #adc6f3;padding:12px 18px;background:#f6f9ff;color:#314a6c;font-size:15px}.note{white-space:pre-wrap;background:#f7f8fa;border-radius:8px;padding:14px 18px;margin-top:18px;font-size:14px}.note b{display:block;color:var(--muted);font-size:11px;margin-bottom:6px}.position{font-size:12px;color:var(--muted);margin:5px 0}.source-status{font-size:12px;color:#547b61}.source-status.changed,.source-status.missing{color:#93662d}.source-list{padding-left:22px}.source-list li{margin:16px 0}.source-title{font-weight:600}.source-appendix{margin-top:24px;border:1px solid var(--line);border-radius:10px;padding:16px 20px}.source-appendix summary{font-weight:600;cursor:pointer}.full-source{white-space:pre-wrap;font:13px/1.95 system-ui,"Microsoft YaHei",sans-serif;overflow-wrap:anywhere;margin-top:18px}.anchor{scroll-margin-top:20px}mark{background:#fff0ad;color:inherit}.backlinks{font-size:12px;margin:10px 0}footer{border-top:1px solid var(--line);margin-top:48px;padding-top:20px;color:var(--muted);font-size:12px}@media(max-width:600px){main{padding:28px 20px 40px}h1{font-size:29px}h2{font-size:21px}.stats div{padding:13px 10px}.stats b{font-size:23px}.stats span{font-size:11px}.card{padding:18px}.card-top{gap:10px}blockquote{padding:10px 12px;font-size:14px}.toc{padding:16px 18px}.source-appendix{padding:14px}.notice{padding:10px 14px}}@media print{@page{margin:16mm}body{background:white;font-size:11pt}main{max-width:none;padding:0;min-height:0}h1{font-size:26pt}h2{font-size:18pt}.toc{break-inside:avoid}.card{box-shadow:none}.question{break-before:auto}.full-source{font-size:9pt}a{color:inherit}html{scroll-behavior:auto}footer{font-size:9pt}}`;

export function exportResearchHtml(research, documents, { includeSources = false, exportedAt = new Date().toISOString() } = {}) {
  if (typeof includeSources !== 'boolean' || typeof exportedAt !== 'string' || !Number.isFinite(Date.parse(exportedAt)) || new Date(exportedAt).toISOString() !== exportedAt) throw new TypeError('研究报告导出选项不正确。');
  const snapshot = buildReportSnapshot(research, documents); const { stats } = snapshot;
  const contents = snapshot.groups.map(group => `<li><a href="#question-${group.number}">${escape(group.question)}</a> <span class="meta">${group.cards.length} 条证据</span></li>`).join('');
  const sections = snapshot.groups.map(group => `<section id="question-${group.number}" class="question"><h2>${group.number}. ${escape(group.question)}</h2>${group.cards.map(card => `<article id="evidence-${card.number}" class="card"><div class="card-top"><h3>证据 ${card.number} · ${escape(card.source.title)}</h3><span class="badge ${card.stance}">${escape(STANCES[card.stance])}</span></div><blockquote>${escape(card.source.excerpt)}</blockquote><p class="position">来源 [${card.sourceNumber}] · ${escape(position(card.source))}</p><p class="source-status ${card.status}">${labels[card.status]}</p><p class="meta">片段 ${escape(card.source.chunkId)} · 收集于 ${escape(card.createdAt)}</p>${includeSources && card.status === 'valid' ? `<p><a href="#quote-${card.number}">核对完整提取文字中的高亮</a></p>` : ''}<div class="note"><b>个人笔记 · 人工填写</b>${escape(card.note || '尚未填写')}</div></article>`).join('')}</section>`).join('');
  const sourceList = snapshot.sources.map(source => `<li id="source-${source.number}"><span class="source-title">${escape(source.document?.title || source.title)}</span><div class="meta">${source.cards.length} 条摘录${source.document ? ` · 当前资料 ${source.document.text.length.toLocaleString('en-US')} 个 UTF-16 单元` : ' · 来源已移除'}${source.document && source.document.title !== source.title ? ` · 收集时名称：${escape(source.title)}` : ''}</div></li>`).join('');
  const appendices = includeSources ? snapshot.sources.filter(source => source.document).map(source => `<details class="source-appendix" open><summary>[${source.number}] ${escape(source.document.title)} · 完整提取文字</summary><p class="meta">高亮表示导出时仍匹配的已收集摘录；文字与版式以浏览器提取结果为准。</p><p class="backlinks">返回证据：${source.cards.map(card => `<a href="#evidence-${card.number}">${card.number}</a>`).join(' · ')}</p><div class="full-source">${markedText(source.document, source.cards)}</div></details>`).join('') : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escape(snapshot.title)} · CiteMind 研究报告</title><style>${css}</style></head><body><main>
<header><span class="eyebrow">CITEMIND · RESEARCH REPORT</span><h1>${escape(snapshot.title)}</h1><p class="lede">从问题到出处，保留每条摘录与个人判断。此文件可独立阅读，无需登录、联网或加载模型。</p><p class="meta">导出于 ${escape(exportedAt)} · ${includeSources ? '含所引资料的完整提取文字' : '仅含已收集摘录与个人笔记'}</p></header>
<div class="stats">${[[stats.questions, '个问题'], [stats.cards, '条证据'], [stats.sources, '份来源'], [stats.stale, '条待核对']].map(([value, label]) => `<div><b>${value}</b><span>${label}</span></div>`).join('')}</div>
<p class="notice${stats.stale ? ' warning' : ''}">这是原文摘录与个人整理；支持、存疑等标记由用户填写。来源匹配仅检查导出时知识库的文字与位置，不代表事实已经证实${stats.stale ? `。${stats.stale} 条摘录的来源已移除或变动，请先核对` : ''}。</p>
${contents ? `<nav class="toc" aria-label="报告目录"><h2>问题目录</h2><ol>${contents}</ol><a href="#sources">所引资料与核对说明</a></nav>` : '<p class="notice">尚未收集证据。</p>'}
${sections}<section id="sources" class="question"><h2>所引资料与核对说明</h2><ol class="source-list">${sourceList}</ol><p class="meta">页码仅来自实际 PDF 分页元数据；Word 和其他文字资料按提取文字定位。起止位置使用 JavaScript UTF-16 索引。删除或变动的来源仍保留历史摘录及警示。</p>${includeSources ? appendices : '<p class="notice">此文件未附资料全文。需要完整文字核对时，在 CiteMind 中重新生成报告并选择加入所引资料全文。</p>'}</section>
<footer>报告包含资料摘录和个人笔记${includeSources ? '及所引资料的完整提取文字' : ''}，分享前请检查内容。本文件是阅读快照；继续编辑或迁移知识库请使用 JSON 备份。可用浏览器的查找与打印功能阅读和保存。</footer>
</main></body></html>`;
}
