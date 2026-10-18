/** Optional, browser-local document persistence. No DOM, network, or model data. */
import { prepareDocuments } from './engine.js';

const FORMAT = 'citemind.knowledge-base';
const VERSION = 1;
const DB_NAME = 'citemind-library';
const STORE_NAME = 'workspaces';
const WORKSPACE_KEY = 'current';
const PREFERENCE_KEY = 'citemind.persistence.enabled';
const MAX_BACKUP_LENGTH = 6 * 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Rebuild all chunks from whitelisted fields; never trust imported indexes. */
export function validateLibrary(rawDocs) {
  if (!Array.isArray(rawDocs)) throw new TypeError('知识库必须包含文档列表。');
  if (rawDocs.length > 20) throw new RangeError('知识库最多支持 20 篇文档。');
  let total = 0;
  const ids = new Set();
  const clean = rawDocs.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 160
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
      || typeof item.text !== 'string') {
      throw new TypeError('文档需要有效的标识、标题和原文（标识最多 160 字，标题最多 200 字）。');
    }
    if (ids.has(item.id)) throw new TypeError('文档标识重复，请重新导出或导入原始文档。');
    ids.add(item.id);
    if (item.text.length > 100_000) throw new RangeError('单篇文档不能超过 100,000 字，请先拆分。');
    total += item.text.length;
    if (total > 250_000) throw new RangeError('知识库原文总量不能超过 250,000 字。');
    const doc = { id: item.id, title: item.title, text: item.text };
    if (item.type !== undefined && item.type !== 'pdf') throw new TypeError('不支持的文档类型。');
    if (item.type === 'pdf' || item.pages !== undefined) {
      if (!Array.isArray(item.pages)) throw new TypeError('PDF 需要有效的页码信息。');
      doc.type = 'pdf';
      doc.pages = item.pages.map(page => {
        if (!isRecord(page)) throw new TypeError('PDF 页码信息格式不正确。');
        return { pageNumber: page.pageNumber, text: page.text, start: page.start, end: page.end };
      });
    }
    return doc;
  });
  const prepared = prepareDocuments(clean);
  // Engine normalization must not make two otherwise distinct IDs collide.
  if (prepared.some(doc => !ids.has(doc.id))) {
    throw new TypeError('文档标识包含无效字符，请重新导入原始文档。');
  }
  return prepared;
}

function rawDocuments(prepared) {
  return prepared.map(doc => {
    const result = { id: doc.id, title: doc.title, text: doc.text };
    if (doc.type === 'pdf') {
      result.type = 'pdf';
      result.pages = doc.pages.map(page => ({ pageNumber: page.pageNumber, text: page.text, start: page.start, end: page.end }));
    }
    return result;
  });
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateEnvelope(value, dateField) {
  if (!isRecord(value) || value.format !== FORMAT || value.version !== VERSION) {
    throw new TypeError('备份格式或版本不受支持，请选择 CiteMind v1 知识库备份。');
  }
  if (!validDate(value[dateField])) throw new TypeError('备份时间格式不正确。');
  return validateLibrary(value.documents);
}

/** Portable plain JSON; excludes embeddings, chunks, conversations, and PDF files. */
export function serializeBackup(rawDocs) {
  return JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), documents: rawDocuments(validateLibrary(rawDocs)) }, null, 2);
}

export function parseBackup(text) {
  if (typeof text !== 'string') throw new TypeError('备份必须是 JSON 文本。');
  if (text.length > MAX_BACKUP_LENGTH) throw new RangeError('备份文件过大，最多支持 6 MB 文本。');
  let value;
  try { value = JSON.parse(text); }
  catch { throw new TypeError('备份不是有效的 JSON 文件。'); }
  return validateEnvelope(value, 'exportedAt');
}

/** localStorage contains this boolean preference only, never user documents. */
export function persistenceEnabled() {
  try {
    return globalThis.localStorage?.getItem(PREFERENCE_KEY) === 'true';
  } catch { return false; }
}

export function setPersistenceEnabled(enabled) {
  if (typeof enabled !== 'boolean') throw new TypeError('本地保存设置必须是布尔值。');
  try {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error('localStorage unavailable');
    storage.setItem(PREFERENCE_KEY, String(enabled));
    if (storage.getItem(PREFERENCE_KEY) !== String(enabled)) throw new Error('preference write failed');
  } catch { throw new Error('此浏览器无法保存本地设置，请允许站点存储或改用 JSON 备份。'); }
}

function indexedDBFactory() {
  if (!globalThis.indexedDB) throw new Error('此浏览器不支持本地知识库保存，请使用 JSON 备份。');
  return globalThis.indexedDB;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    try { request = indexedDBFactory().open(DB_NAME, VERSION); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onblocked = () => fail(new Error('本地知识库被其他标签页占用，请关闭其他 CiteMind 页面后重试。'));
    request.onerror = () => fail(request.error || new Error('无法打开本地知识库。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (settled) { db.close(); return; }
      settled = true;
      resolve(db);
    };
  });
}

async function transact(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    let result;
    let request;
    let operationError;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      db.close();
      if (error) reject(error); else resolve(result);
    };
    try {
      tx = db.transaction(STORE_NAME, mode);
      tx.oncomplete = () => finish();
      tx.onabort = () => finish(operationError || tx.error || request?.error || new Error('本地知识库操作已中止。'));
      tx.onerror = () => finish(operationError || tx.error || request?.error || new Error('本地知识库读写失败，请导出 JSON 备份。'));
      request = operation(tx.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
    } catch (error) {
      operationError = error;
      if (tx) {
        try { tx.abort(); } catch { finish(error); }
      } else finish(error);
    }
  });
}

export async function readLibrary() {
  if (!persistenceEnabled()) return null;
  const stored = await transact('readonly', store => store.get(WORKSPACE_KEY));
  if (!persistenceEnabled()) return null;
  if (stored === undefined) return null;
  return { documents: validateEnvelope(stored, 'savedAt'), savedAt: stored.savedAt };
}

export async function writeLibrary(rawDocs) {
  if (!persistenceEnabled()) throw new Error('请先开启“在此浏览器保存知识库”。');
  const documents = rawDocuments(validateLibrary(rawDocs));
  const savedAt = new Date().toISOString();
  await transact('readwrite', store => {
    if (!persistenceEnabled()) throw new Error('本地保存已关闭，未保存资料。');
    return store.put({ format: FORMAT, version: VERSION, savedAt, documents }, WORKSPACE_KEY);
  });
  return { savedAt };
}

/** Delete the database without opening a connection, including when opted out. */
export async function clearLibrary() {
  return new Promise((resolve, reject) => {
    let request;
    try { request = indexedDBFactory().deleteDatabase(DB_NAME); }
    catch (error) { reject(error); return; }
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('无法清除本地知识库。'));
    request.onblocked = () => reject(new Error('请关闭其他 CiteMind 页面，再清除本地知识库。'));
  });
}
