/** Current production host (firma.dev API 01.38.00). Bearer prefix is optional. */
export const FIRMA_API_BASE = "https://api.firma.dev/functions/v1/signing-request-api";

/** Stay under the platform body limit that 502s inline base64 near 5 MB. */
const INLINE_PDF_BYTES = 3_500_000;

export class FirmaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FirmaError";
  }
}

export type FirmaRecipientInput = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  order: number;
};

export type FirmaSentRecipient = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  order: number | null;
};

export type FirmaSentRequest = {
  id: string;
  status: string;
  recipients: FirmaSentRecipient[];
};

export type FirmaDownload = {
  status: string;
  isPartial: boolean;
  downloadUrl: string;
};

type FirmaDeps = {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
};

function authHeader(apiKey: string): string {
  return apiKey.trim();
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.message || body.error || `firma.dev ${response.status}`;
  } catch {
    return `firma.dev ${response.status}`;
  }
}

async function firmaFetch(deps: FirmaDeps, path: string, init: RequestInit): Promise<Response> {
  const fetchImpl = deps.fetch ?? fetch;
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader(deps.apiKey));
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const url = `${deps.baseUrl ?? FIRMA_API_BASE}${path}`;
  let response = await fetchImpl(url, { ...init, headers });
  if (response.status !== 429) return response;

  const retryAfter = Number(response.headers.get("Retry-After") ?? "60");
  if (!Number.isFinite(retryAfter) || retryAfter > 2) {
    throw new FirmaError("firma.dev rate limit exceeded", 429);
  }
  await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
  response = await fetchImpl(url, { ...init, headers });
  if (response.status === 429) throw new FirmaError("firma.dev rate limit exceeded", 429);
  return response;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Letter-size layout used by `buildLeaseSummaryPdf` (612×792 pt). */
const LEASE_PAGE_WIDTH_PT = 612;
const LEASE_PAGE_HEIGHT_PT = 792;

/** firma.dev expects top-left percentages (0–100); x + width and y + height must fit on the page. */
export function signatureFieldLayout(index: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xPt = 72 + (index % 2) * 250;
  const yBasePt = 640 - Math.floor(index / 2) * 80;
  const widthPt = 200;
  const heightPt = 48;
  const toPct = (value: number, page: number) =>
    Math.min(100, Math.max(0, Math.round((value / page) * 1000) / 10));
  const x = toPct(xPt, LEASE_PAGE_WIDTH_PT);
  const width = toPct(widthPt, LEASE_PAGE_WIDTH_PT);
  const height = toPct(heightPt, LEASE_PAGE_HEIGHT_PT);
  const y = toPct(LEASE_PAGE_HEIGHT_PT - yBasePt - heightPt, LEASE_PAGE_HEIGHT_PT);
  return { x, y, width, height };
}

export function createFirmaClient(deps: FirmaDeps) {
  return {
    async createAndSend(input: {
      name: string;
      pdf: Uint8Array;
      filename: string;
      recipients: FirmaRecipientInput[];
    }): Promise<FirmaSentRequest> {
      const documentField =
        input.pdf.byteLength <= INLINE_PDF_BYTES
          ? { document: bytesToBase64(input.pdf) }
          : { document_id: await uploadDocument(deps, input.filename, input.pdf) };

      const response = await firmaFetch(deps, "/signing-requests/create-and-send", {
        method: "POST",
        body: JSON.stringify({
          name: input.name.slice(0, 255),
          expiration_hours: 720,
          ...documentField,
          recipients: input.recipients.map((recipient) => ({
            id: recipient.id,
            first_name: recipient.firstName,
            last_name: recipient.lastName,
            email: recipient.email,
            designation: "Signer",
            order: recipient.order,
          })),
          fields: input.recipients.map((recipient, index) => {
            const layout = signatureFieldLayout(index);
            return {
              recipient_id: recipient.id,
              type: "signature",
              page: 1,
              x: layout.x,
              y: layout.y,
              width: layout.width,
              height: layout.height,
              required: true,
            };
          }),
          settings: {
            use_signing_order: input.recipients.length > 1,
            send_signing_email: true,
          },
        }),
      });
      if (!response.ok) throw new FirmaError(await readError(response), response.status);
      const body = (await response.json()) as {
        id?: string;
        status?: string;
        recipients?: Array<{
          id?: string;
          email?: string;
          first_name?: string;
          last_name?: string;
          order?: number;
        }>;
      };
      if (!body.id) throw new FirmaError("firma.dev did not return a signing request id", 502);
      return {
        id: body.id,
        status: body.status ?? "sent",
        recipients: (body.recipients ?? []).map((recipient) => ({
          id: recipient.id ?? "",
          email: recipient.email ?? "",
          firstName: recipient.first_name ?? "",
          lastName: recipient.last_name ?? "",
          order: recipient.order ?? null,
        })),
      };
    },

    async cancel(signingRequestId: string, reason: string | undefined): Promise<void> {
      const response = await firmaFetch(deps, `/signing-requests/${signingRequestId}/cancel`, {
        method: "POST",
        body: JSON.stringify({
          reason: reason?.slice(0, 500),
          notify_signers: true,
        }),
      });
      if (!response.ok) throw new FirmaError(await readError(response), response.status);
    },

    async resend(signingRequestId: string, recipientIds: string[]): Promise<void> {
      const response = await firmaFetch(deps, `/signing-requests/${signingRequestId}/resend`, {
        method: "POST",
        body: JSON.stringify({ recipient_ids: recipientIds }),
      });
      if (!response.ok) throw new FirmaError(await readError(response), response.status);
    },

    async download(signingRequestId: string): Promise<FirmaDownload> {
      const response = await firmaFetch(deps, `/signing-requests/${signingRequestId}/download`, {
        method: "GET",
      });
      if (!response.ok) throw new FirmaError(await readError(response), response.status);
      const body = (await response.json()) as {
        status?: string;
        is_partial?: boolean;
        download_url?: string;
      };
      if (!body.download_url) throw new FirmaError("firma.dev did not return a download URL", 502);
      return {
        status: body.status ?? "",
        isPartial: Boolean(body.is_partial),
        downloadUrl: body.download_url,
      };
    },
  };
}

async function uploadDocument(deps: FirmaDeps, filename: string, pdf: Uint8Array): Promise<string> {
  const reserved = await firmaFetch(deps, "/documents", {
    method: "POST",
    body: JSON.stringify({
      file_name: filename,
      file_size: pdf.byteLength,
      content_type: "application/pdf",
    }),
  });
  if (!reserved.ok) throw new FirmaError(await readError(reserved), reserved.status);
  const ticket = (await reserved.json()) as { document_id?: string; upload_url?: string };
  if (!ticket.document_id || !ticket.upload_url) {
    throw new FirmaError("firma.dev did not return an upload URL", 502);
  }
  const fetchImpl = deps.fetch ?? fetch;
  const body = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(body).set(pdf);
  const uploaded = await fetchImpl(ticket.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body,
  });
  if (!uploaded.ok) throw new FirmaError("firma.dev document upload failed", uploaded.status);
  return ticket.document_id;
}

export type FirmaClient = ReturnType<typeof createFirmaClient>;
