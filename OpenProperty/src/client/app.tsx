import { useEffect } from "react";
import { AppNav, reportLocation, type AppNavItem } from "@clawnify/app/client";
import { useAppState } from "./hooks/use-app-state";
import { useRouter, type Route } from "./hooks/use-router";
import { AppContext } from "./context";
import { ErrorBanner } from "./components/error-banner";
import { DashboardPage } from "./components/dashboard/dashboard-page";
import { PropertiesList } from "./components/properties/properties-list";
import { PropertyPage } from "./components/properties/property-page";
import { TenantsList } from "./components/tenants/tenants-list";
import { TenantPage } from "./components/tenants/tenant-page";
import { LeasesPage } from "./components/leases/leases-page";
import { RentPage } from "./components/rent/rent-page";
import { MaintenancePage } from "./components/maintenance/maintenance-page";
import { MessagesPage } from "./components/messages/messages-page";
import { SettingsPage } from "./components/settings/settings-page";
import { VendorsPage } from "./components/vendors/vendors-page";
import { authConfigured } from "./lib/supabase";
import { AuthProvider, useAuth } from "./hooks/use-auth";
import { LoginPage } from "./components/auth/login-page";
import { NewPasswordPage } from "./components/auth/new-password-page";
import { OrgGatePage } from "./components/auth/org-gate-page";
import { Button } from "./components/ui/button";
import { toAppHref } from "../shared/public-site";
import { resolveAuthScreen } from "./lib/auth-gate";
import { roleLabel } from "./lib/labels";

const PORTFOLIO: AppNavItem[] = [
  { id: "dashboard", label: "Panel", href: toAppHref("/dashboard"), home: true },
  { id: "properties", label: "Propiedades", href: toAppHref("/properties"), icon: "building-2", color: "green" },
  { id: "tenants", label: "Inquilinos", href: toAppHref("/tenants"), icon: "users", color: "blue" },
  { id: "leases", label: "Contratos", href: toAppHref("/leases"), icon: "clipboard-list", color: "violet" },
];
const OPERATIONS: AppNavItem[] = [
  { id: "rent", label: "Rentas", href: toAppHref("/rent"), icon: "dollar-sign", color: "amber" },
  { id: "maintenance", label: "Mantenimiento", href: toAppHref("/maintenance"), icon: "list-checks", color: "orange" },
  { id: "messages", label: "Correo", href: toAppHref("/messages"), icon: "mail", color: "blue" },
];
const ADMIN: AppNavItem[] = [
  { id: "vendors", label: "Proveedores", href: toAppHref("/vendors"), icon: "truck", color: "sky" },
  { id: "settings", label: "Ajustes", href: toAppHref("/settings"), icon: "settings" },
];

function activeFor(route: Route): string {
  if (route.name === "property") return "properties";
  if (route.name === "tenant") return "tenants";
  return route.name;
}

const DOCUMENT_TITLE = "RENT";

export function App() {
  useEffect(() => {
    document.title = DOCUMENT_TITLE;
  }, []);

  return (
    <AuthProvider>
      <AppRoot />
    </AuthProvider>
  );
}

function AppRoot() {
  const auth = useAuth();

  if (authConfigured) {
    const screen = resolveAuthScreen({
      loading: auth.loading,
      profilePending: auth.profilePending,
      needsNewPassword: auth.needsNewPassword,
      session: Boolean(auth.session),
      devBypass: auth.devBypass,
      organizationId: auth.organizationId,
      profileError: auth.profileError,
    });
    if (screen === "loading") {
      return (
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          Cargando…
        </div>
      );
    }
    if (screen === "password") {
      return <NewPasswordPage />;
    }
    if (screen === "login") {
      return <LoginPage />;
    }
    if (screen === "profile-error" || screen === "org-gate") {
      if (screen === "profile-error") {
        return (
          <div className="flex min-h-screen items-center justify-center bg-background p-6">
            <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-8">
              <h1 className="text-xl font-semibold">No se pudo abrir tu organización</h1>
              <p className="text-sm text-muted-foreground">
                La cuenta sigue vinculada. Esto no es un alta nueva.
              </p>
              <p className="text-sm text-destructive">{auth.profileError}</p>
              <Button type="button" className="w-full" onClick={() => void auth.refreshProfile()}>
                Reintentar
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => void auth.signOut()}>
                Cerrar sesión
              </Button>
            </div>
          </div>
        );
      }
      return <OrgGatePage />;
    }
  }

  return <AuthenticatedShell />;
}

function AuthenticatedShell() {
  const state = useAppState();
  const { path, route, navigate } = useRouter();
  const auth = useAuth();

  useEffect(() => {
    reportLocation(path);
  }, [path]);

  const groups = [
    { items: PORTFOLIO },
    { label: "Operación", items: OPERATIONS },
    { label: "Administración", items: ADMIN },
  ];

  return (
    <AppContext.Provider value={state}>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <div className="flex shrink-0">
          <AppNav
            title="RENT"
            icon="home"
            groups={groups}
            active={activeFor(route)}
            onNavigate={(item) => navigate(item.href ?? "/dashboard")}
          />
        </div>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {auth.session && auth.organizationId && (
            <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <span>{roleLabel(auth.role ?? "")}</span>
              <button type="button" className="underline" onClick={() => void auth.signOut()}>
                Cerrar sesión
              </button>
            </div>
          )}
          {state.loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Cargando…
            </div>
          ) : (
            <>
              {route.name === "dashboard" && <DashboardPage navigate={navigate} />}
              {route.name === "properties" && <PropertiesList navigate={navigate} />}
              {route.name === "property" && <PropertyPage id={route.id} navigate={navigate} />}
              {route.name === "tenants" && <TenantsList navigate={navigate} />}
              {route.name === "tenant" && <TenantPage id={route.id} navigate={navigate} />}
              {route.name === "leases" && <LeasesPage navigate={navigate} />}
              {route.name === "rent" && <RentPage />}
              {route.name === "maintenance" && <MaintenancePage />}
              {route.name === "messages" && <MessagesPage />}
              {route.name === "vendors" && <VendorsPage />}
              {route.name === "settings" && <SettingsPage />}
              {route.name === "not-found" && (
                <Placeholder title="No encontrada" message="Esa página no existe." />
              )}
            </>
          )}
        </main>
        <ErrorBanner />
      </div>
    </AppContext.Provider>
  );
}

function Placeholder({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
