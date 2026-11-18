import { useState } from "react";
import { Building2, ChevronDown, CreditCard, Home, LogOut, Mail, MapPin, Settings } from "lucide-react";
import type { PortalLease } from "./portal-types";

export type PortalNavId = "home" | "payments" | "department" | "contact" | "mail" | "settings";

function leasePlace(lease: PortalLease): string {
  return [lease.property_name, lease.unit_name].filter(Boolean).join(" · ") || "Unidad";
}

const ITEMS: { id: PortalNavId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Página principal", icon: Home },
  { id: "payments", label: "Pagos", icon: CreditCard },
  { id: "department", label: "Mi departamento", icon: Building2 },
  { id: "mail", label: "Correo", icon: Mail },
  { id: "contact", label: "Propiedad de contacto", icon: MapPin },
  { id: "settings", label: "Ajustes", icon: Settings },
];

export function PortalNav({
  active,
  leases,
  selectedLeaseId,
  onNavigate,
  onPickLease,
  onSignOut,
}: {
  active: PortalNavId;
  leases: PortalLease[];
  selectedLeaseId: string | null;
  onNavigate: (id: PortalNavId) => void;
  onPickLease: (leaseId: string) => void;
  onSignOut: () => void;
}) {
  const [unitsOpen, setUnitsOpen] = useState(false);
  const chooseUnit = leases.length >= 2;

  return (
    <aside className="cn-nav portal-nav flex shrink-0 flex-col">
      <div className="portal-brand">
        <img src="/icon.svg" alt="" className="size-9" />
        <span className="text-sm font-semibold tracking-tight">RENT</span>
        {leases.length > 0 && (
          <ul className="mt-1 w-full space-y-0.5 text-center text-xs text-muted-foreground">
            {leases.map((lease) => (
              <li key={lease.id}>{leasePlace(lease)}</li>
            ))}
          </ul>
        )}
      </div>
      <nav className="cn-nav-groups flex flex-1 flex-col gap-0.5 overflow-auto">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active;
          return (
            <div key={item.id}>
              <div className="cn-nav-item" data-active={isActive || undefined}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent text-left"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                  <span className="cn-nav-label">{item.label}</span>
                </button>
                {item.id === "department" && chooseUnit && (
                  <button
                    type="button"
                    className="cursor-pointer rounded-sm p-1 text-muted-foreground"
                    aria-label="Elegir propiedad"
                    aria-expanded={unitsOpen}
                    onClick={() => setUnitsOpen((open) => !open)}
                  >
                    <ChevronDown className={`size-4 transition-transform ${unitsOpen ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                )}
              </div>
              {item.id === "department" && chooseUnit && unitsOpen && (
                <ul className="mb-1 ml-8 space-y-0.5">
                  {leases.map((lease) => (
                    <li key={lease.id}>
                      <button
                        type="button"
                        className={`w-full cursor-pointer rounded-sm px-2 py-1 text-left text-sm ${
                          lease.id === selectedLeaseId ? "bg-muted text-foreground" : "text-muted-foreground"
                        }`}
                        onClick={() => {
                          onPickLease(lease.id);
                          setUnitsOpen(false);
                        }}
                      >
                        {leasePlace(lease)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      <div className="cn-nav-footer">
        <button type="button" className="cn-nav-item w-full text-left" onClick={onSignOut}>
          <LogOut className="size-4 shrink-0 opacity-70" aria-hidden />
          <span className="cn-nav-label">Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}
