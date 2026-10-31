export function renderInvoicePdf(invoice: Record<string, unknown>): Buffer {
  const lines = [
    `Invoice ${String(invoice.number)}`,
    `Status: ${String(invoice.status)}`,
    `Customer: ${String(invoice.customerEmail)}`,
    `Period: ${String(invoice.periodStart)} to ${String(invoice.periodEnd)}`,
    "",
    ...((invoice.lines as Array<Record<string, unknown>>) ?? []).map(
      (line) =>
        `${String(line.description)} | qty ${String(line.quantity)} | ${String(line.unitPrice)} | tax ${String(line.taxAmount)} | total ${String(line.lineTotal)}`,
    ),
    "",
    `Subtotal: ${String(invoice.subtotal)}`,
    `Discount: ${String(invoice.discountTotal)}`,
    `Tax: ${String(invoice.taxTotal)}`,
    `Total: ${String(invoice.total)} ${String(invoice.currencyCode)}`,
  ];
  const wrappedLines = lines.flatMap(wrapPdfText);
  const pageLines = Array.from(
    { length: Math.max(1, Math.ceil(wrappedLines.length / 44)) },
    (_value, index) => wrappedLines.slice(index * 44, (index + 1) * 44),
  );
  const fontId = pageLines.length + 3;
  const contentStartId = fontId + 1;
  const pageObjects = pageLines.map((_page, index) => {
    const contentId = contentStartId + index;
    return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  });
  const contentObjects = pageLines.map((page) => {
    const commands = [
      "BT",
      "/F1 10 Tf",
      "50 790 Td",
      ...page.flatMap((line, index) => [
        ...(index === 0 ? [] : ["0 -16 Td"]),
        `(${escapePdfText(line)}) Tj`,
      ]),
      "ET",
    ].join("\n");
    return `<< /Length ${Buffer.byteLength(commands, "ascii")} >>\nstream\n${commands}\nendstream`;
  });
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageLines.map((_page, index) => `${index + 3} 0 R`).join(" ")}] /Count ${pageLines.length} >>`,
    ...pageObjects,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...contentObjects,
  ];
  const parts: string[] = [];
  const offsets = [0];
  let length = 0;
  const append = (value: string) => {
    parts.push(value);
    length += Buffer.byteLength(value, "ascii");
  };
  append("%PDF-1.4\n");
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    append(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }
  const xrefOffset = length;
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
  ].join("\n");
  append(xref);
  return Buffer.from(parts.join(""), "ascii");
}

function escapePdfText(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");
}

function wrapPdfText(value: string): string[] {
  const text = value.replace(/[^\x20-\x7e]/g, "?");
  if (text.length <= 90) return [text];
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += 90) {
    chunks.push(text.slice(offset, offset + 90));
  }
  return chunks;
}
