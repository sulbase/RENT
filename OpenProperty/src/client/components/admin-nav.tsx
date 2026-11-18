import {
  Building2,
  ClipboardList,
  DollarSign,
  Home,
  LogOut,
  Mail,
  Settings,
  Truck,
  Users,
  Wrench,
} from "lucide-react";

export type AdminNavId =
  | "dashboard"
  | "properties"
  | "tenants"
  | "leases"
  | "rent"
  | "maintenance"
  | "messages"
  | "vendors"
  | "settings";

const ITEMS: { id: AdminNavId; label: string; icon: typeof Home }[] = [
  { id: "dashboard", label: "Panel", icon: Home },
  { id: "properties", label: "Propiedades", icon: Building2 },
  { id: "tenants", label: "Inquilinos", icon: Users },
  { id: "leases", label: "Contratos", icon: ClipboardList },
  { id: "rent", label: "Rentas", icon: DollarSign },
  { id: "maintenance", label: "Mantenimiento", icon: Wrench },
  { id: "messages", label: "Correo", icon: Mail },
  { id: "vendors", label: "Proveedores", icon: Truck },
  { id: "settings", label: "Ajustes", icon: Settings },
];

const PATHS: Record<AdminNavId, string> = {
  dashboard: "/dashboard",
  properties: "/properties",
  tenants: "/tenants",
  leases: "/leases",
  rent: "/rent",
  maintenance: "/maintenance",
  messages: "/messages",
  vendors: "/vendors",
  settings: "/settings",
};

export function adminNavPath(id: AdminNavId): string {
  return PATHS[id];
}

export function AdminNav({
  active,
  organizationName,
  mailUnread = false,
  onNavigate,
  onSignOut,
}: {
  active: string;
  organizationName: string | null;
  mailUnread?: boolean;
  onNavigate: (id: AdminNavId) => void;
  onSignOut: () => void;
}) {
  return (
    <aside className="cn-nav portal-nav flex shrink-0 flex-col">
      <div className="portal-brand">
        <img src="/icon.svg" alt="" className="size-9" />
        <span className="text-sm font-semibold tracking-tight">RENT</span>
        {organizationName && (
          <p className="mt-1 w-full truncate text-center text-xs text-muted-foreground">{organizationName}</p>
        )}
      </div>
      <nav className="cn-nav-groups flex flex-1 flex-col gap-0.5 overflow-auto">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active;
          return (
            <div key={item.id} className="cn-nav-item" data-active={isActive || undefined}>
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 bg-transparent text-left"
                aria-current={isActive ? "page" : undefined}
                aria-label={item.id === "messages" && mailUnread ? "Correo, hay mensajes sin leer" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                <span className="cn-nav-label">{item.label}</span>
                {item.id === "messages" && mailUnread && (
                  <span className="ml-auto size-2 shrink-0 rounded-full bg-red-500" aria-hidden />
                )}
              </button>
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
