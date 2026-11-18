import { Building2, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { cutoffIso, cutoffIsPast, leaseBalanceTotal } from "./portal-lease-balance";
import type { PortalCharge, PortalLease } from "./portal-types";

const LEASE_STATUS: Record<string, string> = {
  active: "Vigente",
  upcoming: "Próximo",
  ended: "Terminado",
  cancelled: "Cancelado",
};

export function PortalUnitPicker({
  title,
  leases,
  charges,
  currency,
  onSelect,
}: {
  title: string;
  leases: PortalLease[];
  charges?: PortalCharge[];
  currency?: string;
  onSelect: (leaseId: string) => void;
}) {
  if (leases.length === 0) {
    return <p className="text-sm text-muted-foreground">No tienes un contrato vigente.</p>;
  }

  const showBalance = charges !== undefined && currency !== undefined;

  return (
    <div>
      <h2 className="text-[1.0625rem] font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Selecciona una unidad para continuar.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {leases.map((lease) => {
          const address = [lease.address, lease.city].filter(Boolean).join(", ");
          const total = showBalance ? leaseBalanceTotal(charges, lease.id) : 0;
          const cutoff = showBalance ? cutoffIso(lease, charges) : "";
          const cutoffPast = showBalance && cutoffIsPast(cutoff);

          return (
            <button
              key={lease.id}
              type="button"
              className="group h-full cursor-pointer text-left"
              onClick={() => onSelect(lease.id)}
            >
              <Card className="flex h-full flex-col p-5 transition-colors hover:bg-[#3a3937]">
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#2a2928] text-foreground">
                    <Building2 className="size-5" strokeWidth={1.5} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold">{lease.unit_name ?? "Unidad"}</p>
                    {lease.property_name && lease.property_name !== lease.unit_name && (
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{lease.property_name}</p>
                    )}
                  </div>
                  <ChevronRight
                    className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </div>
                {address && <p className="mt-3 text-sm leading-snug text-muted-foreground">{address}</p>}
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Renta mensual</dt>
                    <dd className="shrink-0 font-medium tabular-nums">
                      {formatMoney(lease.monthly_rent, currency ?? "MXN")}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Estado</dt>
                    <dd className="shrink-0">{LEASE_STATUS[lease.status] ?? lease.status}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Contrato</dt>
                    <dd className="shrink-0 text-right tabular-nums">
                      {formatDate(lease.start_date)} – {formatDate(lease.end_date)}
                    </dd>
                  </div>
                </dl>
                {showBalance && (
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Monto adeudado</span>
                      <span className="font-semibold tabular-nums">{formatMoney(total, currency)}</span>
                    </div>
                    <p
                      className={cn(
                        "mt-1 text-sm font-medium",
                        cutoffPast ? "text-destructive-solid" : "text-success",
                      )}
                    >
                      Fecha de corte: {formatDate(cutoff)}
                    </p>
                  </div>
                )}
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
