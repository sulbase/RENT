import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiForm } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { chargeStatusLabel } from "@/lib/labels";
import { formatDate, formatMoney, formatPeriod, toIsoDate } from "@/lib/utils";
import { buildTenantLedger } from "../../../shared/tenant-ledger";
import { PageShell } from "@/components/page-shell";
import { usePortal } from "./portal-context";
import type { PortalCharge, PortalReceipt } from "./portal-types";

function balanceOf(charge: PortalCharge): number {
  return Math.max(0, Math.round((charge.amount - (charge.amount_paid ?? 0)) * 100) / 100);
}

export function PortalPaymentsPage() {
  const { home, settings, reload, navigate, location } = usePortal();
  const currency = settings.currency;
  const leaseId = useMemo(() => {
    const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
    const id = new URLSearchParams(query).get("lease");
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  }, [location]);
  const [picked, setPicked] = useState<string[]>([]);
  const [paidOn, setPaidOn] = useState(toIsoDate(new Date()));
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<PortalReceipt[]>([]);

  const loadReceipts = useCallback(async () => {
    try {
      const data = await api<{ submissions: PortalReceipt[] }>("GET", "/api/portal/payment-submissions");
      setReceipts(data.submissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar tus comprobantes");
    }
  }, []);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  useEffect(() => {
    setPicked([]);
  }, [leaseId]);

  const lease = home?.leases.find((row) => row.id === leaseId) ?? null;
  const charges = useMemo(
    () =>
      (home?.charges ?? [])
        .filter((charge) => charge.lease_id === lease?.id && charge.status !== "paid" && charge.status !== "waived" && balanceOf(charge) > 0)
        .sort((a, b) => (a.due_date < b.due_date ? -1 : 1)),
    [home, lease],
  );
  const selected = charges.filter((charge) => picked.includes(charge.id));
  const total = selected.reduce((sum, charge) => sum + balanceOf(charge), 0);
  const ledger = useMemo(() => {
    if (!lease) return [];
    return buildTenantLedger({
      charges: (home?.charges ?? []).filter((row) => row.lease_id === lease.id),
      payments: (home?.payments ?? []).filter((row) => row.lease_id === lease.id),
    });
  }, [home, lease]);

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function send() {
    if (!file || selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("charge_ids", JSON.stringify(selected.map((charge) => charge.id)));
      form.set("paid_on", paidOn);
      if (reference.trim()) form.set("reference", reference.trim());
      form.set("file", file);
      await apiForm("/api/portal/receipts", form);
      setPicked([]);
      setFile(null);
      setReference("");
      await loadReceipts();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el comprobante");
    } finally {
      setSaving(false);
    }
  }

  if (!home) return null;

  return (
    <PageShell title="Pagos" meta={lease?.unit_name ?? home.tenant.organization_name} width="max-w-5xl" notifications={false}>
      {!lease ? (
        <Card className="p-5">
          <h2 className="text-[1.0625rem] font-semibold">Elige la unidad</h2>
          {home.leases.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No tienes un contrato vigente.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {home.leases.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-sm font-medium">{row.unit_name ?? "Unidad"}</span>
                  <Button type="button" variant="outline" onClick={() => navigate(`/portal/pagos?lease=${row.id}`)}>
                    Continuar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <>
          {home.leases.length > 1 && (
            <Button type="button" variant="ghost" className="px-0" onClick={() => navigate("/portal/pagos")}>
              Cambiar unidad
            </Button>
          )}
          <Card className="p-5">
            <h2 className="text-[1.0625rem] font-semibold">Método de pago</h2>
            <p className="mt-2 text-sm">Transferencia</p>
            <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
              <div><dt className="text-muted-foreground">Titular</dt><dd>{settings.bank_holder || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Banco</dt><dd>{settings.bank_name || "—"}</dd></div>
              <div><dt className="text-muted-foreground">Cuenta</dt><dd>{settings.bank_account || "—"}</dd></div>
              <div><dt className="text-muted-foreground">CLABE</dt><dd>{settings.bank_clabe || "—"}</dd></div>
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="text-[1.0625rem] font-semibold">Revisar y enviar</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Marca un cargo o varios. Cada uno se cubre por completo con el mismo comprobante.
            </p>
            {charges.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No tienes cargos pendientes en esta unidad.</p>
            ) : (
              <ul className="mt-3 divide-y">
                {charges.map((charge) => (
                  <li key={charge.id} className="flex items-center justify-between gap-3 py-3">
                    <label className="flex min-w-0 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.includes(charge.id)}
                        onChange={() => toggle(charge.id)}
                      />
                      <span>
                        <span className="capitalize">Renta de {formatPeriod(charge.period)}</span>
                        <span className="block text-xs text-muted-foreground">
                          vence {formatDate(charge.due_date)} · {chargeStatusLabel(charge.status)}
                        </span>
                      </span>
                    </label>
                    <span className="font-semibold tabular-nums">{formatMoney(balanceOf(charge), currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-baseline justify-between text-sm font-semibold">
              <span>Suma total</span>
              <span className="text-lg tabular-nums">{formatMoney(total, currency)}</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="pay-date">Fecha del pago</Label>
                <Input id="pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pay-ref">Referencia</Label>
                <Input id="pay-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="pay-file">Comprobante</Label>
                <Input
                  id="pay-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <Button
              type="button"
              className="mt-4"
              disabled={saving || !file || selected.length === 0}
              onClick={() => void send()}
            >
              Enviar pago
            </Button>
          </Card>
        </>
      )}

      <Card className="p-5">
        <h2 className="mb-3 text-[1.0625rem] font-semibold">Estado de cuenta</h2>
        {!lease ? (
          <p className="text-sm text-muted-foreground">Elige una unidad para ver sus movimientos.</p>
        ) : ledger.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay movimientos.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.date)}</TableCell>
                  <TableCell>
                    {entry.typeLabel}
                    {entry.note ? <div className="text-xs text-muted-foreground">{entry.note}</div> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(entry.amount, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(entry.balance, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {receipts.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 text-[1.0625rem] font-semibold">Mis comprobantes</h2>
          <ul className="divide-y">
            {receipts.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                <span className="text-sm capitalize">
                  Renta de {formatPeriod(row.period)} · {formatMoney(row.amount, currency)}
                </span>
                <Badge variant={row.status === "rejected" ? "destructive" : row.status === "approved" ? "default" : "secondary"}>
                  {row.status === "pending" ? "En revisión" : row.status === "approved" ? "Aprobado" : "Rechazado"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageShell>
  );
}
