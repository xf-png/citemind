/** Browser-local Word text extraction. Layout and physical Word pages are not inferred. */
import { DOCX_LIMITS, openDocxArchive, docxError, checkDocxAbort } from './docx-zip.js';

const WORD_NAMESPACES = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPE_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const bad = message => docxError('DOCX_INVALID', message || 'Word 正文结构损坏，请重新导出后导入。');

function parseXml(bytes, rootName, namespaces) {
  if (!bytes) throw bad('Word 缺少必要的正文或关联文件，请重新导出。');
  let encoding = 'utf-8';
  if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 60 && bytes[1] === 0)) encoding = 'utf-16le';
  else if ((bytes[0] === 254 && bytes[1] === 255) || (bytes[0] === 0 && bytes[1] === 60)) encoding = 'utf-16be';
  let text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { throw bad('Word 文字编码损坏，请重新导出。'); }
  const declared = text.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)/i)?.[1]?.toLowerCase();
  if (declared && !/^utf-?(8|16(?:le|be)?)$/.test(declared)) throw docxError('DOCX_ENCODING', '此 Word 文字编码暂不支持，请重新保存为 DOCX。');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw bad('Word XML 包含不支持的实体定义，请重新导出。');
  const xml = new DOMParser().parseFromString(text, 'application/xml'); const root = xml.documentElement;
  if (xml.getElementsByTagName('parsererror').length || root?.localName !== rootName || !namespaces.includes(root.namespaceURI)) throw bad();
  return root;
}

function resolvePart(base, target) {
  if (typeof target !== 'string' || !target || /[\\\0]/.test(target)) throw bad();
  let url; let name;
  try { url = new URL(target, `https://docx.invalid/${base}`); name = decodeURIComponent(url.pathname.slice(1)); } catch { throw bad(); }
  if (url.origin !== 'https://docx.invalid' || url.search || url.hash || !name || /[\\\0]/.test(name)) throw bad('Word 正文关联无效，请重新导出。');
  return name;
}

export async function parseDocxFile(file, { signal, onProgress } = {}) {
  checkDocxAbort(signal);
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) throw docxError('DOCX_EMPTY', '请选择一个非空 Word 文件。');
  if (file.size > DOCX_LIMITS.bytes) throw docxError('DOCX_TOO_LARGE', '单份 Word 文件最大 10 MB，请拆分后导入。');
  const controller = new AbortController(); const cancel = () => controller.abort(signal.reason); signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const active = controller.signal; const timer = setTimeout(() => controller.abort(docxError('DOCX_TIMEOUT', 'Word 解析超时，请拆分文档后重试。')), 30000);
  let rejectStopped; const stopped = new Promise((_, reject) => { rejectStopped = reject; }); stopped.catch(() => {});
  const stop = () => { try { checkDocxAbort(active); } catch (error) { rejectStopped(error); } }; active.addEventListener('abort', stop, { once: true }); if (active.aborted) stop();
  const progress = message => { try { onProgress?.({ status: 'parsing', message }); } catch {} checkDocxAbort(active); };
  try {
    progress('正在本地读取 Word 文件…'); const archive = openDocxArchive(await Promise.race([file.arrayBuffer(), stopped]), { signal: active });
    const types = parseXml(await archive.read('[Content_Types].xml', 512 * 1024), 'Types', [TYPE_NS]);
    const relationships = parseXml(await archive.read('_rels/.rels', 128 * 1024), 'Relationships', [REL_NS]);
    const mains = [...relationships.children].filter(row => row.namespaceURI === REL_NS && row.localName === 'Relationship' && /\/officeDocument$/.test(row.getAttribute('Type') || ''));
    if (mains.length !== 1 || mains[0].getAttribute('TargetMode') === 'External') throw bad();
    const main = resolvePart('', mains[0].getAttribute('Target'));
    const contentType = [...types.children].find(row => row.namespaceURI === TYPE_NS && row.localName === 'Override' && resolvePart('', row.getAttribute('PartName')) === main)?.getAttribute('ContentType');
    if (contentType !== MAIN_TYPE) throw docxError('DOCX_TYPE', '请选择标准 DOCX 文档；暂不支持旧版 DOC、宏文档或模板。');
    progress('正在提取正文与表格…');
    const root = parseXml(await archive.read(main), 'document', WORD_NAMESPACES); const ns = root.namespaceURI;
    const word = (node, name) => node?.nodeType === 1 && node.namespaceURI === ns && node.localName === name;
    const children = node => [...node.children]; const attr = (node, name) => node.getAttributeNS(ns, name);
    const body = children(root).find(node => word(node, 'body')); if (!body) throw bad();
    const references = new Map(); const warnings = new Set(); let paragraphCount = 0; let textLength = 0;
    const bounded = text => { textLength += text.length; if (textLength > DOCX_LIMITS.text) throw docxError('DOCX_TEXT_LIMIT', 'Word 提取文字超过 100,000 字，请拆分后导入。'); return text; };
    function runs(node, depth = 0) {
      if (depth > 96) throw bad('Word 嵌套结构过深，请简化后导入。');
      if (word(node, 'del') || word(node, 'moveFrom') || word(node, 'instrText')) return '';
      if (word(node, 'r')) {
        const properties = children(node).find(child => word(child, 'rPr'));
        const hidden = properties && children(properties).some(child => word(child, 'vanish') && !['0', 'false', 'off'].includes(attr(child, 'val')));
        if (hidden) { warnings.add('部分隐藏文字未导入'); return ''; }
      }
      if (word(node, 't')) return bounded(node.textContent);
      if (word(node, 'tab')) return bounded('\t');
      if (word(node, 'br') || word(node, 'cr')) return bounded('\n');
      if (word(node, 'noBreakHyphen')) return bounded('‑');
      if (word(node, 'softHyphen')) return bounded('\u00ad');
      if (word(node, 'footnoteReference') || word(node, 'endnoteReference')) {
        const kind = node.localName === 'footnoteReference' ? 'footnotes' : 'endnotes'; const id = attr(node, 'id');
        if (!/^\d{1,10}$/.test(id || '') || references.size > 1000) throw bad();
        const key = `${kind}:${id}`; if (!references.has(key)) references.set(key, { kind, id, number: references.size + 1 });
        return bounded(`〔${kind === 'footnotes' ? '脚注' : '尾注'} ${references.get(key).number}〕`);
      }
      return children(node).map(child => runs(child, depth + 1)).join('');
    }
    function blocks(parent, depth = 0) {
      if (depth > 64) throw bad('Word 表格或内容层级过深，请简化后导入。');
      const out = [];
      for (const node of children(parent)) {
        if (word(node, 'p')) { paragraphCount++; out.push(runs(node)); }
        else if (word(node, 'tbl')) {
          for (const row of children(node).filter(child => word(child, 'tr'))) {
            out.push(children(row).filter(child => word(child, 'tc')).map(cell => blocks(cell, depth + 1).join('\n')).join('\t'));
          }
        } else if (word(node, 'altChunk')) warnings.add('部分嵌入内容未导入，请在 Word 中另存后核对');
        else if (!word(node, 'sectPr') && !word(node, 'del') && !word(node, 'moveFrom')) out.push(...blocks(node, depth + 1));
      }
      return out;
    }
    const parts = blocks(body);
    if (references.size) {
      progress('正在提取引用的脚注与尾注…');
      const at = main.lastIndexOf('/'); const mainRels = main.slice(0, at + 1) + '_rels/' + main.slice(at + 1) + '.rels';
      const rels = parseXml(await archive.read(mainRels, 128 * 1024), 'Relationships', [REL_NS]); const notes = new Map();
      for (const reference of references.values()) {
        checkDocxAbort(active);
        if (!notes.has(reference.kind)) {
          const rel = children(rels).find(node => node.namespaceURI === REL_NS && node.localName === 'Relationship' && (node.getAttribute('Type') || '').endsWith(`/${reference.kind}`));
          if (!rel || rel.getAttribute('TargetMode') === 'External') throw bad('Word 脚注关联缺失，请重新导出后导入。');
          const noteRoot = parseXml(await archive.read(resolvePart(main, rel.getAttribute('Target')), 1024 * 1024), reference.kind, [ns]);
          notes.set(reference.kind, new Map(children(noteRoot).filter(node => word(node, reference.kind === 'footnotes' ? 'footnote' : 'endnote') && (!attr(node, 'type') || attr(node, 'type') === 'normal')).map(node => [attr(node, 'id'), node])));
        }
        const note = notes.get(reference.kind).get(reference.id); if (!note) throw bad('Word 引用的脚注内容缺失，请重新导出。');
        parts.push(`〔${reference.kind === 'footnotes' ? '脚注' : '尾注'} ${reference.number}〕\n${blocks(note).join('\n\n')}`);
      }
    }
    checkDocxAbort(active); const text = parts.join('\n\n').trim();
    if (text.length > DOCX_LIMITS.text) throw docxError('DOCX_TEXT_LIMIT', 'Word 提取文字超过 100,000 字，请拆分后导入。');
    if (!text) throw docxError('DOCX_NO_TEXT', 'Word 中没有可提取的正文；图片和扫描内容需要先转换为文字。');
    progress('Word 文字已提取，可核对后检索。'); return { text, paragraphCount, warnings: [...warnings] };
  } catch (error) { if (error.name === 'AbortError' || error.name === 'DocxImportError') throw error; throw bad(); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); active.removeEventListener('abort', stop); }
}
