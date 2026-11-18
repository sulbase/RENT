import { useState } from "react";
import { ArrowLeft, Car, Contact, FileText, Wrench } from "lucide-react";
import { apiBlob } from "@/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { usePortal } from "./portal-context";
import { PortalMaintenancePanel } from "./portal-maintenance";
import { PortalContactsPage } from "./portal-contacts";
import { PortalVehiclesPage } from "./portal-vehicles";
import { PortalLeaseDetails } from "./portal-lease-details";
import { PortalUnitPicker } from "./portal-unit-picker";
import type { PortalDocument } from "./portal-types";

type Section =
  | "index"
  | "documents"
  | "maintenance"
  | "maintenance-new"
  | "contacts"
  | "contacts-new"
  | "contacts-edit"
  | "vehicles"
  | "vehicle-new"
  | "lease";

const TITLES: Record<Section, string> = {
  index: "Mi departamento",
  documents: "Documentos",
  maintenance: "Mantenimiento",
  "maintenance-new": "Mantenimiento",
  contacts: "Contactos de emergencia",
  "contacts-new": "Contactos de emergencia",
  "contacts-edit": "Contactos de emergencia",
  vehicles: "Vehículo",
  "vehicle-new": "Detalles del nuevo vehículo",
  lease: "Detalles del arrendamiento",
};

function sectionOf(location: string): Section {
  const path = location.split("?")[0] ?? location;
  if (path.endsWith("/documentos")) return "documents";
  if (path.endsWith("/mantenimiento/nuevo")) return "maintenance-new";
  if (path.endsWith("/mantenimiento") || path.endsWith("/portal/mantenimiento")) return "maintenance";
  if (path.endsWith("/contactos/nuevo")) return "contacts-new";
  if (path.endsWith("/contactos/editar")) return "contacts-edit";
  if (path.endsWith("/contactos")) return "contacts";
  if (path.endsWith("/vehiculos/nuevo")) return "vehicle-new";
  if (path.endsWith("/vehiculos")) return "vehicles";
  if (path.endsWith("/arrendamiento")) return "lease";
  return "index";
}

function backHref(section: Section, query: string, indexHref: string): string {
  if (section === "vehicle-new") return `/portal/departamento/vehiculos${query}`;
  if (section === "maintenance-new") return `/portal/departamento/mantenimiento${query}`;
  if (section === "contacts-new" || section === "contacts-edit") return `/portal/departamento/contactos${query}`;
  return indexHref;
}

function backLabel(section: Section): string {
  if (section === "vehicle-new") return "Vehículos";
  if (section === "maintenance-new") return "Mantenimiento";
  if (section === "contacts-new" || section === "contacts-edit") return "Contactos de emergencia";
  return "Mi departamento";
}

function leaseIdOf(location: string): string | null {
  const id = new URLSearchParams(location.split("?")[1] ?? "").get("lease");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function contactIdOf(location: string): string | null {
  const id = new URLSearchParams(location.split("?")[1] ?? "").get("contact");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export function PortalDepartmentPage() {
  const { home, location, navigate, settings } = usePortal();
  const [error, setError] = useState<string | null>(null);
  if (!home) return null;

  const section = sectionOf(location);
  const lease = home.leases.find((row) => row.id === leaseIdOf(location)) ?? null;
  const needsChoice = home.leases.length >= 2 && !lease;
  const query = lease ? `?lease=${lease.id}` : "";
  const indexHref = `/portal/departamento${query}`;

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

  const documents = lease
    ? home.documents.filter((doc) => doc.lease_id === lease.id)
    : home.documents;

  return (
    <PageShell
      title={TITLES[section]}
      meta={lease?.unit_name ?? home.tenant.organization_name}
      width="max-w-5xl"
      notifications={false}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {section !== "index" && (
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground"
          onClick={() => navigate(backHref(section, query, indexHref))}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel(section)}
        </button>
      )}

      {needsChoice && section === "index" ? (
        <Card className="p-5">
          <PortalUnitPicker
            title="Elige la propiedad"
            leases={home.leases}
            currency={settings.currency}
            onSelect={(id) => navigate(`/portal/departamento?lease=${id}`)}
          />
        </Card>
      ) : section === "index" ? (
        <div className="grid auto-rows-fr gap-4 md:grid-cols-2">
          <SectionCard
            icon={<FileText className="size-5" aria-hidden />}
            title="Documentos"
            detail="Los documentos correspondientes a su lease y otros documentos de la propiedad"
            onClick={() => navigate(`/portal/departamento/documentos${query}`)}
          />
          <SectionCard
            icon={<Contact className="size-5" aria-hidden />}
            title="Contactos de emergencia"
            detail="Administrar contactos de emergencia para su cuenta"
            onClick={() => navigate(`/portal/departamento/contactos${query}`)}
          />
          <SectionCard
            icon={<Wrench className="size-5" aria-hidden />}
            title="Mantenimiento"
            detail="Solicitar mantenimiento o reparaciones para su departamento"
            onClick={() => navigate(`/portal/departamento/mantenimiento${query}`)}
          />
          <SectionCard
            icon={<Car className="size-5" aria-hidden />}
            title="Vehículos"
            detail="Su lista de vehículos para la propiedad"
            onClick={() => navigate(`/portal/departamento/vehiculos${query}`)}
          />
          <SectionCard
            icon={<FileText className="size-5" aria-hidden />}
            title="Detalles del arrendamiento"
            detail="Ver fechas de inicio y finalización, fechas de entrada y salida, y estado de lease."
            onClick={() => navigate(`/portal/departamento/arrendamiento${query}`)}
          />
        </div>
      ) : section === "documents" ? (
        <Card className="p-5">
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay contratos firmados en el archivo.</p>
          ) : (
            <ul className="divide-y">
              {documents.map((doc) => (
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
      ) : section === "maintenance" || section === "maintenance-new" ? (
        <PortalMaintenancePanel
          lease={lease}
          creating={section === "maintenance-new"}
          onCreate={() => navigate(`/portal/departamento/mantenimiento/nuevo${query}`)}
          onDone={() => navigate(`/portal/departamento/mantenimiento${query}`)}
        />
      ) : section === "contacts" || section === "contacts-new" || section === "contacts-edit" ? (
        <PortalContactsPage
          creating={section === "contacts-new"}
          editContactId={section === "contacts-edit" ? contactIdOf(location) : null}
          onCreate={() => navigate(`/portal/departamento/contactos/nuevo${query}`)}
          onEdit={(id) =>
            navigate(
              `/portal/departamento/contactos/editar?contact=${id}${lease ? `&lease=${lease.id}` : ""}`,
            )
          }
          onDone={() => navigate(`/portal/departamento/contactos${query}`)}
        />
      ) : section === "vehicles" || section === "vehicle-new" ? (
        <PortalVehiclesPage
          lease={lease}
          creating={section === "vehicle-new"}
          onCreate={() => navigate(`/portal/departamento/vehiculos/nuevo${query}`)}
          onDone={() => navigate(`/portal/departamento/vehiculos${query}`)}
        />
      ) : (
        <PortalLeaseDetails lease={lease} leases={home.leases} />
      )}
    </PageShell>
  );
}

function SectionCard({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="h-full cursor-pointer text-left" onClick={onClick}>
      <Card className="flex h-full min-h-28 items-start gap-3 p-5 transition-colors hover:bg-muted">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          {icon}
        </span>
        <span>
          <span className="block text-[1.0625rem] font-semibold">{title}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{detail}</span>
        </span>
      </Card>
    </button>
  );
}
