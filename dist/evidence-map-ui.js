import { buildEvidenceMap, layoutEvidenceMap, exportEvidenceMapSvg } from './evidence-map.js';
import { STANCES } from './research.js';

function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
const NS = 'http://www.w3.org/2000/svg';
function svgElement(tag, attributes) { const node = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; }

export function mountEvidenceMap({ panel, getResearch, getDocuments, openSource, editEvidence, download }) {
  const template = document.createElement('template');
  template.innerHTML = `<div class="map-intro"><div><span class="eyebrow">FOLLOW THE EVIDENCE</span><h3>每个问题，都能沿线找到出处</h3><p>只连接收集时记录的问题与资料。点击节点查看摘录和个人笔记，连线数字是证据条数。</p></div><button class="secondary-button" id="export-evidence-map">导出地图 SVG</button></div>
    <div class="map-filters"><label class="sr-only" for="map-search">搜索地图中的已收集证据</label><input id="map-search" type="search" maxlength="200" placeholder="搜索问题、资料或笔记…"><label class="sr-only" for="map-stance">按人工标记筛选地图</label><select id="map-stance"><option value="all">全部人工标记</option><option value="unclassified">待整理</option><option value="support">支持</option><option value="challenge">存疑 / 反例</option><option value="context">背景</option></select><label class="sr-only" for="map-status">按来源状态筛选地图</label><select id="map-status"><option value="all">全部来源状态</option><option value="valid">可核对原文</option><option value="stale">来源待核对</option></select></div>
    <div class="map-overview"><p id="map-summary" role="status"></p><button class="text-button" id="map-reset">取消节点选择</button></div>
    <div class="map-layout"><div class="map-chart"><div class="map-lane-labels"><span>研究问题</span><span>资料来源</span></div><div id="map-scroller" class="map-scroller" role="region" aria-label="证据地图，节点可用键盘选择，内容可上下左右滚动" tabindex="0"><div id="map-canvas" class="map-canvas"></div></div><p class="map-legend"><i></i>已收集证据关联 <i class="stale"></i>含待核对来源 · 可滚动查看完整地图</p></div><aside class="map-inspector" aria-label="所选节点的证据"><h3 id="map-detail-heading">沿线查看证据</h3><p id="map-detail-summary"></p><div id="map-details"></div></aside></div>
    <p class="research-help">地图仅展示当前筛选下的已收集记录，未连线不代表没有相关内容。支持、存疑等标记由你填写；连线不表示自动核实、资料共识或语义推断。</p>`;
  panel.append(template.content);
  const $ = selector => panel.querySelector(selector);
  let selection = null;
  function filters() { return { query: $('#map-search').value, stance: $('#map-stance').value, status: $('#map-status').value }; }
  function render() {
    const graph = buildEvidenceMap(getResearch(), getDocuments(), filters()); const layout = layoutEvidenceMap(graph);
    const selected = selection?.kind === 'source' ? graph.sources.find(node => node.documentId === selection.key) : graph.questions.find(node => node.key === selection?.key);
    if (!selected) selection = null;
    const selectedId = selected?.id;
    const selectedEdges = graph.edges.filter(edge => edge.questionId === selectedId || edge.sourceId === selectedId);
    const related = new Set(selectedEdges.flatMap(edge => [edge.questionId, edge.sourceId]));
    $('#map-summary').textContent = `${graph.stats.questions} 个问题 · ${graph.stats.sources} 份来源 · ${graph.stats.cards} 条证据 · ${graph.stats.stale} 条待核对`;
    $('#map-reset').disabled = !selection; $('#export-evidence-map').disabled = !graph.cards.length;
    const canvas = $('#map-canvas'); canvas.replaceChildren(); canvas.style.height = `${graph.cards.length ? layout.height : 264}px`;
    if (!graph.cards.length) {
      canvas.style.minWidth = '0'; const empty = element('div', 'map-empty'); empty.append(element('strong', '', '地图从你收集的第一条证据开始'), element('p', '', getResearch().cards.length ? '当前没有符合筛选条件的记录，试试其他条件。' : '在问答结果或资料对照中收集原文，再回到这里查看问题与来源的联系。')); canvas.append(empty);
    } else {
      canvas.style.minWidth = '';
      const svg = svgElement('svg', { viewBox: `0 0 1000 ${layout.height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      for (const edge of layout.edges) {
        const active = !selection || selectedEdges.some(row => row.id === edge.id);
        const group = svgElement('g', { opacity: active ? '1' : '0.13' });
        group.append(svgElement('path', { d: edge.path, fill: 'none', stroke: edge.stale ? '#c69a55' : '#a4bff1', 'stroke-width': Math.min(5, 1 + edge.count), 'vector-effect': 'non-scaling-stroke', ...(edge.stale ? { 'stroke-dasharray': '5 4' } : {}) }));
        svg.append(group);
      }
      canvas.append(svg);
      // HTML keeps numbers round and legible as the SVG stretches. Restrict
      // labels to the selected node's links to avoid overlapping crossings.
      if (selection) for (const edge of layout.edges.filter(edge => selectedEdges.some(row => row.id === edge.id))) {
        const label = element('span', 'map-edge-count', String(edge.count)); label.setAttribute('aria-hidden', 'true'); label.style.top = `${edge.labelY - 11}px`; canvas.append(label);
      }
      for (const item of [...layout.questions, ...layout.sources]) {
        const source = Object.hasOwn(item, 'documentId');
        const button = element('button', `map-node ${source ? 'source' : 'question'}${item.stale ? ' stale' : ''}${selection && !related.has(item.id) ? ' dimmed' : ''}`);
        button.style.left = `${item.x / 10}%`; button.style.top = `${item.y}px`; button.style.width = `${item.width / 10}%`;
        button.dataset.mapNode = item.id; button.title = item.label; button.setAttribute('aria-pressed', String(selectedId === item.id)); button.setAttribute('aria-label', `${source ? '来源' : '问题'}：${item.label}，${item.count} 条已收集证据`);
        button.append(element('small', '', `${item.id.toUpperCase()} · ${item.count} 条证据${item.stale ? ` · ${item.stale} 条待核对` : ''}`), element('span', '', item.label));
        button.addEventListener('click', () => { selection = selectedId === item.id ? null : { kind: source ? 'source' : 'question', key: source ? item.documentId : item.key }; render(); [...canvas.querySelectorAll('[data-map-node]')].find(node => node.dataset.mapNode === item.id)?.focus({ preventScroll: true }); }); canvas.append(button);
      }
    }
    const selectedIds = new Set(selectedEdges.flatMap(edge => edge.cardIds));
    const cards = selection ? graph.cards.filter(card => selectedIds.has(card.id)) : [];
    $('#map-detail-heading').textContent = selected?.label || '沿线查看证据';
    $('#map-detail-summary').textContent = selected ? `${cards.length} 条已收集证据，人工标记与原文分别保留。` : '点击任意研究问题或资料节点，查看相连的摘录、标记和个人笔记。';
    const details = $('#map-details'); details.replaceChildren();
    for (const card of cards) {
      const article = element('article', 'map-evidence'); article.dataset.mapCard = card.id;
      article.append(element('small', `map-stance ${card.stance}`, `人工标记 · ${STANCES[card.stance]}`), element('blockquote', '', card.source.excerpt));
      article.append(element('p', `map-source-status ${card.status}`, `${card.source.title}${card.source.pageNumber ? ` · 第 ${card.source.pageNumber} 页` : ''} · ${card.status === 'valid' ? '可核对原文' : card.status === 'missing' ? '来源已移除' : '来源已变动，待核对'}`));
      if (card.note) article.append(element('p', 'map-personal-note', `个人笔记：${card.note}`));
      const actions = element('div', 'map-evidence-actions'); const open = element('button', 'text-button', '查看原文 ↗'); open.disabled = card.status !== 'valid'; open.addEventListener('click', () => openSource(card.source.id, card.source.excerpt, card.source));
      const edit = element('button', 'text-button', '编辑笔记'); edit.addEventListener('click', () => editEvidence(card.id)); actions.append(open, edit); article.append(actions); details.append(article);
    }
  }
  ['#map-search', '#map-stance', '#map-status'].forEach(selector => $(selector).addEventListener(selector === '#map-search' ? 'input' : 'change', render));
  $('#map-reset').addEventListener('click', () => { selection = null; render(); });
  $('#export-evidence-map').addEventListener('click', () => download(exportEvidenceMapSvg(getResearch(), getDocuments(), filters()), 'CiteMind-证据地图.svg', 'image/svg+xml;charset=utf-8'));
  return { render };
}
