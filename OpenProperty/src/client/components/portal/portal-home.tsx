import { useState } from "react";
import { Files, Info, Smartphone, Wrench } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn, formatDate, formatMoney, formatPeriod } from "@/lib/utils";
import { chargeConcept } from "../../../shared/parking-charge";
import { PORTAL_MAIL_COMPOSE_HREF, usePortal } from "./portal-context";
import {
  balanceOf,
  cutoffIso,
  cutoffIsPast,
  openCharges,
} from "./portal-lease-balance";
import type { PortalCharge, PortalLease } from "./portal-types";

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
            const cutoff = cutoffIso(lease, home.charges);
            const cutoffPast = cutoffIsPast(cutoff);
            return (
              <Card key={lease.id} className="p-5">
                <p className="text-sm font-medium">{lease.unit_name ?? "Unidad"}</p>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      Monto adeudado
                      <button
                        type="button"
                        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-info-solid"
                        aria-label="Detalles del saldo"
                        onClick={() => setDetail(lease)}
                      >
                        <Info className="size-4" aria-hidden />
                      </button>
                    </div>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(total, currency)}</p>
                    <p
                      className={cn(
                        "mt-1 text-sm font-medium",
                        cutoffPast ? "text-destructive-solid" : "text-success",
                      )}
                    >
                      Fecha de corte: {formatDate(cutoff)}
                    </p>
                  </div>
                  <Button type="button" onClick={() => navigate(`/portal/pagos?lease=${lease.id}`)}>
                    Pagar ahora
                  </Button>
                </div>
              </Card>
            );
          })}
          <section className="pt-2">
            <h2 className="mb-6 text-xl font-semibold">Enlaces rápidos</h2>
            <div className="grid max-w-2xl grid-cols-3 gap-4 sm:gap-8">
              <QuickLink
                icon={Wrench}
                label="Solicitar mantenimiento"
                onClick={() => {
                  const lease = home.leases.length === 1 ? home.leases[0] : null;
                  navigate(
                    lease
                      ? `/portal/departamento/mantenimiento/nuevo?lease=${lease.id}`
                      : "/portal/departamento",
                  );
                }}
              />
              <QuickLink
                icon={Smartphone}
                label="Comuníquese con nosotros"
                onClick={() => navigate(PORTAL_MAIL_COMPOSE_HREF)}
              />
              <QuickLink
                icon={Files}
                label="Ver documentos"
                onClick={() => {
                  const lease = home.leases.length === 1 ? home.leases[0] : null;
                  navigate(
                    lease ? `/portal/departamento/documentos?lease=${lease.id}` : "/portal/departamento",
                  );
                }}
              />
            </div>
          </section>
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
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function QuickLink({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Wrench;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="flex cursor-pointer flex-col items-center gap-3 text-center" onClick={onClick}>
      <span className="flex size-16 items-center justify-center rounded-full bg-[#3a3937] text-foreground">
        <Icon className="size-7" strokeWidth={1.5} aria-hidden />
      </span>
      <span className="max-w-[8rem] text-sm leading-snug">{label}</span>
    </button>
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
              <span className="capitalize">
                {chargeConcept(charge.kind)} de {formatPeriod(charge.period)}
              </span>
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
