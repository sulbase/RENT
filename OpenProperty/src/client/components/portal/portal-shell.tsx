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
import type { PortalHome } from "./portal-types";

type PortalRoute = "home" | "maintenance" | "mail";

const HOME_PATH = "/portal";

const ROUTE_PATH: Record<PortalRoute, string> = {
  home: HOME_PATH,
  maintenance: "/portal/mantenimiento",
  mail: "/portal/correo",
};

function parse(pathname: string): PortalRoute {
  const path = internalFromLocation(pathname);
  if (path === ROUTE_PATH.maintenance) return "maintenance";
  if (path === ROUTE_PATH.mail) return "mail";
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
          />
        </div>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span>
              {auth.portal?.display_name ?? "Inquilino"} · {auth.portal?.organization_name ?? ""}
            </span>
            <button type="button" className="underline" onClick={() => void auth.signOut()}>
              Cerrar sesión
            </button>
          </div>
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
            </>
          )}
        </main>
      </div>
    </PortalContext.Provider>
  );
}
