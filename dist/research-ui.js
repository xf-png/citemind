import { STANCES, collectEvidence, sourceKey, sourceStatus, compareDocuments, exportResearchMarkdown, exportComparisonMarkdown } from './research.js';
import { mountEvidenceMap } from './evidence-map-ui.js';

const $ = selector => document.querySelector(selector);
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }

export function mountResearchWorkspace({ getDocuments, getResearch, setResearch, getSelectedIds, openSource, toast, download, isBusy, isPersistent }) {
  const template = document.createElement('template');
  // Static markup only. All document, note and question content uses textContent.
  template.innerHTML = `<dialog id="research-dialog" class="dialog research-dialog" aria-labelledby="research-heading">
    <div class="dialog-heading"><div><span class="eyebrow">FROM SOURCES TO INSIGHT</span><h2 id="research-heading">研究工作台</h2></div><button class="icon-button" id="close-research" aria-label="关闭研究工作台">×</button></div>
    <div class="research-tabs" role="tablist" aria-label="研究工具"><button id="tab-notes" role="tab" aria-controls="notes-panel" aria-selected="true" tabindex="0">证据笔记 <span id="research-count">0</span></button><button id="tab-compare" role="tab" aria-controls="compare-panel" aria-selected="false" tabindex="-1">资料对照</button><button id="tab-map" role="tab" aria-controls="map-panel" aria-selected="false" tabindex="-1">证据地图</button></div>
    <section id="notes-panel" role="tabpanel" aria-labelledby="tab-notes">
      <div class="research-toolbar"><div class="research-title-field"><label for="research-title">笔记名称</label><input id="research-title" maxlength="160" placeholder="给这次研究起个名字"></div><button class="primary-button" id="export-research">导出研究笔记</button></div>
      <p class="research-help" id="research-save-note"></p><div id="research-summary" class="research-summary"></div>
      <div class="research-filters"><label class="sr-only" for="research-search">搜索证据笔记</label><input type="search" id="research-search" placeholder="搜索问题、摘录或笔记…"><label class="sr-only" for="research-filter">按人工标记筛选</label><select id="research-filter"><option value="all">全部标记</option><option value="unclassified">待整理</option><option value="support">支持</option><option value="challenge">存疑 / 反例</option><option value="context">背景</option><option value="stale">来源待核对</option></select></div>
      <div id="research-cards" class="research-cards"></div><button class="text-button" id="undo-evidence" hidden>撤销移除</button>
    </section>
    <section id="compare-panel" role="tabpanel" aria-labelledby="tab-compare" hidden>
      <div class="compare-intro"><h3>同一个问题，逐份资料核对</h3><p>勾选左侧资料，每行写一个问题。逐份查找相关原文，保留空缺，帮助你发现值得进一步核实的差异。</p></div>
      <label class="sr-only" for="compare-questions">对照问题，每行一个，最多六个</label><textarea id="compare-questions" rows="3" maxlength="1205" placeholder="每行一个问题，最多 6 个，每个最多 200 字。例如：&#10;主要目标是什么？&#10;有哪些限制？"></textarea>
      <div class="compare-actions"><span id="compare-scope"></span><button class="primary-button" id="run-comparison">生成资料对照</button><button class="secondary-button" id="export-comparison" disabled>导出对照</button></div><p id="compare-status" class="research-help" role="status">使用快速检索，不需要加载模型。相关片段不等同于事实结论。</p><div id="comparison-output"></div>
    </section>
    <section id="map-panel" role="tabpanel" aria-labelledby="tab-map" hidden></section>
  </dialog>`;
  document.body.append(template.content);
  let comparison = null;
  let removed = null;
  let tab = 'notes';
  const tabs = ['notes', 'compare', 'map'];
  const evidenceMap = mountEvidenceMap({ panel: $('#map-panel'), getResearch, getDocuments, openSource, download, editEvidence(id) {
    $('#research-search').value = ''; $('#research-filter').value = 'all';
    setTab('notes');
    const card = [...document.querySelectorAll('#research-cards [data-card-id]')].find(node => node.dataset.cardId === id);
    card?.scrollIntoView({ block: 'center' }); card?.querySelector('textarea')?.focus({ preventScroll: true });
  } });

  function updatePinButtons() {
    const keys = new Set(getResearch().cards.map(card => sourceKey(card.source)));
    document.querySelectorAll('[data-pin-source]').forEach(button => {
      const pinned = keys.has(button.dataset.pinSource);
      button.textContent = pinned ? '已收集 ✓' : '收集证据'; button.disabled = pinned;
    });
    $('#research-count').textContent = getResearch().cards.length;
    const badge = $('#board-count'); if (badge) badge.textContent = getResearch().cards.length;
  }
  function commit(research) { setResearch(research); updatePinButtons(); }
  function pin(source, question) {
    if (isBusy()) return;
    try {
      const before = getResearch().cards.length;
      commit(collectEvidence(getResearch(), source, question, getDocuments()));
      toast(getResearch().cards.length === before ? '这条原文已在研究笔记中。' : '已收集到研究笔记，可添加自己的判断与备注。');
      if ($('#research-dialog').open) setTab(tab);
    } catch (error) { toast(error.message); }
  }
  function pinButton(source, question) {
    const button = node('button', 'pin-evidence', '收集证据'); button.type = 'button'; button.dataset.pinSource = sourceKey(source);
    button.addEventListener('click', () => pin(source, question));
    button.disabled = getResearch().cards.some(card => sourceKey(card.source) === sourceKey(source));
    if (button.disabled) button.textContent = '已收集 ✓';
    return button;
  }
  function editCard(id, fields) { commit({ ...getResearch(), cards: getResearch().cards.map(card => card.id === id ? { ...card, ...fields } : card) }); }
  function renderSummary() {
    const research = getResearch(); const stats = $('#research-summary'); stats.replaceChildren();
    const stale = research.cards.filter(card => sourceStatus(card.source, getDocuments()) !== 'valid').length;
    [[research.cards.length, '条证据'], [new Set(research.cards.map(card => card.source.id)).size, '份来源'], [research.cards.filter(card => card.note.trim()).length, '条笔记'], [stale, '条待核对']].forEach(([value, label]) => { const cell = node('div'); cell.append(node('b', '', String(value)), node('span', '', label)); stats.append(cell); });
    $('#research-save-note').textContent = isPersistent() ? '研究笔记与资料一起保存；保存状态见左侧。也可通过“保存与备份”导出完整备份。' : '当前笔记仅留在此页面。开启“保存与备份”中的本地保存，或导出完整知识库备份。';
    $('#export-research').disabled = !research.cards.length;
  }
  function renderNotes() {
    const research = getResearch(); $('#research-title').value = research.title; renderSummary(); updatePinButtons();
    const list = $('#research-cards'); list.replaceChildren();
    const query = $('#research-search').value.trim().toLocaleLowerCase(); const filter = $('#research-filter').value;
    const visible = research.cards.filter(card => (!query || [card.question, card.source.title, card.source.excerpt, card.note].join('\n').toLocaleLowerCase().includes(query)) && (filter === 'all' || filter === card.stance || (filter === 'stale' && sourceStatus(card.source, getDocuments()) !== 'valid')));
    if (!visible.length) {
      const empty = node('div', 'research-empty'); empty.append(node('span', 'research-empty-icon', '❝'), node('h3', '', research.cards.length ? '没有符合条件的证据' : '让有用的原文，成为你的积累'), node('p', '', research.cards.length ? '试试其他关键词或标记。' : '在问答结果或资料对照中点击“收集证据”，再写下自己的判断。')); list.append(empty);
    }
    visible.forEach(card => {
      const article = node('article', 'research-card'); article.dataset.cardId = card.id;
      const heading = node('div', 'research-card-heading'); heading.append(node('strong', '', card.question || '收集的证据'));
      const remove = node('button', 'text-button', '移除'); remove.setAttribute('aria-label', `移除证据：${card.source.title}`); remove.addEventListener('click', () => { removed = card; commit({ ...getResearch(), cards: getResearch().cards.filter(row => row.id !== card.id) }); $('#undo-evidence').hidden = false; renderNotes(); }); heading.append(remove);
      const excerpt = node('blockquote', '', card.source.excerpt);
      article.append(heading, excerpt);
      if (card.source.excerpt.length > 180 || card.source.excerpt.split('\n').length > 4) {
        excerpt.className = 'collapsible'; excerpt.id = `quote-${crypto.randomUUID()}`;
        const expand = node('button', 'text-button quote-expand', '展开完整摘录'); expand.setAttribute('aria-controls', excerpt.id); expand.setAttribute('aria-expanded', 'false');
        expand.addEventListener('click', () => { const expanded = excerpt.classList.toggle('expanded'); expand.setAttribute('aria-expanded', String(expanded)); expand.textContent = expanded ? '收起摘录' : '展开完整摘录'; }); article.append(expand);
      }
      const status = sourceStatus(card.source, getDocuments());
      const meta = node('div', `research-source ${status}`); const open = node('button', 'text-button', `${card.source.title}${card.source.pageNumber ? ` · 第 ${card.source.pageNumber} 页` : ''} ↗`); open.disabled = status !== 'valid'; open.addEventListener('click', () => openSource(card.source.id, card.source.excerpt, card.source));
      meta.append(open, node('span', '', status === 'valid' ? '可核对原文' : status === 'missing' ? '来源已移除 · 摘录已保留' : '来源已变动 · 待重新核对')); article.append(meta);
      const controls = node('div', 'research-card-controls'); const label = node('label', '', '我的标记'); const select = node('select'); select.setAttribute('aria-label', `证据标记：${card.source.title}`);
      Object.entries(STANCES).forEach(([key, text]) => { const option = node('option', '', text); option.value = key; select.append(option); }); select.value = card.stance;
      select.addEventListener('change', () => { editCard(card.id, { stance: select.value }); renderSummary(); }); label.append(select); controls.append(label, node('small', '', '标记由你判断，不代表自动核实')); article.append(controls);
      const noteLabel = node('label', 'note-label', '个人笔记'); const textarea = node('textarea'); textarea.rows = 2; textarea.maxLength = 2000; textarea.value = card.note; textarea.placeholder = '这条证据说明了什么？还有哪些地方需要核实？'; textarea.setAttribute('aria-label', `个人笔记：${card.source.title}`);
      textarea.addEventListener('input', () => { editCard(card.id, { note: textarea.value }); renderSummary(); }); noteLabel.append(textarea); article.append(noteLabel); list.append(article);
    });
  }
  function setTab(next) {
    tab = next;
    tabs.forEach(name => { const selected = name === next; $(`#tab-${name}`).setAttribute('aria-selected', String(selected)); $(`#tab-${name}`).tabIndex = selected ? 0 : -1; $(`#${name}-panel`).hidden = !selected; });
    if (next === 'notes') renderNotes();
    if (next === 'map') evidenceMap.render();
    $('#compare-scope').textContent = `已选 ${getSelectedIds().length} / ${getDocuments().length} 份资料`;
  }
  tabs.forEach(name => {
    const button = $(`#tab-${name}`); button.addEventListener('click', () => setTab(name));
    button.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = tabs.indexOf(tab); const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; setTab(next); $(`#tab-${next}`).focus(); } });
  });
  $('#close-research').addEventListener('click', () => $('#research-dialog').close());
  $('#research-title').addEventListener('change', event => { const title = event.target.value.trim() || '我的研究笔记'; event.target.value = title; commit({ ...getResearch(), title }); });
  $('#research-search').addEventListener('input', renderNotes); $('#research-filter').addEventListener('change', renderNotes);
  $('#undo-evidence').addEventListener('click', () => { if (!removed) return; try { const cards = [...getResearch().cards, removed]; commit({ ...getResearch(), cards }); removed = null; $('#undo-evidence').hidden = true; renderNotes(); } catch (error) { toast(error.message); } });
  $('#export-research').addEventListener('click', () => download(exportResearchMarkdown(getResearch(), getDocuments()), 'CiteMind-研究笔记.md', 'text/markdown;charset=utf-8'));
  $('#run-comparison').addEventListener('click', () => {
    if (isBusy()) return;
    try {
      const questions = $('#compare-questions').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      comparison = compareDocuments({ questions, documents: getDocuments(), documentIds: getSelectedIds() });
      const output = $('#comparison-output'); output.replaceChildren();
      const scroller = node('div', 'comparison-scroll'); scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', '资料对照表，可左右滚动');
      const table = node('table', 'comparison-table'); const caption = node('caption', '', '逐份资料的相关原文'); table.append(caption); const thead = node('thead'); const header = node('tr'); const first = node('th', '', '研究问题'); first.scope = 'col'; header.append(first);
      comparison.documents.forEach(doc => { const th = node('th', '', doc.title); th.scope = 'col'; header.append(th); }); thead.append(header); table.append(thead);
      const tbody = node('tbody'); let hits = 0;
      comparison.rows.forEach(row => { const tr = node('tr'); const th = node('th', '', row.question); th.scope = 'row'; tr.append(th); row.cells.forEach(cell => { const td = node('td'); if (!cell.sources.length) td.append(node('p', 'comparison-gap', '未找到足够相关的片段')); cell.sources.forEach(source => { hits++; td.append(node('p', '', source.excerpt)); const actions = node('div', 'comparison-cell-actions'); const open = node('button', 'text-button', source.pageNumber ? `第 ${source.pageNumber} 页 ↗` : '查看原文 ↗'); open.addEventListener('click', () => openSource(source.id, source.excerpt, source)); actions.append(open, pinButton(source, row.question)); td.append(actions); }); tr.append(td); }); tbody.append(tr); }); table.append(tbody); scroller.append(table); output.append(scroller);
      const total = comparison.rows.length * comparison.documents.length;
      $('#compare-status').textContent = `${comparison.rows.length} 个问题 × ${comparison.documents.length} 份资料 · ${hits} 格找到相关原文，${total - hits} 格待补充核实。使用快速检索，不自动判断资料之间的共识或矛盾。`;
      $('#export-comparison').disabled = false;
    } catch (error) { toast(error.message); }
  });
  $('#export-comparison').addEventListener('click', () => { if (comparison) download(exportComparisonMarkdown(comparison, getDocuments()), 'CiteMind-资料对照.md', 'text/markdown;charset=utf-8'); });
  return {
    pinButton,
    open(next = 'notes') { if (isBusy()) return; setTab(next); if (!$('#research-dialog').open) $('#research-dialog').showModal(); },
    refresh({ documentsChanged = false } = {}) {
      updatePinButtons();
      if (documentsChanged) { comparison = null; $('#comparison-output').replaceChildren(); $('#export-comparison').disabled = true; $('#compare-status').textContent = '资料已更新，请重新生成对照。'; removed = null; $('#undo-evidence').hidden = true; }
      if ($('#research-dialog').open) setTab(tab);
    },
  };
}
