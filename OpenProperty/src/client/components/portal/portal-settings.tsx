import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePortal } from "./portal-context";

export function PortalSettingsPage() {
  const { home } = usePortal();
  const auth = useAuth();

  if (!home) return null;

  const { tenant } = home;
  const name = [tenant.first_name, tenant.last_name].filter(Boolean).join(" ");

  return (
    <PageShell title="Ajustes" meta={tenant.organization_name} width="max-w-5xl" notifications={false}>
      <Card className="p-5">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Tu cuenta</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="section-label">Nombre</dt>
            <dd className="mt-0.5 font-medium">{name || "—"}</dd>
          </div>
          <div>
            <dt className="section-label">Correo</dt>
            <dd className="mt-0.5 font-medium">{tenant.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="section-label">Teléfono</dt>
            <dd className="mt-0.5 font-medium">{tenant.phone ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <div className="md:hidden">
        <Button type="button" variant="outline" className="w-full" onClick={() => void auth.signOut()}>
          <LogOut className="size-4" aria-hidden />
          Cerrar sesión
        </Button>
      </div>
    </PageShell>
  );
}
