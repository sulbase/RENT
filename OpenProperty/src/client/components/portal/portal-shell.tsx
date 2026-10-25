import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav, reportLocation, type AppNavItem } from "@clawnify/app/client";
import { api } from "@/api";
import { useAuth } from "@/hooks/use-auth";
import { parseSettings } from "@/hooks/use-app-state";
import { internalFromLocation, toAppHref } from "../../../shared/public-site";
import { PortalContext, type PortalState } from "./portal-context";
import { PortalHomePage } from "./portal-home";
import { PortalMaintenancePage } from "./portal-maintenance";
import { PortalMailPage } from "./portal-mail";
import { PortalSettingsPage } from "./portal-settings";
import { AppNavSignOut } from "@/components/app-nav-sign-out";
import type { PortalHome } from "./portal-types";

type PortalRoute = "home" | "maintenance" | "mail" | "settings";

const HOME_PATH = "/portal";

const ROUTE_PATH: Record<PortalRoute, string> = {
  home: HOME_PATH,
  maintenance: "/portal/mantenimiento",
  mail: "/portal/correo",
  settings: "/portal/ajustes",
};

function parse(pathname: string): PortalRoute {
  const path = internalFromLocation(pathname);
  if (path === ROUTE_PATH.maintenance) return "maintenance";
  if (path === ROUTE_PATH.mail) return "mail";
  if (path === ROUTE_PATH.settings) return "settings";
  return "home";
}

export function PortalShell() {
  const auth = useAuth();
  const [path, setPath] = useState(() => window.location.pathname);
  const [home, setHome] = useState<PortalHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = parse(path);

  useEffect(() => {
    const internal = internalFromLocation(window.location.pathname);
    if (internal !== HOME_PATH && !internal.startsWith(`${HOME_PATH}/`)) {
      const href = toAppHref(HOME_PATH);
      window.history.replaceState(null, "", href);
      setPath(href);
    }
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  useEffect(() => {
    reportLocation(path);
  }, [path]);

  const navigate = useCallback((to: string) => {
    const href = toAppHref(to);
    if (href === window.location.pathname) return;
    window.history.pushState(null, "", href);
    setPath(href);
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
    () => ({ home, settings: parseSettings(home?.settings ?? {}), reload }),
    [home, reload],
  );

  const groups: { label?: string; items: AppNavItem[] }[] = [
    {
      items: [
        { id: "home", label: "Inicio", href: toAppHref(ROUTE_PATH.home), home: true },
        {
          id: "maintenance",
          label: "Mantenimiento",
          href: toAppHref(ROUTE_PATH.maintenance),
          icon: "list-checks",
          color: "orange",
        },
        { id: "mail", label: "Correo", href: toAppHref(ROUTE_PATH.mail), icon: "mail", color: "blue" },
        { id: "settings", label: "Ajustes", href: toAppHref(ROUTE_PATH.settings), icon: "settings" },
      ],
    },
  ];

  return (
    <PortalContext.Provider value={value}>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <div className="flex shrink-0">
          <AppNav
            title="RENT"
            icon="home"
            groups={groups}
            active={route}
            onNavigate={(item) => navigate(item.href ?? ROUTE_PATH.home)}
          >
            <AppNavSignOut onSignOut={() => auth.signOut()} />
          </AppNav>
        </div>
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
