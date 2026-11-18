import { formatDate } from "@/lib/utils";
import type { PortalLease } from "./portal-types";

const STATUS: Record<string, string> = {
  active: "Actual",
  upcoming: "Próximo",
  ended: "Terminado",
  cancelled: "Cancelado",
};

export function PortalLeaseDetails({
  lease,
  leases,
}: {
  lease: PortalLease | null;
  leases: PortalLease[];
}) {
  const rows = lease ? [lease] : leases;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No tienes un contrato vigente.</p>;
  }
  return (
    <div className="space-y-8">
      {rows.map((row) => (
        <section key={row.id}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {[row.property_name, row.unit_name].filter(Boolean).join(" - ") || "Unidad"}
            </h2>
            <span className="text-sm">{STATUS[row.status] ?? row.status}</span>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Comienzo de arrendamiento" value={formatDate(row.start_date)} />
            <Row label="Finalización del arrendamiento" value={formatDate(row.end_date)} />
            <Row label="Ingreso" value="Sin programar" />
            <Row label="Salida" value="Sin programar" />
          </dl>
        </section>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
