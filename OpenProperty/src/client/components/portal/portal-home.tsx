import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { apiBlob } from "@/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import { buildTenantLedger } from "../../../shared/tenant-ledger";
import { usePortal } from "./portal-context";
import type { PortalDocument, PortalLease } from "./portal-types";

export function PortalHomePage() {
  const { home, settings } = usePortal();
  const [error, setError] = useState<string | null>(null);
  const currency = settings.currency;

  const ledger = useMemo(
    () => buildTenantLedger({ charges: home?.charges ?? [], payments: home?.payments ?? [] }),
    [home],
  );

  if (!home) return null;
  const balance = ledger[0]?.balance ?? 0;

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
    <PageShell
      title="Inicio"
      meta={home.tenant.organization_name}
      width="max-w-5xl"
      notifications={false}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="p-5">
        <div className="text-[1.0625rem] font-semibold leading-tight">
          {home.leases.length > 1 ? "Contratos vigentes" : "Contrato vigente"}
        </div>
        {home.leases.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No tienes un contrato vigente.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {home.leases.map((lease) => (
              <li key={lease.id} className="py-3 first:pt-1 last:pb-0">
                <LeaseFields lease={lease} currency={currency} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[1.0625rem] font-semibold leading-tight">Estado de cuenta</h2>
          <div className="text-sm">
            <span className="text-muted-foreground">Saldo </span>
            <span
              className={`font-semibold tabular-nums ${balance > 0 ? "text-destructive-solid" : ""}`}
            >
              {formatMoney(balance, currency)}
            </span>
          </div>
        </div>
        {ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay movimientos.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">
                  <span className="font-medium text-destructive-solid">Cargos</span>
                  <span className="text-muted-foreground"> / Pagos</span>
                </TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.date)}</TableCell>
                  <TableCell>
                    <div>{entry.typeLabel}</div>
                    {entry.place ? <div className="text-xs text-muted-foreground">{entry.place}</div> : null}
                    {entry.note ? <div className="text-xs text-muted-foreground">{entry.note}</div> : null}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      entry.kind === "charge" && entry.counts ? "font-semibold text-destructive-solid" : ""
                    } ${entry.counts ? "" : "text-muted-foreground line-through"}`}
                  >
                    {formatMoney(entry.amount, currency)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(entry.balance, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-[1.0625rem] font-semibold leading-tight">Contratos firmados</h2>
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

function LeaseFields({ lease, currency }: { lease: PortalLease; currency: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Field label="Propiedad">{lease.property_name ?? "—"}</Field>
      <Field label="Unidad">{lease.unit_name ?? "—"}</Field>
      <Field label="Vigencia">
        {formatDate(lease.start_date)} → {formatDate(lease.end_date)}
      </Field>
      <Field label="Renta mensual">{formatMoney(lease.monthly_rent, currency)}</Field>
      <Field label="Día de pago">{`Día ${lease.rent_due_day} de cada mes`}</Field>
      <Field label="Depósito">{formatMoney(lease.deposit, currency)}</Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-label">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{children}</div>
    </div>
  );
}
