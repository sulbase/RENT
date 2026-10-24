import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Mail, Pencil, Phone, User } from "lucide-react";
import { useApp } from "@/context";
import { api } from "@/api";
import { formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leaseStatusLabel } from "@/lib/labels";
import { TenantIdentification } from "./tenant-identification";
import { TenantDialog } from "./tenant-dialog";
import { TenantPortalAccess } from "./tenant-portal-access";
import { maritalStatusLabel } from "../../../shared/tenant-profile";
import type { Lease, Tenant, TenantPayment } from "@/types";
import {
  LEDGER_SOURCE_LABELS,
  buildTenantLedger,
  ledgerPlace,
  ledgerPlaces,
  type LedgerCharge,
} from "../../../shared/tenant-ledger";
import { PageShell } from "@/components/page-shell";

export function TenantPage({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const app = useApp();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [payments, setPayments] = useState<TenantPayment[]>([]);
  const [charges, setCharges] = useState<LedgerCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [unitFilter, setUnitFilter] = useState("all");

  async function load() {
    try {
      setLoading(true);
      const [{ tenant: t }, ll, pay] = await Promise.all([
        api<{ tenant: Tenant }>("GET", `/api/tenants/${id}`),
        app.listLeases({ tenant_id: id }),
        api<{ payments: TenantPayment[]; charges: LedgerCharge[] }>("GET", `/api/tenants/${id}/payments`),
      ]);
      setTenant(t);
      setLeases(ll);
      setPayments(pay.payments);
      setCharges(pay.charges);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUnitFilter("all");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const places = useMemo(() => ledgerPlaces([...charges, ...payments]), [charges, payments]);
  const selectedPlace = places.includes(unitFilter) ? unitFilter : "all";
  const ledger = useMemo(() => {
    const matches = <T extends { property_name?: string | null; unit_name?: string | null }>(row: T) =>
      selectedPlace === "all" || ledgerPlace(row.property_name, row.unit_name) === selectedPlace;
    return buildTenantLedger({
      charges: charges.filter(matches),
      payments: payments.filter(matches),
    });
  }, [charges, payments, selectedPlace]);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando inquilino…</div>;
  }
  if (!tenant) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Inquilino no encontrado.</p>
        <Button variant="outline" onClick={() => navigate("/tenants")}>Volver a inquilinos</Button>
      </div>
    );
  }

  const activeLeases = leases.filter((l) => l.status === "active");

  return (
    <PageShell
      title={
        <button
          type="button"
          onClick={() => navigate("/tenants")}
          className="inline-flex items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          Inquilinos
        </button>
      }
      width="max-w-5xl"
    >
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-12 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <User className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.01em]">{tenant.first_name} {tenant.last_name}</h1>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {tenant.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {tenant.email}</span>}
                {tenant.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {tenant.phone}</span>}
              </div>
            </div>
          </div>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 h-4 w-4" /> Editar
          </Button>
        </header>

        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="info">Información</TabsTrigger>
            <TabsTrigger value="more">Más</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            <Card className="p-5">
              <div className="text-[1.0625rem] font-semibold leading-tight">
                {activeLeases.length > 1 ? "Contratos vigentes" : "Contrato vigente"}
              </div>
              {activeLeases.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No hay contrato vigente.</p>
              ) : activeLeases.length === 1 ? (
                <ActiveLeaseFields lease={activeLeases[0]} currency={app.settings.currency} />
              ) : (
                <ul className="mt-2 divide-y">
                  {activeLeases.map((lease) => (
                    <li key={lease.id} className="py-3 first:pt-1">
                      <ActiveLeaseFields lease={lease} currency={app.settings.currency} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <TenantPortalAccess tenantId={tenant.id} email={tenant.email} />

            <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Historial de pagos</h2>
            {places.length > 1 ? (
              <Select value={selectedPlace} onValueChange={setUnitFilter}>
                <SelectTrigger className="w-64" aria-label="Unidad">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las unidades</SelectItem>
                  {places.map((place) => (
                    <SelectItem key={place} value={place}>{place}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay movimientos.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origen</TableHead>
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
                    <TableCell>{LEDGER_SOURCE_LABELS[entry.source]}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        entry.kind === "charge" && entry.counts ? "font-semibold text-destructive-solid" : ""
                      } ${entry.counts ? "" : "text-muted-foreground line-through"}`}
                    >
                      {formatMoney(entry.amount, app.settings.currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(entry.balance, app.settings.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
            </Card>
          </TabsContent>

          <TabsContent value="info" className="space-y-6">
            <Card className="p-5">
              <h2 className="mb-3 text-[1.0625rem] font-semibold leading-tight">Acerca de</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Fecha de nacimiento">{tenant.date_of_birth ? formatDate(tenant.date_of_birth) : "—"}</Field>
                <Field label="Contacto de emergencia">{tenant.emergency_contact || "—"}</Field>
                <Field label="Empleador">{tenant.employer || "—"}</Field>
                <Field label="Ingreso mensual">
                  {tenant.monthly_income != null ? formatMoney(tenant.monthly_income, app.settings.currency) : "—"}
                </Field>
                <Field label="Documento de identidad">{tenant.government_id || "—"}</Field>
                <Field label="Estado civil">{maritalStatusLabel(tenant.marital_status)}</Field>
                <Field label="Ocupación">{tenant.occupation || "—"}</Field>
                <Field label="Número de ocupantes">
                  {tenant.occupant_count != null ? String(tenant.occupant_count) : "—"}
                </Field>
                <Field label="Dirección de trabajo">{tenant.work_address || "—"}</Field>
                <Field label="Dirección anterior">{tenant.previous_address || "—"}</Field>
              </div>
              {tenant.notes && (
                <>
                  <div className="mt-4 text-[0.9375rem] font-semibold leading-tight">Notas</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{tenant.notes}</p>
                </>
              )}
            </Card>

            <Card className="p-5">
              <TenantIdentification tenantId={tenant.id} variant="view" />
            </Card>
          </TabsContent>

          <TabsContent value="more">
            <Card className="p-5">
              <h2 className="mb-3 text-[1.0625rem] font-semibold leading-tight">Historial de contratos</h2>
              {leases.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no hay contratos.</p>
              ) : (
                <ul className="divide-y">
                  {leases.map((l) => (
                    <li key={l.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium">
                          {l.property_name} · {l.unit_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(l.start_date)} → {formatDate(l.end_date)} · {formatMoney(l.monthly_rent, app.settings.currency)}/mes
                        </p>
                      </div>
                      <Badge variant={l.status === "active" ? "default" : "secondary"}>{leaseStatusLabel(l.status)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
        </Tabs>

      <TenantDialog
        open={editing}
        onOpenChange={(o) => { setEditing(o); if (!o) load(); }}
        tenant={tenant}
      />
    </PageShell>
  );
}

function ActiveLeaseFields({ lease, currency }: { lease: Lease; currency: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <Field label="Propiedad">{lease.property_name ?? "—"}</Field>
      <Field label="Unidad">{lease.unit_name ?? "—"}</Field>
      <Field label="Vigencia">
        {formatDate(lease.start_date)} → {formatDate(lease.end_date)}
      </Field>
      <Field label="Renta mensual">{formatMoney(lease.monthly_rent, currency)}</Field>
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
