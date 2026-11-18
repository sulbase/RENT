import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Pencil, Trash2, User } from "lucide-react";
import { api, apiBlob, apiForm } from "@/api";
import { useApp } from "@/context";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import { TenantDialog } from "@/components/tenants/tenant-dialog";
import { LandlordDialog } from "./landlord-dialog";
import type { Lease, LeaseSignature, LeaseSignatureStatus, PropertyDocument, SignaturePurpose, Tenant } from "@/types";

const STATUS_LABEL: Record<LeaseSignatureStatus, string> = {
  draft: "Borrador",
  sent: "Enviado",
  viewed: "Visto",
  partially_signed: "Firma parcial",
  completed: "Firmado",
  declined: "Rechazado",
  expired: "Vencido",
  cancelled: "Cancelado",
};

const RECIPIENT_STATUS: Record<LeaseSignature["recipients"][number]["status"], string> = {
  pending: "Pendiente",
  viewed: "Visto",
  signed: "Firmó",
  declined: "Rechazó",
};

const OPEN = new Set<LeaseSignatureStatus>(["draft", "sent", "viewed", "partially_signed"]);

type RecipientDraft = {
  first_name: string;
  last_name: string;
  email: string;
  role: "owner" | "tenant";
};

function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0] ?? "", last_name: "" };
  return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") };
}

export function LeaseSigning({
  lease,
  tenants,
  onTenantSaved,
}: {
  lease: Lease;
  tenants: Tenant[];
  onTenantSaved: (tenant: Tenant) => void;
}) {
  const app = useApp();
  const { role } = useAuth();
  const canEditLandlord = role === "owner" || role === "manager";
  const [landlordOpen, setLandlordOpen] = useState(false);
  const [signatures, setSignatures] = useState<LeaseSignature[]>([]);
  const [documents, setDocuments] = useState<PropertyDocument[]>([]);
  const [preview, setPreview] = useState<{ url: string | null } | null>(null);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const previewToken = useRef(0);
  const previewUrl = useRef<string | null>(null);
  const [tenantOpen, setTenantOpen] = useState(false);
  const owner: RecipientDraft = {
    first_name: app.settings.landlord_first_name,
    last_name: app.settings.landlord_last_name,
    email: app.settings.landlord_email,
    role: "owner",
  };
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const tenantRecord = tenants.find((item) => item.id === lease.primary_tenant_id) ?? null;
  const tenantName = tenantRecord
    ? `${tenantRecord.first_name} ${tenantRecord.last_name}`.trim()
    : [lease.tenant_first_name, lease.tenant_last_name].filter(Boolean).join(" ");
  const tenantEmail = tenantRecord?.email ?? lease.tenant_email ?? "";
  const tenantGovernmentId = tenantRecord?.government_id ?? lease.tenant_government_id ?? "";

  const signedContracts = documents
    .filter((doc) => doc.kind === "signed_lease")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const signedBySystem = new Set(
    signatures.map((item) => item.document_id).filter((id): id is string => Boolean(id)),
  );

  async function load() {
    const [signatureData, documentData] = await Promise.all([
      api<{ signatures: LeaseSignature[] }>("GET", `/api/leases/${lease.id}/signature`),
      api<{ documents: PropertyDocument[] }>(
        "GET",
        `/api/documents?entity_type=lease&entity_id=${lease.id}`,
      ),
    ]);
    setSignatures(signatureData.signatures);
    setDocuments(documentData.documents);
    return documentData.documents;
  }

  async function syncWithFirma(manual: boolean) {
    setSyncing(true);
    try {
      const result = await api<{ completed: boolean; error?: string | null }>(
        "POST",
        `/api/leases/${lease.id}/signature/sync?purpose=lease`,
      );
      if (result.completed) {
        await load();
        if (result.error) app.setError(result.error);
      } else if (manual) {
        app.setError("Todavía faltan firmas. Cuando ambas partes firmen, el contrato aparecerá abajo.");
      }
    } catch (err) {
      if (manual) app.setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => app.setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lease.id]);

  const leaseSignature = signatures.find((item) => (item.purpose ?? "lease") === "lease");
  const needsSync = Boolean(
    leaseSignature &&
      (OPEN.has(leaseSignature.status) || (leaseSignature.status === "completed" && !leaseSignature.document_id)),
  );
  const autoSynced = useRef<string | null>(null);
  useEffect(() => {
    if (!leaseSignature || !needsSync || autoSynced.current === leaseSignature.id) return;
    autoSynced.current = leaseSignature.id;
    void syncWithFirma(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseSignature?.id, needsSync]);

  function signatureFor(purpose: SignaturePurpose): LeaseSignature | undefined {
    return signatures.find((item) => (item.purpose ?? "lease") === purpose);
  }

  function recipients(): RecipientDraft[] | string {
    if (!owner.first_name.trim() || !owner.email.trim()) {
      return "Completa el nombre y el correo del arrendador en Firmantes";
    }
    if (!lease.primary_tenant_id) {
      return "El contrato no tiene inquilino principal";
    }
    if (!tenantName || !tenantEmail.trim()) {
      return "El inquilino necesita nombre y correo. Edítalos en su ficha";
    }
    const tenantParts = splitName(tenantName);
    return [
      { ...owner, last_name: owner.last_name.trim() || owner.first_name.trim() },
      {
        first_name: tenantParts.first_name,
        last_name: tenantParts.last_name.trim() || tenantParts.first_name,
        email: tenantEmail.trim(),
        role: "tenant",
      },
    ];
  }

  async function send(purpose: SignaturePurpose) {
    const people = recipients();
    if (typeof people === "string") {
      app.setError(people);
      return;
    }
    setBusy(true);
    try {
      await api("POST", `/api/leases/${lease.id}/signature`, {
        purpose,
        recipients: people.map((person, index) => ({ ...person, order: index + 1 })),
      });
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend(purpose: SignaturePurpose) {
    setBusy(true);
    try {
      await api("POST", `/api/leases/${lease.id}/signature/resend?purpose=${purpose}`);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(purpose: SignaturePurpose) {
    setBusy(true);
    try {
      await api("POST", `/api/leases/${lease.id}/signature/cancel?purpose=${purpose}`, {});
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadSigned(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("entity_type", "lease");
      form.set("entity_id", lease.id);
      form.set("kind", "signed_lease");
      form.set("file", file);
      await apiForm<{ document: PropertyDocument }>("/api/documents", form);
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeSigned(documentIdToRemove: string) {
    setBusy(true);
    try {
      await api("DELETE", `/api/documents/${documentIdToRemove}`);
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const previewKey = [
    owner.first_name,
    owner.last_name,
    app.settings.landlord_government_id,
    tenantName,
    tenantGovernmentId,
  ].join("|");
  const reviewed = previewedKey === previewKey;

  async function openPreview() {
    const token = ++previewToken.current;
    setPreview({ url: null });
    try {
      const blob = await apiBlob(`/api/leases/${lease.id}/signature/preview`);
      if (previewToken.current !== token) return;
      const url = URL.createObjectURL(blob);
      previewUrl.current = url;
      setPreview({ url });
      setPreviewedKey(previewKey);
    } catch (err) {
      if (previewToken.current !== token) return;
      setPreview(null);
      app.setError((err as Error).message);
    }
  }

  function releasePreviewUrl() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  }

  function closePreview() {
    previewToken.current += 1;
    releasePreviewUrl();
    setPreview(null);
  }

  useEffect(() => {
    if (!preview) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closePreview();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  useEffect(
    () => () => {
      previewToken.current += 1;
      releasePreviewUrl();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function openSigned(documentIdToOpen: string) {
    try {
      const blob = await apiBlob(`/api/documents/${documentIdToOpen}`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  const ownerLabel = [owner.first_name, owner.last_name].filter(Boolean).join(" ");

  return (
    <section className="space-y-6">
      <PurposeBlock
        title="Firma del contrato"
        description="Se envía la plantilla del contrato a firmar. Cuando ambas partes firmen, el contrato firmado se guarda abajo."
        current={signatureFor("lease")}
        busy={busy}
        onResend={() => resend("lease")}
        onCancel={() => cancel("lease")}
        onOpenSigned={openSigned}
        onSync={needsSync ? () => void syncWithFirma(true) : undefined}
        syncing={syncing}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit rounded-full px-4"
            disabled={busy}
            onClick={() => void openPreview()}
          >
            Vista previa
          </Button>
          <Button
            type="button"
            size="sm"
            className="w-fit rounded-full px-4"
            disabled={busy || !reviewed}
            onClick={() => send("lease")}
          >
            Enviar a firma
          </Button>
        </div>
        {!reviewed && (
          <p className="text-xs text-muted-foreground">Abre la vista previa y revisa el documento antes de enviarlo.</p>
        )}
      </PurposeBlock>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa del contrato"
        >
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <p className="min-w-0 truncate text-sm font-medium">Vista previa del contrato</p>
            <Button type="button" variant="ghost" onClick={closePreview}>
              Cerrar
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            {preview.url == null ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
              <iframe title="Vista previa del contrato" src={preview.url} className="h-full w-full border-0" />
            )}
          </div>
        </div>
      )}

      <div className="space-y-3 border-t pt-4">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Firmantes</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <PartyCard
            title="Arrendador"
            name={ownerLabel}
            emptyName="Sin nombre"
            email={owner.email}
            governmentId={app.settings.landlord_government_id}
            onEdit={() => setLandlordOpen(true)}
            editDisabled={!canEditLandlord}
          />
          <PartyCard
            title="Inquilino"
            name={tenantName}
            emptyName="Sin inquilino principal"
            email={tenantEmail}
            governmentId={tenantGovernmentId}
            onEdit={() => setTenantOpen(true)}
            editDisabled={!tenantRecord}
          />
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Contrato firmado</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Aquí queda el PDF con las firmas de ambas partes. Si ya se firmó fuera de RENT, súbelo en PDF.
            </p>
          </div>
          <label
            className={cn(
              "inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full border px-4 text-sm",
              busy && "pointer-events-none opacity-50",
            )}
          >
            Subir contrato firmado
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void uploadSigned(file);
              }}
            />
          </label>
        </div>
        {signedContracts.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Todavía no hay un contrato firmado.
          </Card>
        ) : (
          <Card className="divide-y">
            {signedContracts.map((doc) => {
              const fromSigning = signedBySystem.has(doc.id);
              return (
                <div key={doc.id} className="flex items-center justify-between gap-3 p-3">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left text-sm"
                    onClick={() => void openSigned(doc.id)}
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{doc.filename}</span>
                      <span className="block text-xs text-muted-foreground">
                        {fromSigning ? "Firmado en RENT" : "Subido"} · {formatDate(doc.created_at)}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => void openSigned(doc.id)}>
                      Ver
                    </Button>
                    {!fromSigning && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Eliminar contrato firmado"
                        disabled={busy}
                        onClick={() => void removeSigned(doc.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </div>

      <LandlordDialog open={landlordOpen} onOpenChange={setLandlordOpen} />
      {tenantRecord && (
        <TenantDialog
          open={tenantOpen}
          onOpenChange={setTenantOpen}
          tenant={tenantRecord}
          onSaved={onTenantSaved}
        />
      )}
    </section>
  );
}

function PartyCard({
  title,
  name,
  emptyName,
  email,
  governmentId,
  onEdit,
  editDisabled,
}: {
  title: string;
  name: string;
  emptyName: string;
  email: string;
  governmentId: string;
  onEdit: () => void;
  editDisabled?: boolean;
}) {
  const missingEmail = !email.trim();
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <User className="size-6" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="section-label">{title}</p>
        <p className="mt-0.5 truncate text-sm font-semibold">{name.trim() || emptyName}</p>
        <p className={cn("truncate text-sm", missingEmail ? "text-destructive" : "text-muted-foreground")}>
          {missingEmail ? "Sin correo" : email}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          Documento de identidad: {governmentId.trim() || "—"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0"
        aria-label={`Editar ${title.toLowerCase()}`}
        disabled={editDisabled}
        onClick={onEdit}
      >
        <Pencil className="size-3.5" />
      </Button>
    </Card>
  );
}

function PurposeBlock({
  title,
  description,
  current,
  busy,
  onResend,
  onCancel,
  onOpenSigned,
  onSync,
  syncing,
  children,
}: {
  title: string;
  description: string;
  current?: LeaseSignature;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
  onOpenSigned: (documentId: string) => void;
  onSync?: () => void;
  syncing?: boolean;
  children: ReactNode;
}) {
  const inProgress = current ? OPEN.has(current.status) : false;
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-[1.0625rem] font-semibold leading-tight">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {current && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{STATUS_LABEL[current.status]}</span>
            {current.document_id && (
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenSigned(current.document_id!)}>
                Ver PDF firmado
              </Button>
            )}
          </div>
          {current.last_error && <p className="text-xs text-destructive">{current.last_error}</p>}
          <ul className="space-y-1 text-xs text-muted-foreground">
            {current.recipients.map((recipient) => (
              <li key={recipient.id}>
                {recipient.name} · {recipient.email} · {recipient.role === "owner" ? "Arrendador" : "Inquilino"} ·{" "}
                {RECIPIENT_STATUS[recipient.status]}
                {recipient.signed_at ? ` · ${recipient.signed_at.slice(0, 10)}` : ""}
              </li>
            ))}
          </ul>
          {(inProgress || onSync) && (
            <div className="flex flex-wrap gap-2">
              {onSync && (
                <Button type="button" variant="outline" size="sm" disabled={busy || syncing} onClick={onSync}>
                  {syncing ? "Consultando…" : "Actualizar estado"}
                </Button>
              )}
              {inProgress && (
                <>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onResend}>
                    Reenviar
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
                    Cancelar
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {!inProgress && <div className="grid gap-2">{children}</div>}
    </div>
  );
}
