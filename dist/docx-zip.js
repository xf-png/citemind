/** Bounded read-only ZIP access for DOCX XML parts. Never writes archive paths. */
export const DOCX_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, entries: 2048, expanded: 64 * 1024 * 1024, xml: 4 * 1024 * 1024, text: 100000 });
export function docxError(code, message) { const error = new Error(message); error.name = 'DocxImportError'; error.code = code; return error; }
export function checkDocxAbort(signal) { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('已取消 Word 导入。', 'AbortError'); }
const invalid = () => docxError('DOCX_INVALID', 'Word 文件结构损坏或不是有效的 DOCX，请重新导出后导入。');
const unsupported = () => docxError('DOCX_UNSUPPORTED', '此 Word 压缩格式暂不支持，请重新保存为标准、未加密的 DOCX。');
const table = Uint32Array.from({ length: 256 }, (_, value) => { let c = value; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

export function openDocxArchive(input, { signal } = {}) {
  checkDocxAbort(signal);
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.length < 22) throw invalid();
  if (bytes.length > DOCX_LIMITS.bytes) throw docxError('DOCX_TOO_LARGE', '单份 Word 文件最大 10 MB，请拆分后导入。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true); const u32 = offset => view.getUint32(offset, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0) throw invalid();
  const count = u16(end + 10); const size = u32(end + 12); const offset = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw unsupported();
  if (!count || count > DOCX_LIMITS.entries) throw docxError('DOCX_ENTRY_LIMIT', 'Word 内部文件数量过多，请简化或拆分后导入。');
  if (offset + size > end || offset < 0) throw invalid();
  const entries = new Map(); const ranges = []; let position = offset; let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > offset + size || u32(position) !== 0x02014b50) throw invalid();
    const flags = u16(position + 8); const method = u16(position + 10); const crc = u32(position + 16);
    const compressed = u32(position + 20); const uncompressed = u32(position + 24); const nameLength = u16(position + 28);
    const extraLength = u16(position + 30); const commentLength = u16(position + 32); const local = u32(position + 42);
    if (flags & 0x2041) throw docxError('DOCX_ENCRYPTED', '暂不支持加密或需要密码的 Word 文件，请先解密后导入。');
    if (flags & 0x30 || ![0, 8].includes(method) || u16(position + 34) || [compressed, uncompressed, local].includes(0xffffffff)) throw unsupported();
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || nameLength > 1024 || next > offset + size) throw invalid();
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength);
    let name;
    try { name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'latin1', { fatal: true }).decode(nameBytes); } catch { throw invalid(); }
    if (/^[\/\\]|[\0\\]/.test(name) || name.split('/').some(part => part === '..' || part === '.') || entries.has(name)) throw invalid();
    expanded += uncompressed;
    if (expanded > DOCX_LIMITS.expanded) throw docxError('DOCX_EXPANDED_LIMIT', 'Word 解压后的内容过大，请移除大图片或拆分文档后导入。');
    if (local + 30 > offset || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) throw invalid();
    const localNameLength = u16(local + 26); const localExtraLength = u16(local + 28); const data = local + 30 + localNameLength + localExtraLength;
    if (localNameLength !== nameLength || data + compressed > offset || !nameBytes.every((byte, i) => byte === bytes[local + 30 + i])) throw invalid();
    const localValues = [u32(local + 14), u32(local + 18), u32(local + 22)]; const centralValues = [crc, compressed, uncompressed];
    if (localValues.some((value, i) => value !== centralValues[i] && (!(flags & 8) || value !== 0))) throw invalid();
    if (method === 0 && compressed !== uncompressed) throw invalid();
    entries.set(name, { name, method, crc, compressed, uncompressed, data }); ranges.push({ start: local, end: data + compressed }); position = next;
  }
  if (position !== offset + size) throw invalid();
  ranges.sort((a, b) => a.start - b.start);
  if (ranges.some((range, index) => index && range.start < ranges[index - 1].end)) throw invalid();

  async function read(name, limit = DOCX_LIMITS.xml) {
    checkDocxAbort(signal);
    const entry = entries.get(name); if (!entry) return null;
    if (!Number.isInteger(limit) || limit < 1 || limit > DOCX_LIMITS.xml) throw new RangeError('Invalid DOCX XML limit');
    if (entry.uncompressed > limit) throw docxError('DOCX_XML_LIMIT', 'Word 文字结构过大，请简化或拆分后导入。');
    const compressed = bytes.subarray(entry.data, entry.data + entry.compressed); let result;
    if (entry.method === 0) result = compressed.slice();
    else {
      let stream;
      try { stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
      catch { throw docxError('DOCX_BROWSER', '此浏览器不支持本地 Word 解压，请使用较新的 Chrome、Edge 或 Firefox。'); }
      const reader = stream.getReader(); const chunks = []; let length = 0;
      const abort = () => { reader.cancel().catch(() => {}); }; signal?.addEventListener('abort', abort, { once: true });
      try {
        if (signal?.aborted) abort();
        while (true) {
          checkDocxAbort(signal); const { value, done } = await reader.read(); checkDocxAbort(signal); if (done) break;
          length += value.length;
          if (length > limit || length > entry.uncompressed) throw docxError('DOCX_XML_LIMIT', 'Word 解压内容超出声明范围，请重新导出文件后导入。');
          chunks.push(value);
        }
        result = new Uint8Array(length); let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
      } catch (error) { if (error.name === 'AbortError' || error.name === 'DocxImportError') throw error; throw invalid(); }
      finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    checkDocxAbort(signal);
    if (result.length !== entry.uncompressed || crc32(result) !== entry.crc) throw docxError('DOCX_CHECKSUM', 'Word 文件内容校验失败，可能已损坏，请重新导出。');
    return result;
  }
  return { entries, read };
}
