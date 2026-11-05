import { exportResearchHtml } from './research-report.js';

export function mountReportExport({ getResearch, getDocuments, download, toast }) {
  const template = document.createElement('template');
  template.innerHTML = `<dialog id="report-dialog" class="dialog report-dialog" aria-labelledby="report-heading" aria-describedby="report-disclosure">
    <div class="dialog-heading"><div><span class="eyebrow">TAKE YOUR RESEARCH WITH YOU</span><h2 id="report-heading">生成研究报告</h2></div><button id="close-report" class="icon-button" aria-label="关闭报告预览">×</button></div>
    <p id="report-disclosure" class="report-disclosure">报告包含全部已收集证据及个人笔记。分享前请检查内容；网页文件下载后可独立阅读和打印。</p>
    <div class="report-options"><label><input id="report-include-sources" type="checkbox">附上所引资料的完整提取文字</label><p id="report-scope" role="status"></p></div>
    <iframe id="report-preview" title="研究报告预览" sandbox referrerpolicy="no-referrer"></iframe>
    <div class="dialog-footer"><span>阅读快照无法替代可恢复的 JSON 备份。</span><button class="primary-button" id="download-report">下载 HTML 报告</button></div>
  </dialog>`;
  document.body.append(template.content);
  const dialog = document.querySelector('#report-dialog'); const checkbox = dialog.querySelector('#report-include-sources'); const frame = dialog.querySelector('#report-preview');
  let session = null; let html = '';
  function render() {
    if (!session) return;
    html = exportResearchHtml(session.research, session.documents, { includeSources: checkbox.checked, exportedAt: session.exportedAt });
    frame.srcdoc = html;
    dialog.querySelector('#report-scope').textContent = `${session.research.cards.length} 条证据 · ${checkbox.checked ? '包含所引资料全文，可能含未摘录的内容' : '包含摘录和笔记，未加入资料全文'} · 按打开预览时的内容生成`;
  }
  dialog.querySelector('#close-report').addEventListener('click', () => dialog.close());
  checkbox.addEventListener('change', () => { try { render(); } catch (error) { toast(error.message); } });
  dialog.querySelector('#download-report').addEventListener('click', () => { if (html) download(html, `CiteMind-研究报告-${session.exportedAt.slice(0, 10)}.html`, 'text/html;charset=utf-8'); });
  dialog.addEventListener('close', () => { session = null; html = ''; frame.removeAttribute('srcdoc'); });
  return {
    open() {
      try {
        if (!getResearch().cards.length) return toast('先收集一些证据，再生成研究报告。');
        session = structuredClone({ research: getResearch(), documents: getDocuments(), exportedAt: new Date().toISOString() });
        checkbox.checked = false; render(); if (!dialog.open) dialog.showModal();
      } catch (error) { toast(error.message); }
    },
  };
}
