import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Trash2, Upload, X } from "lucide-react";
import { api, apiBlob, apiForm } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { PropertyDocument } from "@/types";

const MAX_FILES = 2;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

type ListResponse = { documents: PropertyDocument[] };

function allowedFile(file: File): boolean {
  if (file.type === "application/pdf" || file.type.startsWith("image/")) {
    return /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(file.type);
  }
  return /\.(jpe?g|png|webp|gif|pdf)$/i.test(file.name);
}

export function TenantIdentification({
  tenantId,
  variant = "edit",
}: {
  tenantId: string;
  variant?: "edit" | "view";
}) {
  const app = useApp();
  const viewing = variant === "view";
  const [documents, setDocuments] = useState<PropertyDocument[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openDoc, setOpenDoc] = useState<PropertyDocument | null>(null);

  async function load() {
    const data = await api<ListResponse>("GET", `/api/tenants/${tenantId}/identification`);
    setDocuments(data.documents);
    return data.documents;
  }

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      try {
        setLoading(true);
        const docs = await load();
        const next: Record<string, string> = {};
        await Promise.all(
          docs.map(async (doc) => {
            const blob = await apiBlob(`/api/documents/${doc.id}`);
            const url = URL.createObjectURL(blob);
            urls.push(url);
            next[doc.id] = url;
          }),
        );
        if (!cancelled) setPreviews(next);
      } catch (err) {
        if (!cancelled) app.setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function refresh() {
    const docs = await load();
    const next: Record<string, string> = {};
    await Promise.all(
      docs.map(async (doc) => {
        const blob = await apiBlob(`/api/documents/${doc.id}`);
        next[doc.id] = URL.createObjectURL(blob);
      }),
    );
    setPreviews((current) => {
      for (const url of Object.values(current)) URL.revokeObjectURL(url);
      return next;
    });
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    const room = MAX_FILES - documents.length;
    if (room <= 0 || files.length > room) {
      app.setError("Máximo 2 archivos de identificación");
      return;
    }
    if (files.some((file) => !allowedFile(file))) {
      app.setError("Solo se admiten imágenes JPEG, PNG, WebP, GIF o PDF");
      return;
    }
    if (files.some((file) => file.size > MAX_BYTES)) {
      app.setError("Cada archivo puede pesar como máximo 10 MB");
      return;
    }
    setUploading(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        await apiForm(`/api/tenants/${tenantId}/identification`, form);
      }
      await refresh();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    try {
      await api("DELETE", `/api/tenants/${tenantId}/identification/${id}`);
      await refresh();
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  function openFile(doc: PropertyDocument) {
    if (!previews[doc.id]) {
      app.setError("No se pudo abrir el archivo");
      return;
    }
    setOpenDoc(doc);
  }

  const full = documents.length >= MAX_FILES;
  const openUrl = openDoc ? previews[openDoc.id] : undefined;

  return (
    <section className={cn("space-y-3", !viewing && "border-t pt-3")}>
      <div>
        {viewing ? (
          <h2 className="text-[1.0625rem] font-semibold leading-tight">Identificación</h2>
        ) : (
          <Label>Identificación</Label>
        )}
        {!viewing && (
          <p className="mt-1 text-xs text-muted-foreground">
            Imagen o PDF. Hasta 2 archivos de 10 MB.
          </p>
        )}
      </div>
      {!viewing && (
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground transition-colors",
            dragOver && "border-foreground bg-muted",
            (uploading || full) && "pointer-events-none opacity-60",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            if (!full) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void uploadFiles([...event.dataTransfer.files]);
          }}
        >
          <Upload className="size-4" aria-hidden />
          <span>
            {full
              ? "Ya hay 2 archivos"
              : uploading
                ? "Subiendo…"
                : "Arrastra el archivo o haz clic para elegirlo"}
          </span>
          <input
            type="file"
            className="sr-only"
            accept={ACCEPT}
            multiple
            disabled={full || uploading}
            onChange={(event) => {
              const list = event.target.files ? [...event.target.files] : [];
              event.target.value = "";
              void uploadFiles(list);
            }}
          />
        </label>
      )}
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando identificación…</p>
      ) : documents.length === 0 ? (
        viewing ? (
          <p className="text-sm text-muted-foreground">Todavía no hay identificación.</p>
        ) : null
      ) : viewing ? (
        <div className="grid gap-3">
          {documents.map((doc) =>
            doc.mime.startsWith("image/") ? (
              <button
                key={doc.id}
                type="button"
                className="overflow-hidden rounded-lg border bg-muted text-left"
                onClick={() => openFile(doc)}
              >
                <img src={previews[doc.id]} alt={doc.filename} className="max-h-80 w-full object-contain" />
                <span className="block truncate px-3 py-2 text-xs text-muted-foreground">{doc.filename}</span>
              </button>
            ) : (
              <div key={doc.id} className="overflow-hidden rounded-lg border">
                <iframe title={doc.filename} src={previews[doc.id]} className="h-[28rem] w-full bg-white" />
                <p className="truncate px-3 py-2 text-xs text-muted-foreground">{doc.filename}</p>
              </div>
            ),
          )}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-2 px-2 py-1.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => openFile(doc)}
              >
                {doc.mime.startsWith("image/") && previews[doc.id] ? (
                  <img src={previews[doc.id]} alt="" className="size-9 rounded object-cover" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{doc.filename}</span>
              </button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Quitar ${doc.filename}`}
                onClick={() => void remove(doc.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {openDoc && openUrl
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/70 p-4"
              onClick={() => setOpenDoc(null)}
            >
              <div
                className="relative max-h-[90vh] w-full max-w-3xl"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="absolute right-2 top-2 rounded-md bg-card p-1 text-foreground"
                  aria-label="Cerrar"
                  onClick={() => setOpenDoc(null)}
                >
                  <X className="size-4" />
                </button>
                {openDoc.mime.startsWith("image/") ? (
                  <img src={openUrl} alt={openDoc.filename} className="max-h-[90vh] w-full object-contain" />
                ) : (
                  <iframe title={openDoc.filename} src={openUrl} className="h-[85vh] w-full rounded-lg bg-white" />
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
