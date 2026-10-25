import { useState } from "react";
import { FileText } from "lucide-react";
import { apiBlob } from "@/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { usePortal } from "./portal-context";
import type { PortalDocument } from "./portal-types";

export function PortalDepartmentPage() {
  const { home } = usePortal();
  const [error, setError] = useState<string | null>(null);
  if (!home) return null;

  async function openDocument(doc: PortalDocument) {
    try {
      const blob = await apiBlob(`/api/portal/documents/${doc.id}`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el documento");
    }
  }

  return (
    <PageShell title="Mi departamento" meta={home.tenant.organization_name} width="max-w-5xl" notifications={false}>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Card className="p-5">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">Documentos</h2>
        {home.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay contratos firmados en el archivo.</p>
        ) : (
          <ul className="divide-y">
            {home.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {[doc.property_name, doc.unit_name].filter(Boolean).join(" · ")} · {formatDate(doc.created_at)}
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => void openDocument(doc)}>
                  Ver PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageShell>
  );
}
