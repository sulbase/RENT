/** Canonical public origin. Lab on workers.dev redirects here once the custom domain is live. */
export const CANONICAL_ORIGIN = "https://rent.sulbase.com";

/** Production workers.dev hostname. Previews and localhost are not redirected. */
export const LEGACY_WORKERS_HOST = "rent.sistemas-d5d.workers.dev";

export const APP_PREFIX = "/app";

const LEGACY_ROOTS = new Set([
  "dashboard",
  "properties",
  "tenants",
  "leases",
  "rent",
  "maintenance",
  "messages",
  "vendors",
  "settings",
  "portal",
]);

export function withAppPath(urlOrOrigin: string): string {
  const trimmed = urlOrOrigin.replace(/\/$/, "");
  if (trimmed.endsWith(APP_PREFIX)) return trimmed;
  return `${trimmed}${APP_PREFIX}`;
}

export function toAppHref(path: string): string {
  if (path === APP_PREFIX || path.startsWith(`${APP_PREFIX}/`)) return path;
  if (!path.startsWith("/")) return `${APP_PREFIX}/${path}`;
  if (path === "/") return APP_PREFIX;
  return `${APP_PREFIX}${path}`;
}

/** Browser pathname → path the in-app router understands (`/properties`, `/`). */
export function internalFromLocation(pathname: string): string {
  if (pathname === APP_PREFIX || pathname === `${APP_PREFIX}/`) return "/";
  if (pathname.startsWith(`${APP_PREFIX}/`)) return pathname.slice(APP_PREFIX.length) || "/";
  return pathname;
}

/** Old SPA urls (`/properties/...`) → `/app/properties/...`. `/` stays the public landing. */
export function legacyRedirectPath(pathname: string): string | null {
  if (pathname === APP_PREFIX || pathname.startsWith(`${APP_PREFIX}/`)) return null;
  const [root] = pathname.split("/").filter(Boolean);
  if (!root || !LEGACY_ROOTS.has(root)) return null;
  return `${APP_PREFIX}${pathname}`;
}

export function isAppPath(pathname: string): boolean {
  return pathname === APP_PREFIX || pathname.startsWith(`${APP_PREFIX}/`);
}

export function canonicalRedirectTarget(url: URL, enabled: boolean): string | null {
  if (!enabled) return null;
  if (url.hostname !== LEGACY_WORKERS_HOST) return null;
  return new URL(`${url.pathname}${url.search}`, CANONICAL_ORIGIN).toString();
}

export function jsonLdGraph(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${CANONICAL_ORIGIN}/#organization`,
        name: "Sulbase",
        url: "https://sulbase.com",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${CANONICAL_ORIGIN}/#software`,
        name: "RENT",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "es",
        url: `${CANONICAL_ORIGIN}/`,
        description:
          "Aplicación privada de Sulbase para administrar propiedades, unidades, inquilinos, contratos, cobro de rentas y mantenimiento.",
        publisher: { "@id": `${CANONICAL_ORIGIN}/#organization` },
      },
    ],
  };
}

export function robotsTxt(): string {
  const lines = [
    "# RENT: la landing es pública. La aplicación y la API no se indexan.",
    "# Rastreadores de IA (nombres publicados por cada proveedor, sept 2026):",
    "# GPTBot, OAI-SearchBot, ChatGPT-User (OpenAI); ClaudeBot, Claude-User (Anthropic);",
    "# PerplexityBot; Google-Extended; Applebot-Extended; Amazonbot; CCBot; Bytespider; meta-externalagent.",
    "# Googlebot de búsqueda queda cubierto por User-agent: *.",
    "User-agent: *",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: GPTBot",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: OAI-SearchBot",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: ChatGPT-User",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: ClaudeBot",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: Claude-User",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: PerplexityBot",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: Google-Extended",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: Applebot-Extended",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: Amazonbot",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: CCBot",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: Bytespider",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    "User-agent: meta-externalagent",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /api/",
    "",
    `Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`,
    "",
  ];
  return lines.join("\n");
}

export function sitemapXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${CANONICAL_ORIGIN}/</loc>
  </url>
</urlset>
`;
}

export function llmsTxt(): string {
  return `# RENT

> Aplicación privada de Sulbase para la gestión de arrendamientos.

RENT sirve a equipos que administran propiedades: unidades, inquilinos, contratos, cobro de rentas, mantenimiento y documentos. El panel requiere cuenta. Esta página es la única superficie pública.

## Páginas

- [Inicio](${CANONICAL_ORIGIN}/): qué es RENT, para quién es y qué hace
- [Entrar](${CANONICAL_ORIGIN}/app): acceso a la aplicación (cuenta requerida)

## Fuera de índice

- ${CANONICAL_ORIGIN}/app/ — panel de gestión
- ${CANONICAL_ORIGIN}/api/ — API privada
`;
}
