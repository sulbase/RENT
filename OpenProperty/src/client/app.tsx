import { useCallback, useEffect, useState } from "react";
import { reportLocation } from "@clawnify/app/client";
import { useAppState } from "./hooks/use-app-state";
import { useRouter, type Route } from "./hooks/use-router";
import { AppContext } from "./context";
import { ErrorBanner } from "./components/error-banner";
import { DashboardPage } from "./components/dashboard/dashboard-page";
import { PropertiesList } from "./components/properties/properties-list";
import { PropertyPage } from "./components/properties/property-page";
import { PropertyEditPage } from "./components/properties/property-edit-page";
import { UnitEditPage } from "./components/properties/unit-edit-page";
import { WorkOrderNewPage } from "./components/properties/work-order-new-page";
import { TenantsList } from "./components/tenants/tenants-list";
import { TenantPage } from "./components/tenants/tenant-page";
import { TenantEditPage } from "./components/tenants/tenant-edit-page";
import { LeasesPage } from "./components/leases/leases-page";
import { LeaseEditPage } from "./components/leases/lease-edit-page";
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
import { PortalShell } from "./components/portal/portal-shell";
import { Button } from "./components/ui/button";
import { AdminNav, adminNavPath, type AdminNavId } from "./components/admin-nav";
import { api } from "./api";
import { resolveAuthScreen } from "./lib/auth-gate";

function activeFor(route: Route): string {
  if (
    route.name === "property" ||
    route.name === "property-edit" ||
    route.name === "unit-new" ||
    route.name === "unit-edit" ||
    route.name === "work-order-new"
  ) {
    return "properties";
  }
  if (route.name === "tenant" || route.name === "tenant-edit") return "tenants";
  if (route.name === "lease-edit") return "leases";
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
      portal: Boolean(auth.portal),
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
    if (screen === "portal") {
      return <PortalShell />;
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
  const [mailUnread, setMailUnread] = useState(false);
  const organizationName =
    auth.memberships.find((membership) => membership.organization_id === auth.organizationId)?.name ?? null;
  const onUnreadCount = useCallback((count: number) => setMailUnread(count > 0), []);

  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const data = await api<{ unread_count: number }>("GET", "/api/messages?box=inbox&limit=1");
        if (!stop) setMailUnread(data.unread_count > 0);
      } catch {
        /* the mailbox badge waits for the next check */
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 30_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("portal-theme");
    return () => document.documentElement.classList.remove("portal-theme");
  }, []);

  useEffect(() => {
    reportLocation(path);
  }, [path]);

  return (
    <AppContext.Provider value={state}>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <AdminNav
          active={activeFor(route)}
          organizationName={organizationName}
          mailUnread={mailUnread}
          onNavigate={(id: AdminNavId) => navigate(adminNavPath(id))}
          onSignOut={() => void auth.signOut()}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {state.loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Cargando…
            </div>
          ) : (
            <>
              {route.name === "dashboard" && <DashboardPage navigate={navigate} />}
              {route.name === "properties" && <PropertiesList navigate={navigate} />}
              {route.name === "property" && <PropertyPage id={route.id} navigate={navigate} />}
              {route.name === "property-edit" && <PropertyEditPage id={route.id} navigate={navigate} />}
              {route.name === "unit-new" && (
                <UnitEditPage key="new" propertyId={route.propertyId} navigate={navigate} />
              )}
              {route.name === "work-order-new" && (
                <WorkOrderNewPage propertyId={route.propertyId} navigate={navigate} />
              )}
              {route.name === "unit-edit" && (
                <UnitEditPage
                  key={route.unitId}
                  propertyId={route.propertyId}
                  unitId={route.unitId}
                  navigate={navigate}
                />
              )}
              {route.name === "tenants" && <TenantsList navigate={navigate} />}
              {route.name === "tenant" && <TenantPage id={route.id} navigate={navigate} />}
              {route.name === "tenant-edit" && <TenantEditPage id={route.id} navigate={navigate} />}
              {route.name === "leases" && <LeasesPage navigate={navigate} />}
              {route.name === "lease-edit" && <LeaseEditPage id={route.id} navigate={navigate} />}
              {route.name === "rent" && <RentPage />}
              {route.name === "maintenance" && <MaintenancePage />}
              {route.name === "messages" && <MessagesPage onUnreadCount={onUnreadCount} />}
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
