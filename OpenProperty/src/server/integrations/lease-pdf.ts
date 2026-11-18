/** Unicode code points that WinAnsiEncoding places in 0x80–0x9F. */
const WIN_ANSI_EXTRA = new Map<number, number>([
  [0x20ac, 0x80], // €
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85], // …
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
  [0x2192, 0x3e], // → has no WinAnsi glyph; ">" keeps the meaning
]);

/** PDF literal string body in WinAnsiEncoding; bytes above 0x7E are octal escapes. */
export function pdfEscape(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    let byte: number;
    if (code >= 0x20 && code <= 0x7e) byte = code;
    else if (code >= 0xa0 && code <= 0xff) byte = code;
    else byte = WIN_ANSI_EXTRA.get(code) ?? 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte > 0x7e) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

/** Letter page in points. firma.dev field percentages are computed against it. */
export const PAGE_WIDTH_PT = 612;
export const PAGE_HEIGHT_PT = 792;

/** Signature box for signer `index`, PDF coordinates (origin bottom-left). */
export function signatureBoxPt(index: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: 72 + (index % 2) * 250,
    y: 600 - Math.floor(index / 2) * 130,
    width: 200,
    height: 48,
  };
}

/** Helvetica advance widths (1/1000 em) for ASCII 0x20–0x7E, from the standard AFM. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const SPECIAL_WIDTHS = new Map<string, number>([
  ["·", 278],
  ["—", 1000],
  ["–", 556],
  ["¿", 611],
  ["¡", 333],
  ["º", 365],
  ["ª", 370],
  ["“", 333],
  ["”", 333],
]);

function charWidth(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 0x20 && code <= 0x7e) return HELVETICA_WIDTHS[code - 0x20] ?? 556;
  const special = SPECIAL_WIDTHS.get(char);
  if (special) return special;
  const base = char.normalize("NFD").charAt(0);
  const baseCode = base.charCodeAt(0);
  if (baseCode >= 0x20 && baseCode <= 0x7e) return HELVETICA_WIDTHS[baseCode - 0x20] ?? 556;
  return 556;
}

function textWidth(text: string, size: number, bold: boolean): number {
  let total = 0;
  for (const char of text) total += charWidth(char);
  return (total / 1000) * size * (bold ? 1.06 : 1);
}

function wrap(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

export type ContractBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string };

export type ContractSigner = { role: string; name: string; governmentId: string };

const MARGIN = 72;
const CONTENT_WIDTH = PAGE_WIDTH_PT - MARGIN * 2;
const TOP = PAGE_HEIGHT_PT - MARGIN;
const BOTTOM = MARGIN;

function textOp(x: number, y: number, text: string, font: "F1" | "F2", size: number): string {
  return `BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(text)}) Tj ET`;
}

/**
 * Multi-page contract. The last page is the signature sheet; its boxes sit where
 * `signatureBoxPt` says, so firma.dev fields land on them.
 */
export function buildLeaseContractPdf(
  blocks: ContractBlock[],
  signers: ContractSigner[],
): { bytes: Uint8Array; pageCount: number } {
  const pages: string[][] = [[]];
  let y = TOP;
  const page = () => pages[pages.length - 1] as string[];
  const ensure = (height: number) => {
    if (y - height < BOTTOM) {
      pages.push([]);
      y = TOP;
    }
  };

  for (const block of blocks) {
    if (block.kind === "title") {
      const size = 15;
      for (const line of wrap(block.text, size, true, CONTENT_WIDTH)) {
        ensure(22);
        const x = MARGIN + (CONTENT_WIDTH - textWidth(line, size, true)) / 2;
        page().push(textOp(x, y, line, "F2", size));
        y -= 22;
      }
      y -= 8;
    } else if (block.kind === "heading") {
      const size = 11;
      ensure(18 + 14 * 2);
      y -= 6;
      for (const line of wrap(block.text, size, true, CONTENT_WIDTH)) {
        page().push(textOp(MARGIN, y, line, "F2", size));
        y -= 16;
      }
    } else {
      const size = 10.5;
      for (const line of wrap(block.text, size, false, CONTENT_WIDTH)) {
        ensure(14);
        page().push(textOp(MARGIN, y, line, "F1", size));
        y -= 14;
      }
      y -= 6;
    }
  }

  const signaturePage: string[] = [];
  signaturePage.push(textOp(MARGIN, TOP, "FIRMAS", "F2", 12));
  let introY = TOP - 22;
  for (const line of wrap(
    "En constancia de lo acordado, las partes firman electrónicamente el presente contrato.",
    10.5,
    false,
    CONTENT_WIDTH,
  )) {
    signaturePage.push(textOp(MARGIN, introY, line, "F1", 10.5));
    introY -= 14;
  }
  signers.forEach((signer, index) => {
    const box = signatureBoxPt(index);
    const lineY = box.y - 4;
    signaturePage.push(`0.5 w ${box.x} ${lineY} m ${box.x + box.width} ${lineY} l S`);
    signaturePage.push(textOp(box.x, lineY - 14, signer.name || "—", "F2", 10));
    signaturePage.push(
      textOp(box.x, lineY - 27, `Identificación: ${signer.governmentId || "—"}`, "F1", 9.5),
    );
    signaturePage.push(textOp(box.x, lineY - 40, signer.role, "F1", 9.5));
  });
  pages.push(signaturePage);

  const total = pages.length;
  const streams = pages.map((ops, index) => {
    const footer = `Página ${index + 1} de ${total}`;
    const footerX = PAGE_WIDTH_PT - MARGIN - textWidth(footer, 9, false);
    return [...ops, textOp(footerX, 40, footer, "F1", 9)].join("\n");
  });
  return { bytes: assemblePdf(streams), pageCount: total };
}

function assemblePdf(streams: string[]): Uint8Array {
  const pageCount = streams.length;
  const fontRegular = 3 + pageCount * 2;
  const fontBold = fontRegular + 1;
  const kids = streams.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>`,
  ];
  streams.forEach((stream, index) => {
    const contentRef = 4 + index * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT} ${PAGE_HEIGHT_PT}] /Contents ${contentRef} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(body);
}
