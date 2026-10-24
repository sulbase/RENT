import { useEffect, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { api, apiBlob, apiForm } from "@/api";
import { useApp } from "@/context";
import { useRouter } from "@/hooks/use-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TenantDialog } from "@/components/tenants/tenant-dialog";
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
  const { navigate } = useRouter();
  const [signatures, setSignatures] = useState<LeaseSignature[]>([]);
  const [documents, setDocuments] = useState<PropertyDocument[]>([]);
  const [contractDocumentId, setContractDocumentId] = useState("template");
  const [inventoryDocumentId, setInventoryDocumentId] = useState("");
  const [tenantOpen, setTenantOpen] = useState(false);
  const owner: RecipientDraft = {
    first_name: app.settings.landlord_first_name,
    last_name: app.settings.landlord_last_name,
    email: app.settings.landlord_email,
    role: "owner",
  };
  const [busy, setBusy] = useState(false);

  const tenantRecord = tenants.find((item) => item.id === lease.primary_tenant_id) ?? null;
  const tenantName = tenantRecord
    ? `${tenantRecord.first_name} ${tenantRecord.last_name}`.trim()
    : [lease.tenant_first_name, lease.tenant_last_name].filter(Boolean).join(" ");
  const tenantEmail = tenantRecord?.email ?? lease.tenant_email ?? "";
  const tenantGovernmentId = tenantRecord?.government_id ?? lease.tenant_government_id ?? "";

  const contractPdfs = documents.filter(
    (doc) =>
      doc.mime === "application/pdf" && doc.kind !== "inventory" && doc.kind !== "signed_inventory",
  );
  const inventoryPdfs = documents.filter(
    (doc) => doc.mime === "application/pdf" && doc.kind === "inventory",
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

  useEffect(() => {
    load().catch((err: Error) => app.setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lease.id]);

  function signatureFor(purpose: SignaturePurpose): LeaseSignature | undefined {
    return signatures.find((item) => (item.purpose ?? "lease") === purpose);
  }

  function recipients(): RecipientDraft[] | string {
    if (!owner.first_name.trim() || !owner.email.trim()) {
      return "Completa el nombre y el correo del arrendador en Ajustes";
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
    const documentId = purpose === "inventory" ? inventoryDocumentId : contractDocumentId;
    if (purpose === "inventory" && !documentId) {
      app.setError("Sube el inventario en PDF antes de enviarlo a firma");
      return;
    }
    setBusy(true);
    try {
      await api("POST", `/api/leases/${lease.id}/signature`, {
        purpose,
        document_id: documentId === "template" ? undefined : documentId,
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

  async function uploadPdf(file: File | undefined, kind: "inventory" | "other") {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("entity_type", "lease");
      form.set("entity_id", lease.id);
      form.set("kind", kind);
      form.set("file", file);
      const saved = await apiForm<{ document: PropertyDocument }>("/api/documents", form);
      await load();
      if (kind === "inventory") setInventoryDocumentId(saved.document.id);
      else setContractDocumentId(saved.document.id);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
    <section className="space-y-4 border-t pt-3">
      <div className="space-y-3">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Firmantes</h2>
        <PartyRow
          title="Arrendador"
          lines={[
            ownerLabel || "Sin nombre",
            owner.email || "Sin correo",
            `Documento de identidad: ${app.settings.landlord_government_id.trim() || "—"}`,
          ]}
          onEdit={() => {
            sessionStorage.setItem("rent.settingsTab", "account");
            navigate("/settings");
          }}
        />
        <PartyRow
          title="Inquilino"
          lines={[
            tenantName || "Sin inquilino principal",
            tenantEmail || "Sin correo",
            `Documento de identidad: ${tenantGovernmentId.trim() || "—"}`,
          ]}
          onEdit={() => setTenantOpen(true)}
          editDisabled={!tenantRecord}
        />
      </div>

      <PurposeBlock
        title="Firma del contrato"
        description="Elige la plantilla o un PDF propio. El PDF firmado queda archivado en documentos."
        current={signatureFor("lease")}
        busy={busy}
        onResend={() => resend("lease")}
        onCancel={() => cancel("lease")}
        onOpenSigned={openSigned}
      >
        <div>
          <Label>Documento</Label>
          <Select value={contractDocumentId} onValueChange={setContractDocumentId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="template">Plantilla del contrato</SelectItem>
              {contractPdfs.map((doc) => (
                <SelectItem key={doc.id} value={doc.id}>
                  {doc.filename}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          Subir contrato en PDF
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void uploadPdf(file, "other");
            }}
          />
        </label>
        <Button type="button" size="sm" disabled={busy} onClick={() => send("lease")}>
          Enviar a firma
        </Button>
      </PurposeBlock>

      <PurposeBlock
        title="Inventario de daños"
        description="Hoja aparte del contrato. Solo se firma el PDF que subas."
        current={signatureFor("inventory")}
        busy={busy}
        onResend={() => resend("inventory")}
        onCancel={() => cancel("inventory")}
        onOpenSigned={openSigned}
      >
        <div>
          <Label>Documento</Label>
          <Select
            value={inventoryDocumentId || undefined}
            onValueChange={setInventoryDocumentId}
            disabled={inventoryPdfs.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder="Sube el inventario en PDF" />
            </SelectTrigger>
            <SelectContent>
              {inventoryPdfs.map((doc) => (
                <SelectItem key={doc.id} value={doc.id}>
                  {doc.filename}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          Subir inventario en PDF
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void uploadPdf(file, "inventory");
            }}
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={busy || inventoryPdfs.length === 0}
          onClick={() => send("inventory")}
        >
          Enviar a firma
        </Button>
      </PurposeBlock>

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

function PartyRow({
  title,
  lines,
  onEdit,
  editDisabled,
  children,
}: {
  title: string;
  lines: string[];
  onEdit: () => void;
  editDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium">{title}</p>
          {lines.map((line, index) => (
            <p key={`${title}-${index}`} className="text-sm text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Editar ${title.toLowerCase()}`}
          disabled={editDisabled}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
      {children}
    </div>
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
  children,
}: {
  title: string;
  description: string;
  current?: LeaseSignature;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
  onOpenSigned: (documentId: string) => void;
  children: ReactNode;
}) {
  const inProgress = current ? OPEN.has(current.status) : false;
  return (
    <div className="space-y-2 border-t pt-3">
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
          {inProgress && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onResend}>
                Reenviar
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}
      {!inProgress && <div className="grid gap-2">{children}</div>}
    </div>
  );
}
