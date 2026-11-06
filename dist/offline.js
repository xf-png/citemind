/** Explicit opt-in; document persistence remains a separate user choice. */
export function mountOfflineControls({ toast }) {
  const $ = selector => document.querySelector(selector);
  const template = document.createElement('template');
  template.innerHTML = `<section class="offline-section"><span class="eyebrow">YOUR WORKSPACE, EVEN OFFLINE</span><h3>把工作台，也留在设备上</h3><p>完整离线包约 53 MB，包含网页、PDF 组件和本地 AI。准备完成后，可断网重新打开此地址。较大的 AI 组件可能需要多等一会儿；准备期间可关闭此窗口继续工作。资料和笔记仍需单独开启本地保存或导出备份。</p><div class="backup-actions"><button id="prepare-offline" class="secondary-button">准备完整离线包</button><button id="cancel-offline" class="text-button" hidden>取消本次准备</button><button id="clear-offline" class="text-button" hidden>移除离线包</button></div><p id="offline-status" class="storage-status" role="status">尚未准备离线包。</p><progress id="offline-progress" hidden max="100"></progress></section>`;
  $('#library-dialog .backup-section').after(template.content);
  const supported = globalThis.isSecureContext && 'serviceWorker' in navigator && 'caches' in globalThis;
  const workerURL = new URL('./sw.js', import.meta.url);
  const scopeURL = new URL('./', import.meta.url);
  let busy = false;
  let poll;
  let prepareWorker = null;
  let cancelled = false;
  const category = path => path.startsWith('models/') ? '中文 AI 模型' : path.includes('pdfjs') ? 'PDF 组件' : path.startsWith('vendor/') ? 'AI 运行组件' : '页面组件';
  function ours(registration) { return [registration?.active, registration?.waiting, registration?.installing].some(worker => worker?.scriptURL === workerURL.href); }
  async function registration() { const reg = supported ? await navigator.serviceWorker.getRegistration(scopeURL.href) : null; return ours(reg) ? reg : null; }
  function message(worker, type, timeout = 10_000) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); reject(new Error('离线包暂未响应，请稍后重试。')); }, timeout);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data); };
      try { worker.postMessage({ type }, [channel.port2]); } catch (error) { clearTimeout(timer); channel.port1.close(); reject(error); }
    });
  }
  async function refresh() {
    if (!supported) { $('#prepare-offline').disabled = true; $('#offline-status').textContent = '此浏览器或当前地址不支持离线包。请使用 HTTPS 或本机服务访问。'; return; }
    try {
      const reg = await registration(); const worker = reg?.installing || reg?.waiting || reg?.active;
      $('#clear-offline').hidden = !reg;
      if (!worker) { if (!busy) $('#offline-status').textContent = '尚未准备离线包。'; return; }
      const status = await message(worker, 'CITEMIND_OFFLINE_STATUS');
      const ready = status.ready;
      $('#prepare-offline').textContent = ready ? '检查离线包更新' : '准备完整离线包';
      $('#offline-progress').hidden = !busy;
      $('#offline-progress').value = Math.round(status.completed / status.resources * 100);
      const current = [...new Set((status.currentAssets || []).map(category))].join('、');
      $('#offline-status').textContent = reg.waiting && ready ? `新版离线包 ${status.version} 已准备。保存资料后，关闭本站所有页面并重开以启用。` : ready ? `离线包 ${status.version} 已就绪 · ${status.resources} 项资源 · ${(status.totalBytes / 1024 / 1024).toFixed(1)} MB。资料请另行保存。` : status.preparing ? `正在准备离线包：${status.completed} / ${status.resources} 项 · 已校验 ${(status.bytes / 1024 / 1024).toFixed(1)} MB${current ? ` · 当前：${current}` : ''}。` : '离线包不完整，请重新准备。';
    } catch (error) { if (!busy) $('#offline-status').textContent = error.message; }
  }
  function installed(worker) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('离线包准备超时，可保持网络连接后重试。')); }, 600_000);
      function changed() {
        if (['installed', 'activated'].includes(worker.state)) { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(); }
        else if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(new Error('离线包未能完成，可能是网络、资源校验或设备空间不足。可重试。')); }
      }
      worker.addEventListener('statechange', changed); changed();
    });
  }
  $('#prepare-offline').addEventListener('click', async () => {
    if (busy || !supported) return;
    busy = true; cancelled = false; prepareWorker = null; $('#prepare-offline').disabled = true; $('#clear-offline').disabled = true; $('#cancel-offline').hidden = false; $('#cancel-offline').disabled = true; $('#offline-progress').hidden = false; $('#offline-progress').removeAttribute('value'); $('#offline-status').textContent = '正在准备完整离线包，请保持此页面打开…';
    poll = setInterval(refresh, 700);
    async function waitForInstall(worker) { prepareWorker = worker; $('#cancel-offline').disabled = false; await installed(worker); }
    try {
      const reg = await navigator.serviceWorker.register(workerURL.href, { scope: scopeURL.href, updateViaCache: 'none' });
      if (reg.installing) await waitForInstall(reg.installing);
      else {
        await reg.update();
        if (reg.installing) await waitForInstall(reg.installing);
        else if (reg.waiting) await installed(reg.waiting);
        else if (reg.active) { prepareWorker = reg.active; $('#cancel-offline').disabled = false; await message(reg.active, 'CITEMIND_OFFLINE_PREPARE', 600_000); }
      }
      toast('离线包已准备完成。资料和研究笔记请另行保存。');
    } catch (error) { const text = cancelled ? '已取消本次准备，原有资料和已就绪的离线版本保留。' : error.message; $('#offline-status').textContent = text; toast(text); }
    finally { busy = false; prepareWorker = null; clearInterval(poll); $('#prepare-offline').disabled = false; $('#clear-offline').disabled = false; $('#cancel-offline').hidden = true; $('#offline-progress').hidden = true; await refresh(); }
  });
  $('#cancel-offline').addEventListener('click', async () => {
    if (!busy || !prepareWorker || cancelled) return;
    const worker = prepareWorker; cancelled = true; $('#cancel-offline').disabled = true;
    try { await message(worker, 'CITEMIND_OFFLINE_CANCEL'); }
    catch (error) { if (worker.state !== 'redundant') toast(error.message); }
  });
  $('#clear-offline').addEventListener('click', async () => {
    if (busy) return;
    busy = true; $('#clear-offline').disabled = true;
    try {
      const reg = await registration();
      // A waiting update and the active page may use different workers. Stop
      // both so an old controller cannot recreate its cache after removal.
      const workers = [...new Set([reg?.installing, reg?.waiting, reg?.active].filter(Boolean))];
      for (const worker of workers) await message(worker, 'CITEMIND_OFFLINE_CLEAR', 30_000);
      $('#offline-status').textContent = '离线包已移除，资料与笔记保持当前状态。'; $('#prepare-offline').textContent = '准备完整离线包'; $('#clear-offline').hidden = true; toast('已移除离线包。');
    }
    catch (error) { toast(error.message); }
    finally { busy = false; $('#clear-offline').disabled = false; }
  });
  document.querySelector('#library-dialog').addEventListener('toggle', event => { if (event.newState === 'open') refresh(); });
  refresh();
}
