/** Selectable-text PDF import. No OCR, PDF upload, embedded-script execution, or rendering. */
const PDFJS_VERSION = '6.4.299';
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 80;
const MAX_TEXT = 100000;
const TIMEOUT_MS = 120000;
let libraryPromise = null;
let libraryAttempt = 0;

function pdfError(code, message) {
  const error = new Error(message);
  error.name = 'PdfImportError';
  error.code = code;
  return error;
}

function abortError() {
  return new DOMException('已取消 PDF 导入，可以重新选择文件。', 'AbortError');
}

function progress(callback, event) {
  try { callback?.(event); } catch { /* UI callbacks must not interrupt parsing. */ }
}

function loadLibrary() {
  if (!libraryPromise) {
    // Retry a failed module fetch with a fresh URL while keeping its version pinned.
    const suffix = libraryAttempt ? `?retry=${libraryAttempt}` : '';
    libraryPromise = import(`${PDFJS_CDN}build/pdf.min.mjs${suffix}`).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}build/pdf.worker.min.mjs`;
      return pdfjs;
    }).catch(() => {
      libraryPromise = null;
      libraryAttempt++;
      throw pdfError('PDF_RUNTIME', 'PDF 组件加载失败，请检查网络后重试。首次导入需要从公共 CDN 下载组件，文件不会上传。');
    });
  }
  return libraryPromise;
}

function describeError(error) {
  if (error?.name === 'AbortError' || (typeof error?.code === 'string' && error.code.startsWith('PDF_'))) return error;
  if (error?.name === 'PasswordException') return pdfError('PDF_ENCRYPTED', '暂不支持加密或需要密码的 PDF，请先解密后重新导入。');
  if (/fetch|network|setting up fake worker|worker.*failed/i.test(error?.message || '')) {
    return pdfError('PDF_RUNTIME', 'PDF 组件或字体数据加载失败，请检查网络后重试。文件不会上传。');
  }
  return pdfError('PDF_INVALID', '无法解析此 PDF，文件可能已损坏或格式不受支持。请重新导出后导入。');
}

/**
 * Extract text locally with Mozilla PDF.js 6.4.299, loaded only on first PDF import.
 * Pages follow physical PDF page numbers, including empty pages. start/end are
 * UTF-16 offsets into text; page.text === text.slice(page.start, page.end).
 * Page separators are two newlines. Complex column/table reading order follows
 * the PDF text layer and may require review. Image-only PDFs are not OCR'd.
 *
 * @param {File|Blob} file
 * @param {{onProgress?: Function, signal?: AbortSignal}} [options]
 * @returns {Promise<{text: string, pages: Array<{pageNumber: number, text: string, start: number, end: number}>, pageCount: number}>}
 * @see https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html
 */
export async function parsePdfFile(file, { onProgress, signal } = {}) {
  if (signal?.aborted) throw abortError();
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) {
    throw pdfError('PDF_EMPTY', '请选择一个非空 PDF 文件。');
  }
  if (file.size > MAX_BYTES) throw pdfError('PDF_TOO_LARGE', '单份 PDF 最大 10 MB，请压缩或拆分后导入。');

  let task = null;
  let worker = null;
  let stopped = null;
  let rejectStopped;
  const stopPromise = new Promise((_, reject) => { rejectStopped = reject; });
  stopPromise.catch(() => {});
  const stop = error => { if (!stopped) { stopped = error; rejectStopped(error); } };
  const abort = () => stop(abortError());
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => stop(pdfError('PDF_TIMEOUT', 'PDF 解析超时，请检查网络，或将文件拆分后重试。')), TIMEOUT_MS);
  const wait = async promise => {
    // Always attach a rejection handler, including operations created by an
    // onProgress callback that aborted synchronously just before this call.
    return Promise.race([promise, stopPromise]);
  };

  try {
    progress(onProgress, { status: 'loading', message: '正在读取 PDF 文件…' });
    const buffer = await wait(file.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) throw pdfError('PDF_TOO_LARGE', '单份 PDF 最大 10 MB，请压缩或拆分后导入。');
    const header = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength)));
    if (!header.includes('%PDF-')) throw pdfError('PDF_INVALID', '文件不是有效的 PDF，请确认格式后重新导入。');
    progress(onProgress, { status: 'loading', message: '正在准备 PDF 解析组件，首次使用需要下载…' });
    const pdfjs = await wait(loadLibrary());
    worker = new pdfjs.PDFWorker({ name: 'citemind-pdf-import' });
    task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      worker,
      cMapUrl: `${PDFJS_CDN}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_CDN}standard_fonts/`,
      wasmUrl: `${PDFJS_CDN}wasm/`,
      useWorkerFetch: true,
      disableFontFace: true,
      stopAtErrors: true,
      enableXfa: false,
    });
    // Do not open password prompts or retain any document passwords.
    task.onPassword = () => stop(pdfError('PDF_ENCRYPTED', '暂不支持加密或需要密码的 PDF，请先解密后重新导入。'));
    const pdf = await wait(task.promise);
    if (pdf.numPages > MAX_PAGES) throw pdfError('PDF_TOO_MANY_PAGES', '单份 PDF 最多 80 页，请拆分后导入。');
    const metadata = await wait(pdf.getMetadata());
    const permissions = await wait(pdf.getPermissions());
    // Also reject encrypted files that open with an empty user password.
    if (metadata.info?.EncryptFilterName || permissions !== null) {
      throw pdfError('PDF_ENCRYPTED', '暂不支持加密或受权限保护的 PDF，请先解密后重新导入。');
    }

    const pages = [];
    const parts = [];
    let length = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      progress(onProgress, { status: 'parsing', message: `正在读取第 ${pageNumber} / ${pdf.numPages} 页…`, pageNumber, pageCount: pdf.numPages, progress: Math.round((pageNumber - 1) / pdf.numPages * 100) });
      const page = await wait(pdf.getPage(pageNumber));
      const pieces = [];
      let pageLength = 0;
      try {
        // PDF.js consumes its own text stream, which also avoids cancel/close
        // races between a manually cancelled reader and worker destruction.
        const content = await wait(page.getTextContent({ includeMarkedContent: false, disableNormalization: false }));
        for (const item of content.items) {
          if (typeof item.str !== 'string') continue;
          const str = item.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n');
          pieces.push(str);
          pageLength += str.length;
          if (item.hasEOL) { pieces.push('\n'); pageLength++; }
          if (length + pageLength > MAX_TEXT) throw pdfError('PDF_TOO_MUCH_TEXT', 'PDF 提取文本最多 10 万字符，请拆分后导入。');
        }
      } finally {
        page.cleanup();
      }
      const text = pieces.join('').replace(/[ \t]+\n/g, '\n').trim();
      if (pages.length) { parts.push('\n\n'); length += 2; }
      const start = length;
      parts.push(text);
      length += text.length;
      if (length > MAX_TEXT) throw pdfError('PDF_TOO_MUCH_TEXT', 'PDF 提取文本最多 10 万字符，请拆分后导入。');
      pages.push({ pageNumber, text, start, end: length });
    }
    const text = parts.join('');
    if (!/[\p{L}\p{N}]/u.test(text)) {
      throw pdfError('PDF_NO_TEXT', '此 PDF 没有可提取的文字，可能是扫描件或图片 PDF。当前不支持 OCR，请先识别文字或改用 TXT / Markdown。');
    }
    progress(onProgress, { status: 'ready', message: `已读取 ${pdf.numPages} 页 PDF`, pageCount: pdf.numPages, progress: 100 });
    return { text, pages, pageCount: pdf.numPages };
  } catch (error) {
    throw describeError(stopped || error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // PDFWorker is owned by this import, independent of AI's model.js Worker.
    // Give PDF.js a brief orderly shutdown, then terminate even if startup stalled.
    if (task) {
      let cleanupTimer;
      try {
        await Promise.race([task.destroy().catch(() => {}), new Promise(resolve => { cleanupTimer = setTimeout(resolve, 500); })]);
      } finally { clearTimeout(cleanupTimer); }
    }
    worker?.destroy();
  }
}
