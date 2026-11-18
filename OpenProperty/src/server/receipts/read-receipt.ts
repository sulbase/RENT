/** Free-tier model for the current AI Studio key. */
export const RECEIPT_MODELS = ["gemini-3.5-flash-lite"] as const;

export const ONE_PAGE_ERROR = "El comprobante debe ser de una sola página";
export const UNREADABLE_ERROR = "No se pudo leer el comprobante. Llénalo a mano.";
export const ACCOUNT_MISMATCH_ERROR =
  "La cuenta de destino no coincide con la de esta organización";
export const READ_LIMIT = 5;
export const READ_LIMIT_ERROR = "Esta unidad ya usó las 5 lecturas de este mes. Llénalo a mano.";

export type ReceiptDraft = {
  amount: number | null;
  paid_on: string | null;
  payer_bank_name: string | null;
  receipt_number: string | null;
  reference: string | null;
};

type GeminiReceipt = ReceiptDraft & { destination_account_digits: string | null };

export function pdfPageCount(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,120}?\/Count\s+(\d+)/g)].map(
    (match) => Number(match[1]),
  );
  if (counts.some((count) => count > 0)) return Math.max(...counts);
  const pages = text.match(/\/Type\s*\/Page(?!s)\b/g);
  return pages && pages.length > 0 ? pages.length : null;
}

/** Accepts 1450, "1450.00", "$1,450.00" and "1.450,00". */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/[^\d.,]/g, "");
  if (!text) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = text.length - lastComma - 1;
    text = decimals === 2 ? text.replace(",", ".") : text.replace(/,/g, "");
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

export function lastDigits(value: string, length = 4): string {
  return value.replace(/\D/g, "").slice(-length);
}

/** True when the receipt's destination account ends with the same digits as the organization's account or CLABE. */
export function destinationMatches(seen: string | null, accounts: string[]): boolean {
  const tail = lastDigits(seen ?? "");
  if (tail.length < 4) return false;
  return accounts.some((account) => {
    const known = lastDigits(account);
    return known.length >= 4 && known === tail;
  });
}

export function interpretReceipt(
  raw: GeminiReceipt,
  accounts: string[],
): { ok: true; draft: ReceiptDraft } | { ok: false; error: string } {
  const configured = accounts.map((account) => account.trim()).filter(Boolean);
  if (configured.length > 0 && !destinationMatches(raw.destination_account_digits, configured)) {
    return { ok: false, error: ACCOUNT_MISMATCH_ERROR };
  }
  const draft: ReceiptDraft = {
    amount: raw.amount,
    paid_on: raw.paid_on,
    payer_bank_name: raw.payer_bank_name,
    receipt_number: raw.receipt_number,
    reference: raw.reference,
  };
  const filled = Object.values(draft).some((value) => value !== null && value !== "");
  if (!filled) return { ok: false, error: UNREADABLE_ERROR };
  return { ok: true, draft };
}

const ReceiptJson = {
  amount: null,
  paid_on: null,
  payer_bank_name: null,
  receipt_number: null,
  reference: null,
  destination_account_digits: null,
} as const;

export function parseGeminiReceipt(text: string): GeminiReceipt | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  const amount = parseAmount(row.amount);
  const paid =
    typeof row.paid_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.paid_on) ? row.paid_on : null;
  const textField = (key: string, max: number) => {
    if (typeof row[key] !== "string") return null;
    const value = row[key].trim();
    return value ? value.slice(0, max) : null;
  };
  return {
    amount,
    paid_on: paid,
    payer_bank_name: textField("payer_bank_name", 80),
    receipt_number: textField("receipt_number", 80),
    reference: textField("reference", 120),
    destination_account_digits: textField("destination_account_digits", 32),
  };
}

export function receiptPrompt(): string {
  return [
    "Lee este comprobante de transferencia bancaria de una sola página.",
    "Responde solo JSON con esta forma:",
    JSON.stringify(ReceiptJson),
    "amount es el monto transferido. paid_on es AAAA-MM-DD.",
    "payer_bank_name es el banco desde el que se pagó.",
    "receipt_number es el número de comprobante. reference es la referencia o clave de rastreo.",
    "destination_account_digits son los dígitos de la cuenta o CLABE de destino, tal como aparecen.",
    "Si un dato no está, usa null. No inventes cifras.",
  ].join(" ");
}

export async function askGemini(
  apiKey: string,
  mime: string,
  bytes: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const image = bytesToBase64(bytes);
  let lastError = "gemini unavailable";
  for (const model of RECEIPT_MODELS) {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: receiptPrompt() }, { inlineData: { mimeType: mime, data: image } }],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );
    if (response.ok) {
      const body = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    }
    const detail = await response.text();
    lastError = `gemini ${response.status} ${model} ${detail.slice(0, 300)}`;
    if (response.status !== 404) break;
  }
  throw new Error(lastError);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}
