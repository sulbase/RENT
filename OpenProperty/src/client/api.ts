import type { AppType } from "../server/app";
import { authConfigured, getSupabase } from "./lib/supabase";
import { getStoredOrganizationId } from "./lib/session";

/** Shared API surface type for Hono RPC (`createApiClient` in `./rpc`). */
export type { AppType };

export type ApiAuthOptions = {
  accessToken?: string;
  organizationId?: string | null;
};

async function resolveAuthHeaders(options?: ApiAuthOptions): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  let token = options?.accessToken;
  if (!token && authConfigured) {
    const supabase = getSupabase();
    const { data } = await supabase!.auth.getSession();
    token = data.session?.access_token;
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const org =
    options?.organizationId !== undefined
      ? options.organizationId
      : getStoredOrganizationId();
  if (org) headers["X-Organization-Id"] = org;

  return headers;
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  auth?: ApiAuthOptions,
): Promise<T> {
  const authHeaders = await resolveAuthHeaders(auth);
  const opts: RequestInit = { method, headers: { ...authHeaders } };
  if (body !== undefined) {
    (opts.headers as Record<string, string>)["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  return readJson<T>(r);
}

export async function apiForm<T>(path: string, form: FormData, auth?: ApiAuthOptions): Promise<T> {
  const authHeaders = await resolveAuthHeaders(auth);
  const r = await fetch(path, { method: "POST", headers: authHeaders, body: form });
  return readJson<T>(r);
}

export async function apiBlob(path: string, auth?: ApiAuthOptions): Promise<Blob> {
  const authHeaders = await resolveAuthHeaders(auth);
  const r = await fetch(path, { headers: authHeaders });
  if (!r.ok) {
    let message = `${r.status} ${r.statusText}`;
    try {
      const data = (await r.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* binary error */
    }
    throw new Error(message);
  }
  return r.blob();
}

async function readJson<T>(r: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await r.json();
  } catch {
    /* empty body */
  }
  if (!r.ok) {
    const bodyError = (data as { error?: string } | null)?.error;
    if (bodyError) throw new Error(bodyError);
    if (r.status === 500 || r.status === 502 || r.status === 503) {
      const local =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      throw new Error(
        local
          ? "API no disponible (Worker en :8787). Reinicia con pnpm dev:auth y espera [api] Ready."
          : "API no disponible. Inténtalo de nuevo en unos segundos.",
      );
    }
    throw new Error(`${r.status} ${r.statusText}`);
  }
  return data as T;
}
