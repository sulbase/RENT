import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api";
import { useAuth } from "@/hooks/use-auth";
import { parseSettings } from "@/hooks/use-app-state";
import { internalFromLocation, toAppHref } from "../../../shared/public-site";
import { PortalContext, type PortalState } from "./portal-context";
import { PortalHomePage } from "./portal-home";
import { PortalMaintenancePage } from "./portal-maintenance";
import { PortalMailPage } from "./portal-mail";
import { PortalSettingsPage } from "./portal-settings";
import { PortalPaymentsPage } from "./portal-payments";
import { PortalDepartmentPage } from "./portal-department";
import { PortalNav, type PortalNavId } from "./portal-nav";
import type { PortalHome } from "./portal-types";

type PortalRoute = PortalNavId;

const HOME_PATH = "/portal";

const ROUTE_PATH: Record<PortalRoute, string> = {
  home: HOME_PATH,
  payments: "/portal/pagos",
  department: "/portal/departamento",
  maintenance: "/portal/mantenimiento",
  mail: "/portal/correo",
  settings: "/portal/ajustes",
};

function here(): string {
  return window.location.pathname + window.location.search;
}

function parse(href: string): PortalRoute {
  const path = internalFromLocation(href.split("?")[0] ?? href);
  if (path === ROUTE_PATH.payments) return "payments";
  if (path === ROUTE_PATH.department) return "department";
  if (path === ROUTE_PATH.maintenance) return "maintenance";
  if (path === ROUTE_PATH.mail) return "mail";
  if (path === ROUTE_PATH.settings) return "settings";
  return "home";
}

export function PortalShell() {
  const auth = useAuth();
  const [location, setLocation] = useState(here);
  const [home, setHome] = useState<PortalHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = parse(location);

  useEffect(() => {
    document.documentElement.classList.add("portal-theme");
    return () => document.documentElement.classList.remove("portal-theme");
  }, []);

  useEffect(() => {
    const internal = internalFromLocation(window.location.pathname);
    if (internal !== HOME_PATH && !internal.startsWith(`${HOME_PATH}/`)) {
      const href = toAppHref(HOME_PATH);
      window.history.replaceState(null, "", href);
      setLocation(href);
    }
    const handler = () => setLocation(here());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const navigate = useCallback((to: string) => {
    const href = toAppHref(to);
    if (href === here()) return;
    window.history.pushState(null, "", href);
    setLocation(href);
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await api<PortalHome>("GET", "/api/portal/home");
      setHome(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el portal");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<PortalState>(
    () => ({ home, settings: parseSettings(home?.settings ?? {}), location, reload, navigate }),
    [home, location, reload, navigate],
  );

  return (
    <PortalContext.Provider value={value}>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <PortalNav
          active={route}
          leases={home?.leases ?? []}
          onNavigate={(id) => navigate(ROUTE_PATH[id])}
          onSignOut={() => void auth.signOut()}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {error && !home ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <button type="button" className="text-sm underline" onClick={() => void reload()}>
                Reintentar
              </button>
            </div>
          ) : !home ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando…</div>
          ) : (
            <>
              {route === "home" && <PortalHomePage />}
              {route === "payments" && <PortalPaymentsPage />}
              {route === "department" && <PortalDepartmentPage />}
              {route === "maintenance" && <PortalMaintenancePage />}
              {route === "mail" && <PortalMailPage />}
              {route === "settings" && <PortalSettingsPage />}
            </>
          )}
        </main>
      </div>
    </PortalContext.Provider>
  );
}
