import { useState } from "react";
import { Info } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatMoney, formatPeriod } from "@/lib/utils";
import { usePortal } from "./portal-context";
import type { PortalCharge, PortalLease } from "./portal-types";

function balanceOf(charge: PortalCharge): number {
  return Math.max(0, Math.round((charge.amount - (charge.amount_paid ?? 0)) * 100) / 100);
}

function openCharges(charges: PortalCharge[], leaseId: string): PortalCharge[] {
  return charges
    .filter((charge) => charge.lease_id === leaseId && charge.status !== "paid" && charge.status !== "waived" && balanceOf(charge) > 0)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
}

export function PortalHomePage() {
  const { home, settings, navigate } = usePortal();
  const [detail, setDetail] = useState<PortalLease | null>(null);
  if (!home) return null;
  const currency = settings.currency;

  return (
    <PageShell title="Página principal" meta={home.tenant.organization_name} width="max-w-5xl" notifications={false}>
      {home.leases.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">No tienes un contrato vigente.</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {home.leases.map((lease) => {
            const lines = openCharges(home.charges, lease.id);
            const total = lines.reduce((sum, charge) => sum + balanceOf(charge), 0);
            return (
              <Card key={lease.id} className="p-5">
                <p className="text-sm font-medium">{lease.unit_name ?? "Unidad"}</p>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      Monto adeudado
                      <button
                        type="button"
                        className="inline-flex size-5 items-center justify-center rounded-full text-info-solid"
                        aria-label="Detalles del saldo"
                        onClick={() => setDetail(lease)}
                      >
                        <Info className="size-4" aria-hidden />
                      </button>
                    </div>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(total, currency)}</p>
                  </div>
                  <Button type="button" onClick={() => navigate(`/portal/pagos?lease=${lease.id}`)}>
                    Pagar ahora
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalles del saldo</DialogTitle>
          </DialogHeader>
          {detail && (
            <BalanceDetail
              charges={openCharges(home.charges, detail.id)}
              currency={currency}
              unit={detail.unit_name}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDetail(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function BalanceDetail({
  charges,
  currency,
  unit,
}: {
  charges: PortalCharge[];
  currency: string;
  unit: string | null;
}) {
  const total = charges.reduce((sum, charge) => sum + balanceOf(charge), 0);
  return (
    <div>
      {unit && <p className="mb-3 text-sm text-muted-foreground">{unit}</p>}
      {charges.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay saldo pendiente.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {charges.map((charge) => (
            <li key={charge.id} className="flex items-baseline justify-between gap-3">
              <span className="capitalize">Renta de {formatPeriod(charge.period)}</span>
              <span className="tabular-nums">{formatMoney(balanceOf(charge), currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <Separator className="my-3" />
      <div className="flex items-baseline justify-between text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}
