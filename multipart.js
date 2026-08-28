// Parser mínimo de multipart/form-data (upload de arquivo), sem dependências externas.
// Suficiente para formulários simples com um único arquivo + campos de texto.

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('Content-Type sem boundary multipart');
  const boundary = '--' + (match[1] || match[2]).trim();
  const boundaryBuffer = Buffer.from(boundary);

  const parts = [];
  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (next === -1) break;
    parts.push(buffer.slice(start + boundaryBuffer.length, next));
    start = next;
  }

  const fields = {};
  const files = {};

  for (let part of parts) {
    if (part.length < 4) continue;
    if (part[0] === 0x2d && part[1] === 0x2d) continue; // boundary final "--"
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.slice(2);

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf-8');
    let body = part.slice(headerEnd + 4);
    if (body.slice(-2).toString('latin1') === '\r\n') body = body.slice(0, -2);

    const nameMatch = /name="([^"]+)"/i.exec(headerStr);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerStr);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];

    if (filenameMatch && filenameMatch[1]) {
      files[fieldName] = { filename: filenameMatch[1], content: body };
    } else {
      fields[fieldName] = body.toString('utf-8');
    }
  }

  return { fields, files };
}

module.exports = { parseMultipart };
