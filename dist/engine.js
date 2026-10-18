/**
 * CiteMind retrieval engine. No network calls, API keys, DOM access, or HTML output.
 *
 * Public contract:
 *   DEMO_DOCS: Array<{id, title, text}>
 *   prepareDocuments(rawDocs): Array<{id, title, text, chunks, type?, pages?}>
 *   retrieve(question, rawOrPreparedDocs, {limit=4, minScore=0.12}={}): Evidence[]
 *   configureEmbedder(fn|null): fn(texts: string[]) -> Promise<number[][]>
 *   answerQuestion({question, documents, mode='extractive'}): Promise<Result>
 *
 * PDF input = {id, title, text, type:'pdf', pages:[{pageNumber,text,start,end}]}.
 * PDF text is retained exactly; page offsets use JavaScript UTF-16 string indices.
 * Evidence = {id: document id, title, excerpt: verbatim text, score, chunkId,
 *             start, end, pageNumber?}. Offsets address the prepared document.
 * Result = {answer, sources: Evidence[], mode, elapsedMs, followups}.
 * Scores are retrieval ranking values, never calibrated confidence probabilities.
 * Both modes return verbatim evidence, not language-model-generated prose.
 * Semantic mode uses an injected local embedding model; no silent mode fallback.
 * All returned strings are plain text. Render them with textContent, not innerHTML.
 */

export const DEMO_DOCS = [
  {
    id: 'product',
    title: '产品设计说明',
    text: `# 证据 · CiteMind 产品设计说明
证据是一个面向个人资料的轻量知识库问答应用。用户可以导入 TXT、Markdown 或带可提取文字的 PDF 文档，围绕资料提问，并在答案旁查看相关原文和来源。演示文档为虚构的产品资料，用于体验功能，不代表真实业务效果。
产品重点解决三个问题：资料分散难查找、关键词搜索难理解同义表达、阅读 AI 回答时难以核对依据。核心流程是导入资料、建立分块索引、输入问题、检索证据、阅读原文。
应用提供两种检索方式。关键词模式根据问题与原文的词语匹配工作，无需模型即可使用。本地 AI 模式下载中文嵌入模型，在浏览器中计算语义向量，帮助找到表达不同但含义相近的段落。两种模式都会展示原文摘录，不会伪装成大语言模型生成的答案。
答案中的编号与来源卡片一一对应。点击来源可以核对命中的文档标题与原文。PDF 按页提取文字并保留页码引用，分块不会跨页；当前不提供 OCR，只有扫描图片而没有文字层的 PDF 无法直接检索。没有找到足够相关的资料时，应用应明确提示资料不足，避免补充没有依据的事实。
资料默认仅保存在当前页面。用户可以选择开启本机保存，将知识库存入当前浏览器的 IndexedDB；也可以导出和恢复 JSON 知识库备份。备份包含文档文字和 PDF 页码信息，不包含原始 PDF 文件、聊天记录或模型缓存。问答和引用另外支持导出为 Markdown。
目标用户包括需要整理课程笔记的学生、准备项目面试的求职者，以及经常查询产品文档的个人开发者。界面优先支持中文资料，同时保留对英文技术词语的检索能力。`,
  },
  {
    id: 'retrieval',
    title: '检索与引用策略',
    text: `# 检索与引用策略
文档首先按句子和段落边界切分为较短的文本块。分块保留文档标识、标题、原文位置和分块编号，使检索结果能够追溯到原文。相邻分块保留少量重叠内容，降低关键信息被边界切开的风险。
关键词检索使用中文分词与连续汉字片段，并结合英文单词匹配。检索评分参考 BM25，综合词语出现频率、词语在资料中的稀有程度和文本块长度。常见问句词会被过滤，以减少无意义匹配。
本地 AI 检索使用中文嵌入模型，把问题和文档块编码为向量，再根据余弦相似度排序。系统同时参考关键词结果，将语义接近程度和字面证据结合。向量只在当前页面内存中缓存，避免对同一资料重复计算。
避免 AI 编造答案的核心做法是把输出限制为检索到的原文。系统不会把外部知识混入资料答案，也不会把相似度分数当成事实可信度。每个引用编号对应一个真实存在的文本块，引用摘录必须来自该文本块。
当相关性不足、资料为空或提问与资料无关时，返回资料不足提示，并建议补充文档或换一种提问方式。当前版本不调用生成式大语言模型，因此不会声称具有生成式总结或复杂推理能力。`,
  },
  {
    id: 'privacy',
    title: '数据与隐私说明',
    text: `# 数据与隐私说明
导入的文档在浏览器内解析和检索，不会上传到应用服务器，也不会发送给远程大语言模型接口。关键词模式不需要下载模型，可以直接对已导入资料进行本地检索。
首次开启本地 AI 时，浏览器需要从模型托管服务和公共 CDN 下载模型、分词器及推理运行库。下载行为会产生普通网络请求，但应用不会把用户文档或问题放入这些下载请求。
模型下载后在浏览器运行，问题与文档的向量也在本地计算。浏览器可能缓存模型资源，以减少下次加载时的重复下载。模型缓存由浏览器管理，清除站点数据或浏览器缓存可能导致下次重新下载。
知识库的本机保存默认关闭，未开启时资料仅存在于当前页面内存，刷新会恢复示例资料。开启本机保存后，资料文字与 PDF 页码信息保存在当前浏览器的 IndexedDB，不会同步到其他设备。清除站点数据、使用无痕窗口或换设备后，本地资料可能不可用，用户应自行保留原始文档。
JSON 知识库备份包含文档标题、文字与 PDF 分页信息，恢复时重新建立索引；它不包含原始 PDF 文件、聊天记录或模型缓存。备份文件包含资料原文，用户应妥善保管。页面内的向量缓存与浏览器中的模型缓存也不等于知识库备份。
本项目不要求 API Key，不提供账户系统，不主动采集用户上传文档。使用部署服务时，服务商仍可能记录常规访问日志。涉及敏感资料时，用户应先确认设备和浏览器环境适合处理这些资料。`,
  },
  {
    id: 'evaluation',
    title: '评估与测试方案',
    text: `# 评估与测试方案
评估应覆盖检索正确性、引用可追溯性与交互稳定性。可以先建立人工标注的问题集合，为每个问题记录应该命中的文档或段落，再对比关键词模式与本地 AI 模式的表现。
检索效果可以使用 Recall@K 和 MRR。Recall@K 衡量前 K 个结果是否覆盖人工标注的相关内容；MRR 衡量首个正确结果出现的位置。没有完成标注和测试前，不应在项目介绍中填写虚构准确率或提升幅度。
引用测试应检查来源编号是否存在、摘录是否能在对应文档中找到、无关问题是否被明确拒答，以及删除资料后是否仍出现旧引用。空问题、重复标题、长文档、中英文混合输入和恶意 HTML 文本也需要覆盖。
性能测试应分别记录模型首次下载耗时、已缓存模型的加载耗时、资料首次向量化耗时以及单次检索耗时。不同设备、浏览器和网络会影响结果，因此耗时应以当前实际测量为准。
当前演示展示的响应耗时在每次检索时现场计算，不是预先设定的宣传指标。检索相关性是排序信息，不应以百分比方式解释为答案正确概率。`,
  },
  {
    id: 'roadmap',
    title: '上线与迭代计划',
    text: `# 上线与迭代计划
当前静态网页版本支持示例知识库、导入 TXT、Markdown 和带文字层的 PDF、关键词检索、引用查看以及可选的浏览器本地语义检索。PDF 资料按页提取文字并标注引用页码，当前不支持扫描图片的 OCR 识别。静态部署便于分享访问链接，面试官无需安装环境即可体验。
当前版本已使用独立 Web Worker 加载模型与计算向量，减少推理对界面交互的影响，并支持将问答和引用导出为 Markdown。资料可选择保存在当前浏览器的 IndexedDB，该选项默认关闭；JSON 知识库备份与恢复可保存文档文字和 PDF 分页信息，不包含原始 PDF、聊天记录或模型缓存。
后续可以增加 PDF 扫描件的 OCR 文字识别，并建立规模更大、人工标注的检索评估集。当文档数量增加时，可以考虑增量索引和近似最近邻检索；更新某一篇文档时只重新计算受影响的分块，而不是重建所有文档向量。
如果未来接入生成式大语言模型，应把文档内容视为不可信输入，明确约束回答只能使用检索依据，并在服务端保护 API Key。新增远程能力前应清楚告知用户哪些内容会被发送到第三方。
项目展示可以说明问题拆解、文档分块、中文检索、向量相似度、引用验证和浏览器端推理等设计。实际成果应以可访问演示、源代码与真实测试记录为依据，不应编造用户量或业务收益。`,
  },
];

const STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '与', '或', '也', '有', '我', '你', '它', '们',
  '怎么', '如何', '什么', '哪些', '为什么', '是否', '能否', '可以', '能够',
  '这个', '那个', '这些', '那些', '一下', '请问', '请', '帮我', '告诉', '介绍',
  '一下子', '对于', '关于', '有没有', '是不是', '会不会', '吗', '呢', '啊', '呀',
  'the', 'a', 'an', 'is', 'are', 'to', 'for', 'and', 'or', 'of', 'how', 'what', 'does',
]);
const QUESTION_PHRASES = /请问|请帮我|帮我|告诉我|一下|这个|那个|这些|那些|如何|怎么|什么|哪些|为什么|是否|能否|可以|能够|有没有|是不是|会不会|吗|呢|呀|啊/gu;
const CHUNK_SIZE = 420;
const CHUNK_OVERLAP = 64;
const MAX_DOCUMENTS = 100;
const MAX_DOCUMENT_LENGTH = 250_000;
const MAX_CORPUS_LENGTH = 2_000_000;
const MAX_PDF_PAGES = 80;
let embedder = null;
let modelRevision = 0;
const vectorCache = new Map();
const sentenceVectorCache = new Map();
let segmenter;
try {
  segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
} catch { /* Character n-grams below work in browsers without Intl.Segmenter. */ }

function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').normalize('NFC');
}

function tokens(value, isQuestion = false) {
  let text = cleanText(value).toLocaleLowerCase();
  if (isQuestion) text = text.replace(QUESTION_PHRASES, ' ');
  const found = [];
  if (segmenter) {
    for (const part of segmenter.segment(text)) {
      const word = part.segment.trim();
      if (part.isWordLike && word.length > 1 && !STOPWORDS.has(word)) found.push(word);
    }
  }
  for (const match of text.matchAll(/[a-z0-9][a-z0-9_+.#-]*|[\p{Script=Han}]+/gu)) {
    const word = match[0];
    if (/^[a-z0-9]/u.test(word)) {
      if (!STOPWORDS.has(word)) found.push(word);
    } else if (word.length > 1) {
      // Questions use actual segmented terms where available. Adding crossing
      // bigrams as separate query concepts would overcount e.g. 知识 + 识库.
      // Corpus bigrams remain useful for matching compound words and fallback.
      const covered = new Set();
      if (isQuestion && segmenter) {
        for (const term of found.filter(term => /\p{Script=Han}/u.test(term))) {
          let at = word.indexOf(term);
          while (at >= 0) {
            for (let offset = at; offset < at + term.length; offset++) covered.add(offset);
            at = word.indexOf(term, at + 1);
          }
        }
      }
      for (let i = 0; i < word.length - 1; i++) {
        // Keep fallback pairs for runs segmented as single characters (e.g.
        // 文 / 档), but do not add crossing grams around recognized words.
        if (covered.has(i) || covered.has(i + 1)) continue;
        const pair = word.slice(i, i + 2);
        if (!STOPWORDS.has(pair)) found.push(pair);
      }
    }
  }
  return found;
}

function hash(value) {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return (n >>> 0).toString(36);
}

function makeChunks(doc) {
  const chunks = [];
  const ranges = doc.type === 'pdf' ? doc.pages : [{ start: 0, end: doc.text.length }];
  for (const range of ranges) {
    let start = range.start;
    while (start < range.end) {
      let end = Math.min(start + CHUNK_SIZE, range.end);
      if (end < range.end) {
        const window = doc.text.slice(start + Math.floor(CHUNK_SIZE * 0.55), end);
        const boundaries = [...window.matchAll(/[。！？!?；;\n]/gu)];
        const last = boundaries.at(-1);
        if (last) end = start + Math.floor(CHUNK_SIZE * 0.55) + last.index + 1;
      }
      const content = doc.text.slice(start, end);
      if (content.trim()) {
        const chunk = { chunkId: `${doc.id}:chunk-${chunks.length + 1}`, documentId: doc.id, title: doc.title, text: content, start, end };
        if (range.pageNumber !== undefined) chunk.pageNumber = range.pageNumber;
        chunks.push(chunk);
      }
      if (end === range.end) break;
      // A guaranteed step avoids loops even when input consists of punctuation.
      start = Math.max(start + 1, end - CHUNK_OVERLAP);
    }
  }
  return chunks;
}

function validatedPages(item, text) {
  if (!Array.isArray(item.pages) || !item.pages.length || item.pages.length > MAX_PDF_PAGES) {
    throw new TypeError(`PDF 需要有效页码信息，且最多支持 ${MAX_PDF_PAGES} 页。`);
  }
  let previousEnd = 0;
  const pages = item.pages.map((page, index) => {
    if (!page || typeof page.text !== 'string'
      || page.pageNumber !== index + 1
      || !Number.isInteger(page.start) || !Number.isInteger(page.end)
      || page.start < previousEnd || page.end < page.start || page.end > text.length
      || text.slice(page.start, page.end) !== page.text
      || text.slice(previousEnd, page.start).trim()) {
      throw new TypeError('PDF 页码或原文位置不一致，请重新导入文件。');
    }
    previousEnd = page.end;
    return { pageNumber: page.pageNumber, text: page.text, start: page.start, end: page.end };
  });
  if (text.slice(previousEnd).trim()) throw new TypeError('PDF 有未对应到页码的文本，请重新导入文件。');
  return pages;
}

/** Validate and chunk documents without changing the caller's objects. */
export function prepareDocuments(documents = []) {
  if (!Array.isArray(documents)) throw new TypeError('资料必须是文档列表。');
  if (documents.length > MAX_DOCUMENTS) throw new RangeError(`一次最多处理 ${MAX_DOCUMENTS} 篇文档。`);
  const ids = new Set();
  let totalLength = 0;
  return documents.map((item, index) => {
    if (!item || typeof item !== 'object') throw new TypeError('文档格式不正确。');
    const isPdf = item.type === 'pdf' || Array.isArray(item.pages);
    if (isPdf && typeof item.text !== 'string') throw new TypeError('PDF 原文格式不正确。');
    // PDF offsets come from the parser. Trimming or Unicode normalization here
    // would invalidate page boundaries and highlights in the original text.
    const text = isPdf ? item.text : cleanText(item.text).trim();
    if (text.length > MAX_DOCUMENT_LENGTH) throw new RangeError('单篇文档过长，请拆成多篇后导入。');
    totalLength += text.length;
    if (totalLength > MAX_CORPUS_LENGTH) throw new RangeError('资料总量过大，请减少文档后重试。');
    let id = cleanText(item.id || `document-${index + 1}`).slice(0, 160);
    while (ids.has(id)) id += `-${index + 1}`;
    ids.add(id);
    const doc = { id, title: cleanText(item.title || `未命名文档 ${index + 1}`).slice(0, 200), text };
    if (isPdf) {
      doc.type = 'pdf';
      doc.pages = validatedPages(item, text);
    }
    doc.chunks = makeChunks(doc);
    return doc;
  }).filter(doc => doc.text.length > 0 || doc.type === 'pdf');
}

function allChunks(documents) {
  // Always prepare again: externally supplied stale/malformed chunks are not trusted.
  return prepareDocuments(documents).flatMap(doc => doc.chunks);
}

function lexicalRanks(question, chunks) {
  const query = [...new Set(tokens(question, true))];
  if (!query.length || !chunks.length) return [];
  const corpus = chunks.map(chunk => {
    const textTokens = tokens(chunk.text);
    const counts = new Map();
    for (const token of textTokens) counts.set(token, (counts.get(token) || 0) + 1);
    return { chunk, counts, length: Math.max(textTokens.length, 1), titleTokens: new Set(tokens(chunk.title)) };
  });
  const averageLength = corpus.reduce((n, row) => n + row.length, 0) / corpus.length;
  const frequency = new Map(query.map(term => [term, corpus.filter(row => row.counts.has(term) || row.titleTokens.has(term)).length]));
  return corpus.map(row => {
    let raw = 0;
    let hits = 0;
    for (const term of query) {
      const tf = row.counts.get(term) || 0;
      const titleMatch = row.titleTokens.has(term);
      if (!tf && !titleMatch) continue;
      hits++;
      const idf = Math.log(1 + (corpus.length - frequency.get(term) + 0.5) / (frequency.get(term) + 0.5));
      const bm25 = tf ? (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * row.length / averageLength)) : 0;
      raw += idf * (bm25 + (titleMatch ? 0.65 : 0));
    }
    // This bounded value is useful for ranking and display, not a probability.
    const coverage = hits / Math.max(Math.min(query.length, 8), 1);
    const score = hits ? (1 - Math.exp(-raw / 4)) * (0.55 + 0.45 * Math.min(coverage, 1)) : 0;
    return { chunk: row.chunk, score, hits };
  }).filter(row => row.hits > 0).sort((a, b) => b.score - a.score);
}

function chooseEvidence(rows, { limit = 4, minScore = 0.12 } = {}) {
  const found = [];
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 4));
  for (const row of rows) {
    if (row.score < minScore) continue;
    // Overlapping neighboring chunks should not occupy all result positions.
    if (found.some(previous => previous.id === row.chunk.documentId && previous.excerpt.includes(row.chunk.text.trim()))) continue;
    if (found.filter(previous => previous.id === row.chunk.documentId).length >= 2) continue;
    const leading = row.chunk.text.length - row.chunk.text.trimStart().length;
    const excerpt = row.chunk.text.trim();
    const source = { id: row.chunk.documentId, title: row.chunk.title, excerpt, score: Number(row.score.toFixed(4)), chunkId: row.chunk.chunkId, start: row.chunk.start + leading, end: row.chunk.start + leading + excerpt.length };
    if (row.chunk.pageNumber !== undefined) source.pageNumber = row.chunk.pageNumber;
    found.push(source);
    if (found.length >= safeLimit) break;
  }
  return found;
}

/** Pure, synchronous keyword retrieval. */
export function retrieve(question, documents = [], options = {}) {
  const query = cleanText(question).trim();
  if (!query) return [];
  return chooseEvidence(lexicalRanks(query, allChunks(documents)), options);
}

/** Inject a real local embedding function; null releases vectors and disables it. */
export function configureEmbedder(fn) {
  if (fn !== null && typeof fn !== 'function') throw new TypeError('嵌入模型需要提供一个函数。');
  embedder = fn;
  modelRevision++;
  vectorCache.clear();
  sentenceVectorCache.clear();
}

function validateVectors(vectors, count) {
  if (!Array.isArray(vectors) || vectors.length !== count) throw new Error('本地模型返回的向量数量不正确。');
  const dimension = vectors[0]?.length;
  if (!dimension || !vectors.every(row => (Array.isArray(row) || ArrayBuffer.isView(row)) && row.length === dimension && Array.from(row).every(Number.isFinite))) {
    throw new Error('本地模型返回了无效向量。');
  }
  return vectors;
}

function cosine(a, b) {
  if (a.length !== b.length) throw new Error('问题与文档向量的维度不一致，请重新加载模型。');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))) : 0;
}

async function semanticEvidence(question, documents) {
  if (!embedder) throw new Error('本地 AI 模型尚未加载。请先开启本地 AI，或选择关键词模式。');
  const chunks = allChunks(documents);
  if (!chunks.length) return { sources: [] };
  const revision = modelRevision;
  const embed = embedder;
  const key = `${revision}:${hash(chunks.map(chunk => `${chunk.chunkId}\n${chunk.title}\n${chunk.text}`).join('\n\u0001\n'))}`;
  let pending = vectorCache.get(key);
  if (!pending) {
    pending = (async () => {
      const vectors = [];
      // Batching prevents a large import from creating one enormous model tensor.
      for (let offset = 0; offset < chunks.length; offset += 12) {
        const texts = chunks.slice(offset, offset + 12).map(chunk => `${chunk.title}\n${chunk.text}`);
        vectors.push(...validateVectors(await embed(texts), texts.length));
      }
      return vectors;
    })();
    vectorCache.set(key, pending);
    // Bound memory to the latest five corpora; old vectors may be garbage-collected.
    if (vectorCache.size > 5) vectorCache.delete(vectorCache.keys().next().value);
    pending.catch(() => { if (vectorCache.get(key) === pending) vectorCache.delete(key); });
  }
  const [vectors, questionRows] = await Promise.all([pending, embed([question])]);
  if (revision !== modelRevision) throw new Error('模型状态已改变，请重新提问。');
  const questionVector = validateVectors(questionRows, 1)[0];
  const lexical = new Map(lexicalRanks(question, chunks).map(row => [row.chunk.chunkId, row.score]));
  const rows = chunks.map((chunk, index) => {
    const similarity = cosine(questionVector, vectors[index]);
    const lexicalScore = lexical.get(chunk.chunkId) || 0;
    return { chunk, similarity, score: similarity * 0.82 + lexicalScore * 0.18 };
  }).filter(row => row.similarity >= 0.43).sort((a, b) => b.score - a.score);
  // Recall a few more chunks before sentence-level reranking. Chunk similarity
  // alone can favor broad introductions over the precise answering sentence.
  return { sources: chooseEvidence(rows, { limit: 6, minScore: 0.36 }), questionVector, embed, revision };
}

function queryWeights(question, documents) {
  const query = [...new Set(tokens(question, true))];
  const corpusTerms = documents.map(doc => new Set(tokens(doc.text)));
  return new Map(query.map(term => {
    const frequency = corpusTerms.filter(terms => terms.has(term)).length;
    return [term, Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5))];
  }));
}

function sentenceCandidates(excerpt) {
  return [...excerpt.matchAll(/[^。！？!?\n]+[。！？!?]?/gu)].map((match, index) => {
    const text = match[0].trim();
    const start = match.index + match[0].length - match[0].trimStart().length;
    return { text, index, start, end: start + text.length };
  }).filter(row => row.text.length >= 4 && !row.text.startsWith('#') && /[\p{L}\p{N}]/u.test(row.text));
}

function weightedSentenceScore(content, weights) {
  const present = new Set(tokens(content));
  // Document-frequency weighting prevents ubiquitous words such as AI from
  // beating the specific question concepts. No fabricated summary is added.
  const matched = [...weights].filter(([term]) => present.has(term));
  const score = matched.reduce((sum, [, weight]) => sum + weight, 0) / (1 + Math.max(content.length - 100, 0) / 200);
  return { score, matches: matched.length };
}

function excerptSentences(excerpt, weights) {
  const ranked = sentenceCandidates(excerpt).map(sentence => ({ ...sentence, ...weightedSentenceScore(sentence.text, weights) }))
    .sort((a, b) => b.score - a.score);
  const bestScore = ranked[0]?.score || 0;
  const selected = ranked.filter(row => row.matches && row.score >= bestScore * 0.6).slice(0, 2).sort((a, b) => a.index - b.index);
  return { text: selected.length ? selected.map(row => row.text).join('') : excerpt, score: bestScore };
}

async function cachedSentenceVectors(texts, embed, revision) {
  const missing = [...new Set(texts)].filter(text => !sentenceVectorCache.has(text));
  for (let offset = 0; offset < missing.length; offset += 12) {
    const batch = missing.slice(offset, offset + 12);
    const pending = Promise.resolve().then(() => embed(batch)).then(vectors => validateVectors(vectors, batch.length));
    batch.forEach((text, index) => {
      const vector = pending.then(vectors => vectors[index]);
      sentenceVectorCache.set(text, vector);
      vector.catch(() => { if (sentenceVectorCache.get(text) === vector) sentenceVectorCache.delete(text); });
    });
  }
  const pendingVectors = texts.map(text => sentenceVectorCache.get(text));
  // Exact-text cache keys cannot accidentally reuse a hash-colliding sentence.
  while (sentenceVectorCache.size > 1200) sentenceVectorCache.delete(sentenceVectorCache.keys().next().value);
  const result = await Promise.all(pendingVectors);
  if (revision !== modelRevision) throw new Error('模型状态已改变，请重新提问。');
  return result;
}

async function semanticExcerpts(context, weights) {
  const { sources, questionVector, embed, revision } = context;
  const candidates = sources.flatMap(source => {
    const sentences = sentenceCandidates(source.excerpt);
    // Each candidate is bounded by the existing 420-character chunk. Retain
    // all its sentences so synonyms do not require a lexical match to survive.
    return (sentences.length ? sentences : [{ text: source.excerpt, start: 0, end: source.excerpt.length }])
      .map(sentence => ({ ...sentence, source }));
  });
  if (!candidates.length) return [];
  const vectors = await cachedSentenceVectors(candidates.map(row => row.text), embed, revision);
  const weightTotal = [...weights.values()].reduce((sum, weight) => sum + weight, 0) || 1;
  const ranked = candidates.map((row, index) => {
    const similarity = cosine(questionVector, vectors[index]);
    const lexical = Math.min(1, weightedSentenceScore(row.text, weights).score / weightTotal);
    return { ...row, similarity, score: similarity * 0.86 + lexical * 0.14 };
  }).filter(row => row.similarity >= 0.43 && row.score >= 0.37).sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  const bestScore = ranked[0].score;
  const selected = [];
  for (const row of ranked) {
    // Keep close supporting evidence, rather than filling a fixed number of
    // citations with much weaker introductory or unrelated sentences.
    if (row.score < bestScore - 0.065 || row.score < bestScore * 0.88) continue;
    if (selected.some(previous => previous.text === row.text || previous.source.chunkId === row.source.chunkId)) continue;
    if (selected.filter(previous => previous.source.id === row.source.id).length >= 2) continue;
    const start = row.source.start + row.start;
    selected.push({ text: row.text, score: row.score, source: { ...row.source, excerpt: row.text, score: Number(row.score.toFixed(4)), start, end: start + row.text.length } });
    if (selected.length === 3) break;
  }
  return selected;
}

const DEFAULT_FOLLOWUPS = ['这个知识库如何避免 AI 编造答案？', '文档会被上传到服务器吗？', '如何评估检索效果？'];

function followupsFor(sources) {
  if (!sources.length) return [...DEFAULT_FOLLOWUPS];
  const title = sources[0].title;
  if (/隐私|数据/u.test(title)) return ['首次使用本地 AI 需要下载什么？', '清除浏览器缓存会有什么影响？', '两种检索模式有什么区别？'];
  if (/评估|测试/u.test(title)) return ['Recall@K 和 MRR 分别衡量什么？', '应该覆盖哪些引用测试场景？', '如何避免编造项目效果数据？'];
  if (/检索|引用/u.test(title)) return ['为什么文档分块需要保留重叠？', '语义检索和关键词检索有什么区别？', '资料里没有答案时怎么处理？'];
  if (/上线|迭代/u.test(title)) return ['项目目前支持哪些能力？', '后续可以怎样优化索引？', '未来接入大语言模型需要考虑什么？'];
  return [...DEFAULT_FOLLOWUPS];
}

/**
 * Retrieve evidence and quote it. The UI should label the mode as 原文摘录 or
 * 本地 AI 语义检索; neither is generative question answering.
 */
export async function answerQuestion({ question = '', documents = [], mode = 'extractive' } = {}) {
  const started = globalThis.performance?.now() ?? Date.now();
  const elapsed = () => Math.max(0, Math.round((globalThis.performance?.now() ?? Date.now()) - started));
  if (!['extractive', 'semantic'].includes(mode)) throw new Error('不支持的检索模式。');
  const query = cleanText(question).trim();
  if (!query) return { answer: '先输入一个问题，我会从当前资料中查找相关原文。', sources: [], mode, elapsedMs: elapsed(), followups: [...DEFAULT_FOLLOWUPS] };
  if (query.length > 1000) throw new RangeError('问题过长，请缩短至 1000 字以内。');
  const prepared = prepareDocuments(documents);
  if (!prepared.length) return { answer: '当前知识库还没有可检索的内容。请先导入文档，或载入示例资料。', sources: [], mode, elapsedMs: elapsed(), followups: [] };
  const semantic = mode === 'semantic' ? await semanticEvidence(query, prepared) : null;
  let sources = semantic ? semantic.sources : retrieve(query, prepared);
  if (!sources.length) return { answer: '当前资料中没有找到足够相关的依据。你可以换一种问法，或补充包含这个问题答案的文档。', sources: [], mode, elapsedMs: elapsed(), followups: followupsFor([]) };
  const weights = queryWeights(query, prepared);
  let excerpts = semantic ? await semanticExcerpts(semantic, weights) : sources.map(source => ({ source, ...excerptSentences(source.excerpt, weights) }));
  if (mode === 'extractive') {
    excerpts.sort((a, b) => b.score - a.score);
    const bestScore = excerpts[0]?.score || 0;
    excerpts = excerpts.filter(row => row.score >= bestScore * 0.6);
  }
  excerpts = excerpts.filter((row, index, rows) => !rows.slice(0, index).some(previous => previous.text === row.text)).slice(0, 3);
  sources = excerpts.map(row => row.source);
  if (!sources.length) return { answer: '当前资料中没有找到足够相关的依据。你可以换一种问法，或补充包含这个问题答案的文档。', sources: [], mode, elapsedMs: elapsed(), followups: followupsFor([]) };
  // Citation numbers are assigned after ranking and always point to returned sources.
  const quotes = excerpts.map((row, index) => `${row.text} [${index + 1}]`);
  return { answer: `在当前资料中找到以下相关原文：\n\n${quotes.join('\n\n')}`, sources, mode, elapsedMs: elapsed(), followups: followupsFor(sources) };
}
