import { crc32, deflateRawSync } from 'node:zlib';

/** Standard ZIP records; checksums use Node's independent native implementation. */
export function makeZip(files, { comment = '' } = {}) {
  const locals = []; const central = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name); const raw = Buffer.from(file.text ?? file.bytes ?? '');
    const method = file.method ?? 8; const flags = file.flags ?? 0x800; const data = method === 8 ? deflateRawSync(raw) : raw;
    const crc = file.crc ?? crc32(raw); const size = file.declaredSize ?? raw.length;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    if (!(flags & 8)) { header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(size, 22); }
    header.writeUInt16LE(name.length, 26); locals.push(header, name, data);
    let descriptor = Buffer.alloc(0);
    if (flags & 8) { descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(data.length, 8); descriptor.writeUInt32LE(size, 12); locals.push(descriptor); }
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(flags, 8); record.writeUInt16LE(method, 10); record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(size, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42); central.push(record, name);
    offset += header.length + name.length + data.length + descriptor.length;
  }
  const records = Buffer.concat(central); const end = Buffer.alloc(22); const tail = Buffer.from(comment);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(records.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(tail.length, 20);
  return Buffer.concat([...locals, records, end, tail]);
}

export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const paragraph = text => `<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`;

export function makeDocx({ body = paragraph('白茶库存十箱。'), footnotes, namespace = WORD_NS, main = 'word/document.xml', entries = [] } = {}) {
  const at = main.lastIndexOf('/'); const folder = main.slice(0, at + 1);
  const files = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${footnotes ? `<Override PartName="/${folder}footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` : ''}</Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>` },
    { name: main, text: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${namespace}"><w:body>${body}<w:sectPr/></w:body></w:document>` },
    ...entries,
  ];
  if (footnotes) files.push({ name: `${folder}_rels/${main.slice(at + 1)}.rels`, text: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>` }, { name: `${folder}footnotes.xml`, text: `<w:footnotes xmlns:w="${namespace}">${footnotes}</w:footnotes>` });
  return makeZip(files);
}
