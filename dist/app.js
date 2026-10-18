import { DEMO_DOCS, prepareDocuments, answerQuestion, configureEmbedder } from './engine.js';
import { loadLocalModel, unloadLocalModel } from './model.js';
import { validateLibrary, serializeBackup, parseBackup, readLibrary, writeLibrary, clearLibrary, persistenceEnabled, setPersistenceEnabled } from './storage.js';

const $ = selector => document.querySelector(selector);
const state = { documents: prepareDocuments(DEMO_DOCS), mode: 'extractive', busy: false, history: [], modelReady: false, loading: false, modelAbort: null, selectedDoc: null, importing: false, importAbort: null, initializing: true, persist: persistenceEnabled(), saving: false, persistenceBusy: false, saveError: '', savedAt: null };
let toastTimer;
let saveQueue = Promise.resolve();
let persistenceRevision = 0;
let saveSequence = 0;
const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; };
function node(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
function toast(message) { const t = $('#toast'); t.textContent = message; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500); }
function openDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
function isBusy() { if (!state.busy && !state.importing && !state.initializing && !state.persistenceBusy) return false; toast(state.initializing ? '正在恢复知识库，请稍候。' : state.importing ? '正在读取资料，请稍候或取消导入。' : state.persistenceBusy ? '正在更新本地保存设置，请稍候。' : '正在检索，请稍候再操作。'); return true; }
function scrollBottom() { requestAnimationFrame(() => { $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight; }); }
function updateControls() { const busy = state.busy || state.importing || state.initializing || state.persistenceBusy; $('#send-button').disabled = busy; $('#question').disabled = busy; $('#question-form').setAttribute('aria-busy', String(busy)); }
function setBusy(busy) { state.busy = busy; updateControls(); }

function renderDocuments() {
  const list = $('#document-list'); list.replaceChildren();
  for (const doc of state.documents) {
    const button = node('button', 'document-item'); button.title = `查看：${doc.title}`;
    const file = node('span', 'file-icon'); file.append(icon('doc'));
    const details = node('div'); details.append(node('strong', '', doc.title), node('small', '', doc.type === 'pdf' ? `PDF · ${doc.pages.length} 页 · ${doc.chunks.length} 个片段` : `${doc.chunks.length} 个片段 · ${doc.text.length.toLocaleString('zh-CN')} 字符`));
    button.append(file, details); button.addEventListener('click', () => openDocument(doc.id)); list.append(button);
  }
  $('#doc-count').textContent = state.documents.length;
  $('#composer-doc-count').textContent = `${state.documents.length} 份资料已就绪`;
  renderStorage();
}

function openDocument(id, excerpt, source = {}) {
  const doc = state.documents.find(d => d.id === id); if (!doc) return toast('此资料已移除，请重新检索。');
  state.selectedDoc = id;
  $('#document-title').textContent = doc.title;
  const isPdf = doc.type === 'pdf';
  const pageNumber = Number.isInteger(source.pageNumber) ? source.pageNumber : isPdf ? 1 : 0;
  const page = isPdf && pageNumber ? doc.pages.find(p => p.pageNumber === pageNumber) : null;
  const text = page ? page.text : doc.text;
  $('#document-meta').textContent = `${isPdf ? `PDF · ${doc.pages.length} 页 · ` : ''}${doc.text.length.toLocaleString('zh-CN')} 字符 · ${doc.chunks.length} 个文本块 · ${state.persist && !state.saveError ? '保存在此浏览器' : '当前页面资料'}`;
  $('#document-page-controls').hidden = !isPdf;
  const pageSelect = $('#document-page'); pageSelect.replaceChildren();
  if (isPdf) { const all = node('option', '', '全部文本'); all.value = '0'; pageSelect.append(all); doc.pages.forEach(p => { const option = node('option', '', `第 ${p.pageNumber} 页`); option.value = p.pageNumber; pageSelect.append(option); }); pageSelect.value = page ? String(pageNumber) : '0'; }
  const body = $('#document-content'); body.replaceChildren();
  const offset = page ? Math.max(0, (Number.isInteger(source.start) ? source.start : page.start) - page.start) : Number.isInteger(source.start) ? source.start : 0;
  const at = excerpt ? text.indexOf(excerpt, offset) : -1;
  if (at >= 0) { const mark = node('mark', '', excerpt); body.append(document.createTextNode(text.slice(0, at)), mark, document.createTextNode(text.slice(at + excerpt.length))); }
  else body.textContent = text || '此页没有可提取的文字。';
  openDialog('#document-dialog');
  requestAnimationFrame(() => { const mark = body.querySelector('mark'); if (mark) body.scrollTop = Math.max(0, mark.offsetTop - body.offsetTop - 20); else body.scrollTop = 0; });
}

const initialEvidence = $('#evidence-body').cloneNode(true);
function clearConversation() { state.history = []; $('#messages').replaceChildren(); $('#welcome').hidden = false; $('#evidence-body').replaceChildren(...Array.from(initialEvidence.childNodes, n => n.cloneNode(true))); $('#evidence-count').textContent = '0'; $('#chat-scroll').scrollTop = 0; }
function replaceDocuments(docs, { save = true } = {}) { state.documents = validateLibrary(docs); renderDocuments(); clearConversation(); if (save) queueSave(); }
function addDocuments(docs) {
  if (state.documents.length + docs.length > 20) throw new Error('当前页面最多保留 20 份资料，请先移除部分资料。');
  if (docs.some(d => d.text.length > 100000)) throw new Error('单份资料最多 10 万字符，请拆分后导入。');
  if (docs.some(d => !d.text.trim())) throw new Error('资料内容为空，请检查后重新添加。');
  if ([...state.documents, ...docs].reduce((sum, d) => sum + d.text.length, 0) > 250000) throw new Error('资料总量最多 25 万字符，请减少内容后重试。');
  replaceDocuments([...state.documents, ...docs]); toast(`已添加 ${docs.length} 份资料，可开始提问。`);
}

function renderStorage() {
  $('#persist-toggle').checked = state.persist;
  $('#persist-toggle').disabled = state.persistenceBusy || state.initializing;
  $('#save-now').hidden = !state.persist || !state.saveError;
  $('#storage-label').textContent = state.saveError ? '本次修改尚未保存' : state.saving ? '正在保存到此浏览器' : state.persist ? '资料已保存在此浏览器' : '资料仅留在此页面';
  $('#storage-note').textContent = state.persist ? '可在此浏览器继续使用。\n文档不会发送至服务器。' : '可开启本地保存，刷新后继续用。\n文档不会发送至服务器。';
  $('#storage-status').textContent = state.saveError || (state.persistenceBusy ? '正在更新保存设置…' : state.saving ? '正在保存当前资料…' : state.persist ? `本地保存已开启${state.savedAt ? ` · ${new Date(state.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 已保存` : ''}。` : '尚未开启：刷新页面后恢复示例资料。');
  $('#storage-status').classList.toggle('has-error', Boolean(state.saveError));
  const stats = $('#library-stats'); stats.replaceChildren();
  const pdfPages = state.documents.reduce((n, d) => n + (d.pages?.length || 0), 0);
  [[state.documents.length, '份资料'], [state.documents.reduce((n, d) => n + d.text.length, 0).toLocaleString('zh-CN'), '字符'], [pdfPages, 'PDF 页']].forEach(([value, label]) => { const cell = node('div'); cell.append(node('b', '', String(value)), node('span', '', label)); stats.append(cell); });
}

function queueSave() {
  if (!state.persist) return saveQueue;
  const snapshot = state.documents;
  const revision = persistenceRevision;
  const sequence = ++saveSequence;
  state.saving = true; state.saveError = ''; renderStorage();
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    if (!state.persist || revision !== persistenceRevision || sequence !== saveSequence) return;
    try {
      const saved = await writeLibrary(snapshot);
      if (revision === persistenceRevision && sequence === saveSequence) { state.savedAt = saved.savedAt; state.saveError = ''; }
    } catch (error) {
      if (revision === persistenceRevision && sequence === saveSequence) { state.saveError = `保存失败：${error.message} 当前修改仍可使用，请导出备份。`; toast('本地保存失败，当前资料仍可使用。请导出备份。'); }
    } finally { if (revision === persistenceRevision && sequence === saveSequence) { state.saving = false; renderStorage(); } }
  });
  return saveQueue;
}

async function changePersistence(enabled) {
  if (isBusy()) { renderStorage(); return; }
  state.persistenceBusy = true; state.saveError = ''; updateControls(); renderStorage();
  persistenceRevision++;
  try {
    await saveQueue.catch(() => {});
    if (enabled) {
      setPersistenceEnabled(true);
      try { const saved = await writeLibrary(state.documents); state.savedAt = saved.savedAt; state.persist = true; }
      catch (error) { setPersistenceEnabled(false); await clearLibrary().catch(() => {}); throw error; }
      toast('本地保存已开启，刷新后可以继续使用资料。');
    } else {
      await clearLibrary(); setPersistenceEnabled(false); state.persist = false; state.savedAt = null;
      toast('已关闭本地保存，并移除浏览器中的资料副本。');
    }
  } catch (error) { state.persist = persistenceEnabled(); state.saveError = error.message; toast(error.message); }
  finally { state.saving = false; state.persistenceBusy = false; updateControls(); renderStorage(); }
}

function downloadText(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type })); const link = node('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportLibrary() {
  if (isBusy()) return;
  try { downloadText(serializeBackup(state.documents), `CiteMind-知识库-${new Date().toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8'); toast('已导出资料与 PDF 页码，可用于恢复知识库。'); }
  catch (error) { toast(error.message); }
}

async function restoreLibrary(file) {
  if (!file || isBusy()) return;
  try {
    if (file.size > 6 * 1024 * 1024) throw new Error('备份文件过大，最多支持 6 MB。');
    const restored = parseBackup(await file.text());
    if (isBusy()) return;
    if ($('#restore-mode').value === 'replace') { replaceDocuments(restored); toast(`已从备份恢复 ${restored.length} 份资料，并清空旧对话。`); }
    else {
      const contentKeys = new Set(state.documents.map(d => JSON.stringify([d.title, d.text, d.type || 'text'])));
      const ids = new Set(state.documents.map(d => d.id));
      const additions = [];
      for (const doc of restored) {
        const key = JSON.stringify([doc.title, doc.text, doc.type || 'text']); if (contentKeys.has(key)) continue;
        contentKeys.add(key); const id = ids.has(doc.id) ? crypto.randomUUID() : doc.id; ids.add(id); additions.push({ ...doc, id });
      }
      if (!additions.length) return toast('备份中的资料已在当前知识库，无需重复导入。');
      replaceDocuments([...state.documents, ...additions]); toast(`已合并 ${additions.length} 份新资料。`);
    }
  } catch (error) { toast(`无法恢复：${error.message}`); }
  finally { $('#backup-input').value = ''; }
}

async function initializeLibrary() {
  updateControls();
  try { if (state.persist) { const saved = await readLibrary(); if (saved) { state.documents = saved.documents; state.savedAt = saved.savedAt; } else { const created = await writeLibrary(state.documents); state.savedAt = created.savedAt; } } }
  catch (error) { state.saveError = `无法恢复本地资料：${error.message} 可导入备份，当前展示示例资料。`; toast('本地资料未能恢复，可使用示例或导入备份。'); }
  finally { state.initializing = false; renderDocuments(); renderMode(); updateControls(); }
}

async function importFiles(files) {
  if (isBusy()) return;
  const selected = Array.from(files); if (!selected.length) return;
  if (selected.length > 20) return toast('一次最多选择 20 份资料。');
  try {
    for (const file of selected) { const pdf = /\.pdf$/i.test(file.name); if (!/\.(pdf|txt|md|markdown)$/i.test(file.name)) throw new Error('请使用 PDF、TXT 或 Markdown 文件。'); if (file.size > (pdf ? 10 : 1) * 1024 * 1024) throw new Error(`${file.name} 超过 ${pdf ? '10' : '1'} MB，请缩小后导入。`); }
    if (state.documents.length + selected.length > 20) throw new Error('当前页面最多保留 20 份资料，请先移除部分资料。');
    state.importing = true; state.importAbort = new AbortController(); updateControls(); $('#import-progress').hidden = false;
    const docs = [];
    for (let index = 0; index < selected.length; index++) {
      const file = selected[index]; const signal = state.importAbort.signal;
      if (signal.aborted) throw new DOMException('已取消导入。', 'AbortError');
      $('#import-status').textContent = `正在读取 ${index + 1}/${selected.length}：${file.name}`;
      const doc = { id: crypto.randomUUID(), title: file.name.replace(/\.(pdf|txt|md|markdown)$/i, '') };
      if (/\.pdf$/i.test(file.name)) {
        const { parsePdfFile } = await import('./pdf.js');
        const parsed = await parsePdfFile(file, { signal, onProgress: event => { $('#import-status').textContent = `${file.name} · ${event.message || '正在解析…'}`; } });
        Object.assign(doc, { type: 'pdf', text: parsed.text, pages: parsed.pages });
      } else { try { doc.text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); } catch { throw new Error(`${file.name} 不是 UTF-8 文本，请转换编码后导入。`); } }
      if (signal.aborted) throw new DOMException('已取消导入。', 'AbortError');
      docs.push(doc);
    }
    addDocuments(docs);
  } catch (error) { toast(error.name === 'AbortError' ? '已取消导入，原有资料未改动。' : error.message); }
  finally { state.importing = false; state.importAbort = null; $('#import-progress').hidden = true; $('#file-input').value = ''; updateControls(); }
}

function renderEvidence(result) {
  $('#evidence-count').textContent = result.sources.length;
  const body = $('#evidence-body'); body.replaceChildren();
  const note = result.sources.length ? `找到 ${result.sources.length} 条相关片段 · 点击卡片查看原文。排序表示相关程度，不代表事实准确率。` : '当前资料中没有足够相关的原文。补充资料后可以再次提问。';
  body.append(node('p', 'evidence-result-note', note));
  result.sources.forEach((source, index) => {
    const card = node('button', 'source-card'); card.id = `evidence-${index + 1}`;
    const heading = node('div', 'source-title'); heading.append(node('span', '', String(index + 1)), node('b', '', source.title));
    const meta = node('small', '', source.pageNumber ? `PDF 第 ${source.pageNumber} 页` : source.chunkId.split(':').at(-1).replace('chunk-', '片段 ')); meta.append(node('span', '', '查看原文 ↗'));
    card.append(heading, node('p', '', source.excerpt), meta); card.addEventListener('click', () => openDocument(source.id, source.excerpt, source)); body.append(card);
  });
}

function citationText(target, text, result) {
  // Render all document-derived content as text; only valid source numbers become buttons.
  let cursor = 0; for (const match of text.matchAll(/\[(\d+)\]/g)) {
    target.append(document.createTextNode(text.slice(cursor, match.index)));
    const index = Number(match[1]) - 1, source = result.sources[index];
    if (source) { const b = node('button', 'citation', `[${index + 1}]`); b.title = `核对原文：${source.title}${source.pageNumber ? `（第 ${source.pageNumber} 页）` : ''}`; b.addEventListener('click', () => { renderEvidence(result); openDocument(source.id, source.excerpt, source); }); target.append(b); }
    else target.append(document.createTextNode(match[0]));
    cursor = match.index + match[0].length;
  }
  target.append(document.createTextNode(text.slice(cursor)));
}

function markdownText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*{}\[\]()#+.!_|~-]/g, '\\$&');
}
function resultMarkdown(question, result) {
  const lines = [`## ${markdownText(question)}`, '', `模式：${result.mode === 'semantic' ? '本地 AI 语义检索' : '快速检索与原文摘录'} · 检索耗时：${result.elapsedMs} ms`, '', markdownText(result.answer)];
  if (result.sources.length) { lines.push('', '### 原文来源'); result.sources.forEach((s, i) => lines.push('', `#### [${i + 1}] ${markdownText(s.title)}${s.pageNumber ? `（第 ${s.pageNumber} 页）` : ''}`, '', `片段标识：${markdownText(s.chunkId)}`, '', markdownText(s.excerpt))); }
  return lines.join('\n');
}
function exportHistory() {
  if (!state.history.length) return toast('提问后即可导出问答记录。');
  const text = `# CiteMind · 证据 — 问答记录\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n\n本文为资料检索与原文摘录，不是生成式总结。引用仅对应本次导出的资料。\n\n${state.history.map(h => resultMarkdown(h.question, h.result)).join('\n\n---\n\n')}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const link = node('a'); link.href = url; link.download = `CiteMind-问答记录-${new Date().toISOString().slice(0,10)}.md`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('问答与引用已导出为 Markdown。');
}

async function ask(question) {
  if (isBusy()) return;
  question = String(question).trim(); if (!question) { $('#question').focus(); return; }
  if (question.length > 1000) return toast('问题最多 1000 字，请精简后发送。');
  if (state.history.length >= 20) return toast('当前对话已达 20 轮。请先导出记录，再新建对话。');
  $('#question').value = ''; $('#welcome').hidden = true; $('#library').classList.remove('mobile-open'); setBusy(true);
  const message = node('article', 'message'); const user = node('div', 'user-question'); user.append(node('p', '', question));
  const head = node('div', 'answer-head'); const avatar = node('span', 'answer-avatar'); avatar.append(icon('spark')); const mode = state.mode;
  const timing = node('small', '', mode === 'semantic' ? '正在计算语义向量…' : '正在检索原文…'); head.append(avatar, node('b', '', 'CiteMind'), timing);
  const body = node('div', 'answer-body'); const loading = node('div', 'loading-answer'); loading.append(node('span'), node('span'), node('span')); body.append(loading);
  message.append(user, head, body); $('#messages').append(message); scrollBottom();
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = await answerQuestion({ question, documents: state.documents, mode });
    body.replaceChildren(); citationText(body, result.answer, result);
    timing.textContent = `${mode === 'semantic' ? 'AI 语义检索' : '原文摘录'} · ${result.elapsedMs} ms`;
    renderEvidence(result); state.history.push({ question, result });
    const tools = node('div', 'answer-tools'); const copy = node('button'); copy.append(icon('copy'), document.createTextNode('复制回答'));
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(resultMarkdown(question, result)); toast('回答与原文来源已复制。'); } catch { toast('浏览器未允许复制，可使用导出功能保存。'); } });
    const download = node('button'); download.append(icon('down'), document.createTextNode('导出记录')); download.addEventListener('click', exportHistory);
    tools.append(copy, download, node('span', 'source-count', `${result.sources.length} 条来源可核对`)); message.append(tools);
    const followups = node('div', 'followups'); result.followups.slice(0,3).forEach(q => { const b = node('button', '', q); b.addEventListener('click', () => ask(q)); followups.append(b); }); message.append(followups);
  } catch (error) {
    body.replaceChildren(node('p', 'error-message', error.message || '检索失败，请重新提问。')); timing.textContent = '本次检索未完成';
    if (mode === 'semantic') {
      state.modelReady = false; state.mode = 'extractive'; configureEmbedder(null); unloadLocalModel(); renderMode();
      toast('本地 AI 已停止，已切换快速检索。可在右上角重新启用 AI。');
    }
  } finally { setBusy(false); $('#question').focus({ preventScroll: true }); scrollBottom(); }
}

function renderMode() {
  const semantic = state.mode === 'semantic'; $('#model-label').textContent = state.loading ? '模型加载中' : semantic ? '本地 AI 已就绪' : '快速检索';
  $('#model-open .tiny-tag').textContent = semantic ? '512 维' : '切换 AI';
  $('#mode-fast').classList.toggle('selected', !semantic); $('#mode-ai').classList.toggle('selected', semantic);
  $('#fast-state').textContent = semantic ? '切换' : '当前'; $('#ai-state').textContent = state.loading ? '加载中' : semantic ? '当前' : state.modelReady ? '切换' : '启用';
  $('#mode-ai').disabled = state.loading;
  $('#composer-note').textContent = semantic ? '本地 AI 理解语义 · 回答为相关原文摘录 · 每条引用均可核对' : '当前使用原文检索与摘录 · 启用本地 AI 可理解语义相近的问题';
}
async function enableAI() {
  if (isBusy() || state.loading) return;
  if (state.modelReady) { state.mode = 'semantic'; renderMode(); $('#model-dialog').close(); return; }
  state.loading = true; state.modelAbort = new AbortController(); $('#model-error').textContent = ''; $('#model-progress').hidden = false; renderMode();
  try {
    const embed = await loadLocalModel(event => {
      $('#progress-text').textContent = event.message || '正在加载本地模型…';
      const bar = $('#progress-bar'); if (Number.isFinite(event.progress)) bar.value = event.progress; else bar.removeAttribute('value');
    }, { signal: state.modelAbort.signal });
    configureEmbedder(embed); state.modelReady = true; state.mode = 'semantic'; toast('本地 AI 已启用，可以用不同表达检索资料。'); $('#model-dialog').close();
  } catch (error) { $('#model-error').textContent = error.message; if (error.name !== 'AbortError') toast('模型未能加载。快速检索仍可使用，可稍后重试。'); }
  finally { state.loading = false; state.modelAbort = null; $('#model-progress').hidden = true; renderMode(); }
}

// Dialogs use native focus management and Escape handling.
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
$('#question').maxLength = 1000;
$('#question-form').addEventListener('submit', event => { event.preventDefault(); ask($('#question').value); });
$('#question').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(event.currentTarget.value); } });
$('#clear-chat').addEventListener('click', () => { if (!isBusy()) { clearConversation(); toast('已开始新对话。'); } });
$('#nav-chat').addEventListener('click', () => { $('#library').classList.remove('mobile-open'); $('#question').focus(); });
$('#nav-docs').addEventListener('click', () => { if (matchMedia('(max-width: 750px)').matches) $('#library').classList.toggle('mobile-open'); else { $('#document-list').scrollIntoView({ block: 'nearest' }); toast('点击左侧资料即可阅读原文。'); } });
['#nav-about','#about-open'].forEach(id => $(id).addEventListener('click', () => openDialog('#about-dialog')));
$('#model-open').addEventListener('click', () => { renderMode(); openDialog('#model-dialog'); });
$('#mode-fast').addEventListener('click', () => { if (isBusy()) return; if (state.loading) state.modelAbort?.abort(); state.mode = 'extractive'; renderMode(); $('#model-dialog').close(); });
$('#mode-ai').addEventListener('click', enableAI);
$('#cancel-model').addEventListener('click', () => state.modelAbort?.abort());
$('#upload-button').addEventListener('click', () => { if (!isBusy()) $('#file-input').click(); });
$('#file-input').addEventListener('change', event => importFiles(event.target.files));
$('#cancel-import').addEventListener('click', () => state.importAbort?.abort());
$('#document-page').addEventListener('change', event => openDocument(state.selectedDoc, undefined, { pageNumber: Number(event.target.value) }));
['#manage-library', '#library-settings'].forEach(id => $(id).addEventListener('click', () => { renderStorage(); openDialog('#library-dialog'); }));
$('#persist-toggle').addEventListener('change', event => changePersistence(event.target.checked));
$('#save-now').addEventListener('click', () => { if (!isBusy()) queueSave(); });
$('#export-library').addEventListener('click', exportLibrary);
$('#restore-library').addEventListener('click', () => { if (!isBusy()) $('#backup-input').click(); });
$('#backup-input').addEventListener('change', event => restoreLibrary(event.target.files[0]));
['#paste-open','#paste-button'].forEach(id => $(id).addEventListener('click', () => { if (!isBusy()) openDialog('#paste-dialog'); }));
$('#paste-form').addEventListener('submit', event => { event.preventDefault(); if (isBusy()) return; try { addDocuments([{ id: crypto.randomUUID(), title: $('#paste-title').value.trim() || '未命名资料', text: $('#paste-content').value }]); $('#paste-form').reset(); $('#paste-dialog').close(); } catch (error) { toast(error.message); } });
$('#remove-document').addEventListener('click', () => { if (isBusy()) return; replaceDocuments(state.documents.filter(d => d.id !== state.selectedDoc)); $('#document-dialog').close(); toast('已移除资料，并清空旧引用。'); });
$('#reset-docs').addEventListener('click', () => { if (isBusy()) return; replaceDocuments(DEMO_DOCS); toast('已恢复示例资料，并清空当前对话。'); });
const dropZone = $('#drop-zone');
['dragenter','dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave','drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone.addEventListener('drop', event => importFiles(event.dataTransfer.files));
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { if (!dropZone.contains(event.target) && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); toast('请把文件拖到左侧导入区域。'); } });
[
  ['产品设计', '这个知识库如何避免 AI 编造答案？'],
  ['隐私与数据', '文档会被上传到服务器吗？'],
  ['效果评估', '如何评估检索效果？'],
  ['工程实践', '项目有哪些可以继续优化的方向？']
].forEach(([label, question]) => { const button = node('button', 'prompt-card'); button.append(node('span', '', label), node('b', '', question), icon('chevron')); button.addEventListener('click', () => ask(question)); $('#starter-prompts').append(button); });
window.addEventListener('pagehide', () => { state.importAbort?.abort(); state.modelAbort?.abort(); unloadLocalModel(); });
renderDocuments(); renderMode(); initializeLibrary();
