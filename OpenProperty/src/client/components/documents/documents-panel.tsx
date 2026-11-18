import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Star, Trash2, Upload } from "lucide-react";
import { api, apiBlob, apiForm } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DocumentEntityType, DocumentKind, PropertyDocument } from "@/types";

const ENTITY_IMAGE_PHOTO_LIMIT = 25;
const LEASE_PHOTO_BYTES = 15 * 1024 * 1024;
const PROPERTY_FILE_LIMIT = 10;
const PROPERTY_FILE_BYTES = 30 * 1024 * 1024;
const PROPERTY_TOTAL_BYTES = 120 * 1024 * 1024;

const KINDS: { value: DocumentKind; label: string }[] = [
  { value: "image", label: "Imagen" },
  { value: "deed", label: "Escritura" },
  { value: "certificate", label: "Certificado" },
  { value: "invoice", label: "Factura" },
  { value: "signed_lease", label: "Contrato firmado" },
  { value: "inventory", label: "Inventario de daños" },
  { value: "signed_inventory", label: "Inventario firmado" },
  { value: "other", label: "Otro" },
];

type ListResponse = {
  documents: PropertyDocument[];
  usage: { file_count: number; total_bytes: number };
};

function formatModified(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(date)
    .replace(/\./g, "");
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 MB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(bytes / 1024)} KB`;
  }
  return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

function propertyFileKind(file: File): "image" | "other" {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/.test(name)) return "image";
  return "other";
}

function kindName(doc: PropertyDocument): string {
  if (doc.label) return doc.label;
  return KINDS.find((item) => item.value === doc.kind)?.label ?? doc.kind;
}

export function DocumentsPanel({
  entityType,
  entityId,
  variant = "default",
  hideEmptyState = false,
}: {
  entityType: DocumentEntityType;
  entityId: string;
  variant?: "default" | "lease";
  /** Sin tarjeta “todavía no hay documentos” cuando la lista está vacía. */
  hideEmptyState?: boolean;
}) {
  const app = useApp();
  const leaseAttachments = variant === "lease";
  const unitPhotos = entityType === "unit";
  const propertyFolder = entityType === "property";
  const cappedImagePhotos = leaseAttachments || unitPhotos;
  const imagesOnlyUpload = leaseAttachments || unitPhotos;
  const [documents, setDocuments] = useState<PropertyDocument[]>([]);
  const [usage, setUsage] = useState<ListResponse["usage"] | null>(null);
  const [kind, setKind] = useState("image");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<{ name: string; mime: string; url: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewerToken = useRef(0);

  async function load() {
    const data = await api<ListResponse>(
      "GET",
      `/api/documents?entity_type=${entityType}&entity_id=${entityId}`,
    );
    setDocuments(data.documents);
    setUsage(data.usage);
    return data.documents;
  }

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      try {
        setLoading(true);
        const docs = await load();
        if (entityType === "property") return;
        const next: Record<string, string> = {};
        await Promise.all(
          docs
            .filter((doc) => doc.mime.startsWith("image/"))
            .map(async (doc) => {
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
  }, [entityType, entityId]);

  async function refresh() {
    const docs = await load();
    if (entityType === "property") {
      setPreviews({});
      return [];
    }
    const next: Record<string, string> = {};
    const created: string[] = [];
    await Promise.all(
      docs
        .filter((doc) => doc.mime.startsWith("image/"))
        .map(async (doc) => {
          const blob = await apiBlob(`/api/documents/${doc.id}`);
          const url = URL.createObjectURL(blob);
          created.push(url);
          next[doc.id] = url;
        }),
    );
    setPreviews((current) => {
      for (const url of Object.values(current)) URL.revokeObjectURL(url);
      return next;
    });
    return created;
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    if (propertyFolder) {
      const used = documents.reduce((sum, doc) => sum + doc.size_bytes, 0);
      const incoming = files.reduce((sum, file) => sum + file.size, 0);
      if (documents.length + files.length > PROPERTY_FILE_LIMIT) {
        app.setError("Esta propiedad admite como máximo 10 archivos");
        return;
      }
      if (files.some((file) => file.size > PROPERTY_FILE_BYTES)) {
        app.setError("Cada archivo puede pesar como máximo 30 MB");
        return;
      }
      if (used + incoming > PROPERTY_TOTAL_BYTES) {
        app.setError("Los archivos de esta propiedad no pueden superar 120 MB en total");
        return;
      }
    }
    const photos = documents.filter((doc) => doc.mime.startsWith("image/"));
    const incomingImages = files.filter(
      (file) => file.type === "" || file.type.startsWith("image/"),
    );
    if (
      cappedImagePhotos &&
      photos.length + incomingImages.length > ENTITY_IMAGE_PHOTO_LIMIT
    ) {
      app.setError(
        leaseAttachments
          ? "Máximo 25 fotografías por contrato"
          : "Máximo 25 fotografías por unidad",
      );
      return;
    }
    if (
      imagesOnlyUpload &&
      files.some((file) => file.type !== "" && !file.type.startsWith("image/"))
    ) {
      app.setError(
        unitPhotos
          ? "En la unidad solo se admiten imágenes JPEG, PNG, WebP o GIF"
          : "En el contrato solo se admiten imágenes JPEG, PNG, WebP o GIF",
      );
      return;
    }
    if (leaseAttachments && files.some((file) => file.size > LEASE_PHOTO_BYTES)) {
      app.setError("Cada fotografía puede pesar como máximo 15 MB");
      return;
    }
    const uploadKind = imagesOnlyUpload ? "image" : kind.startsWith("other:") ? "other" : kind;
    const label = !imagesOnlyUpload && kind.startsWith("other:") ? kind.slice("other:".length) : "";
    setUploading(true);
    try {
      let coverAssigned = documents.some((doc) => doc.kind === "image");
      for (const file of files) {
        const fileKind = propertyFolder ? propertyFileKind(file) : uploadKind;
        const form = new FormData();
        form.set("entity_type", entityType);
        form.set("entity_id", entityId);
        form.set("kind", fileKind);
        form.set("file", file);
        if (!propertyFolder && label) form.set("label", label);
        if (fileKind === "image" && !coverAssigned && !leaseAttachments) {
          form.set("is_cover", "true");
          coverAssigned = true;
        }
        await apiForm("/api/documents", form);
      }
      await refresh();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function makeCover(id: string) {
    try {
      await api("POST", `/api/documents/${id}/cover`);
      await refresh();
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api("DELETE", `/api/documents/${id}`);
      await refresh();
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  function closeViewer() {
    viewerToken.current += 1;
    setViewer((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function openViewer(doc: PropertyDocument) {
    const token = ++viewerToken.current;
    setViewer((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return { name: doc.filename, mime: doc.mime, url: null };
    });
    try {
      const blob = await apiBlob(`/api/documents/${doc.id}`);
      if (viewerToken.current !== token) return;
      setViewer({ name: doc.filename, mime: doc.mime, url: URL.createObjectURL(blob) });
    } catch (err) {
      if (viewerToken.current !== token) return;
      setViewer(null);
      app.setError((err as Error).message);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeViewer();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function download(doc: PropertyDocument) {
    try {
      const blob = await apiBlob(`/api/documents/${doc.id}?download=1`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  const images = documents.filter((doc) => doc.mime.startsWith("image/"));
  const files = documents.filter((doc) => !doc.mime.startsWith("image/"));
  const cover = images.find((doc) => doc.is_cover) ?? images[0];

  return (
    <section
      className={cn(
        "space-y-4",
        propertyFolder && dragOver && "rounded-lg bg-muted",
      )}
      onDragOver={
        propertyFolder
          ? (event) => {
              event.preventDefault();
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={
        propertyFolder
          ? (event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDragOver(false);
            }
          : undefined
      }
      onDrop={
        propertyFolder
          ? (event) => {
              event.preventDefault();
              setDragOver(false);
              void uploadFiles([...event.dataTransfer.files]);
            }
          : undefined
      }
    >
      <div
        className={cn(
          "flex flex-wrap gap-3",
          imagesOnlyUpload || propertyFolder ? "flex-col" : "items-end justify-between",
        )}
      >
        {!propertyFolder && (
        <div>
          <h2 className="text-[1.0625rem] font-semibold leading-tight">
            {leaseAttachments ? "Imágenes" : unitPhotos ? "Fotografías" : "Documentos"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {leaseAttachments
              ? `JPEG, PNG, WebP o GIF. Máximo 15 MB y ${ENTITY_IMAGE_PHOTO_LIMIT} fotografías.`
              : unitPhotos
                ? `JPEG, PNG, WebP o GIF. Máximo 10 MB y ${ENTITY_IMAGE_PHOTO_LIMIT} fotografías.`
                : `JPEG, PNG, WebP, GIF o PDF. Máximo 10 MB por archivo${usage ? ` · ${usage.file_count} en la organización` : ""}.`}
          </p>
        </div>
        )}
        {!imagesOnlyUpload && !propertyFolder && (
        <div className="w-56">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        )}
        {propertyFolder && (
          <>
            <Button
              type="button"
              className="h-11 self-end sm:h-8"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Subiendo…" : "Agregar"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              multiple
              onChange={(event) => {
                const list = event.target.files ? [...event.target.files] : [];
                event.target.value = "";
                void uploadFiles(list);
              }}
            />
          </>
        )}
      </div>

      {!propertyFolder && (
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground transition-colors",
          dragOver && "border-foreground bg-muted",
          uploading && "pointer-events-none opacity-60",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void uploadFiles([...event.dataTransfer.files]);
        }}
      >
        <Upload className="size-5" aria-hidden />
        <span>
          {uploading
            ? "Subiendo…"
            : imagesOnlyUpload
              ? "Arrastra fotografías o haz clic para elegirlas"
              : "Arrastra archivos o haz clic para elegirlos"}
        </span>
        <input
          type="file"
          className="sr-only"
          accept={
            imagesOnlyUpload
              ? "image/jpeg,image/png,image/webp,image/gif"
              : "image/jpeg,image/png,image/webp,image/gif,application/pdf"
          }
          multiple
          onChange={(event) => {
            const list = event.target.files ? [...event.target.files] : [];
            event.target.value = "";
            void uploadFiles(list);
          }}
        />
      </label>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {leaseAttachments
            ? "Cargando imágenes…"
            : unitPhotos
              ? "Cargando fotografías…"
              : "Cargando documentos…"}
        </Card>
      ) : (leaseAttachments ? images.length : documents.length) === 0 ? (
        hideEmptyState ? null : (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            {leaseAttachments
              ? "Todavía no hay imágenes."
              : unitPhotos
                ? "Todavía no hay fotografías."
                : "Todavía no hay documentos."}
          </Card>
        )
      ) : propertyFolder ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Modificado</TableHead>
                <TableHead className="text-right">Tamaño</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...documents]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => void openViewer(doc)}
                      >
                        {doc.mime.startsWith("image/") ? (
                          <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{doc.filename}</span>
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatModified(doc.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                      {formatFileSize(doc.size_bytes)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Eliminar documento"
                        onClick={() => remove(doc.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <>
          {!leaseAttachments && cover && previews[cover.id] && (
            <Card className="overflow-hidden">
              <img src={previews[cover.id]} alt={cover.filename} className="max-h-64 w-full object-cover" />
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                <span className="truncate">{cover.filename}</span>
                <span>Portada</span>
              </div>
            </Card>
          )}
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {images.map((doc) => (
                <Card key={doc.id} className="overflow-hidden">
                  {previews[doc.id] ? (
                    <img src={previews[doc.id]} alt={doc.filename} className="h-28 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">
                      Imagen
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-1 p-2">
                    <button
                      type="button"
                      className="min-w-0 truncate text-left text-xs"
                      onClick={() => download(doc)}
                    >
                      {doc.filename}
                    </button>
                    <div className="flex shrink-0">
                      {!leaseAttachments && (
                        <Button
                          type="button"
                          size="sm"
                          variant={doc.is_cover ? "secondary" : "ghost"}
                          aria-label="Usar como portada"
                          onClick={() => makeCover(doc.id)}
                        >
                          <Star className={cn("size-3.5", doc.is_cover && "fill-current")} />
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Eliminar documento"
                        onClick={() => remove(doc.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {!imagesOnlyUpload && files.length > 0 && (
            <Card className="divide-y">
              {files.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 p-3">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left text-sm"
                    onClick={() => download(doc)}
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{doc.filename}</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {kindName(doc)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="Eliminar documento"
                      onClick={() => remove(doc.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
      {viewer && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background"
          role="dialog"
          aria-modal="true"
          aria-label={viewer.name}
        >
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <p className="min-w-0 truncate text-sm font-medium">{viewer.name}</p>
            <Button type="button" variant="ghost" onClick={closeViewer}>
              Cerrar
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            {viewer.url == null ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : viewer.mime.startsWith("image/") ? (
              <img src={viewer.url} alt={viewer.name} className="max-h-full max-w-full object-contain" />
            ) : (
              <iframe title={viewer.name} src={viewer.url} className="h-full w-full border-0" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
