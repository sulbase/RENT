import { Building2, CreditCard, Home, ListChecks, LogOut, Mail, Settings } from "lucide-react";
import type { PortalLease } from "./portal-types";

export type PortalNavId = "home" | "payments" | "department" | "maintenance" | "mail" | "settings";

const ITEMS: { id: PortalNavId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Página principal", icon: Home },
  { id: "payments", label: "Pagos", icon: CreditCard },
  { id: "department", label: "Mi departamento", icon: Building2 },
  { id: "maintenance", label: "Mantenimiento", icon: ListChecks },
  { id: "mail", label: "Correo", icon: Mail },
  { id: "settings", label: "Ajustes", icon: Settings },
];

export function PortalNav({
  active,
  leases,
  onNavigate,
  onSignOut,
}: {
  active: PortalNavId;
  leases: PortalLease[];
  onNavigate: (id: PortalNavId) => void;
  onSignOut: () => void;
}) {
  return (
    <aside className="cn-nav portal-nav flex shrink-0 flex-col">
      <div className="portal-brand">
        <img src="/icon.svg" alt="" className="size-9" />
        <span className="text-sm font-semibold tracking-tight">RENT</span>
        {leases.length > 0 && (
          <ul className="mt-1 w-full space-y-0.5 text-center text-xs text-muted-foreground">
            {leases.map((lease) => (
              <li key={lease.id}>{lease.unit_name ?? "Unidad"}</li>
            ))}
          </ul>
        )}
      </div>
      <nav className="cn-nav-groups flex flex-1 flex-col gap-0.5 overflow-auto">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              className="cn-nav-item"
              data-active={isActive || undefined}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
              <span className="cn-nav-label">{item.label}</span>
            </button>
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
