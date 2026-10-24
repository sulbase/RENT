import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import { useApp } from "@/context";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

type PortalStatus =
  | { status: "active" }
  | { status: "pending"; email: string; expires_at: string }
  | { status: "none" }
  | { status: "no_email" };

const BADGE: Record<PortalStatus["status"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  active: { label: "Con acceso", variant: "default" },
  pending: { label: "Invitación pendiente", variant: "secondary" },
  none: { label: "Sin acceso", variant: "outline" },
  no_email: { label: "Sin correo", variant: "outline" },
};

export function TenantPortalAccess({ tenantId, email }: { tenantId: string; email: string | null }) {
  const { setError } = useApp();
  const auth = useAuth();
  const canManage = auth.devBypass || auth.role === "owner" || auth.role === "manager";
  const [state, setState] = useState<PortalStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<PortalStatus>("GET", `/api/tenants/${tenantId}/portal`));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [tenantId, setError]);

  useEffect(() => {
    void load();
  }, [load, email]);

  async function change(method: "POST" | "DELETE", path: string) {
    setBusy(true);
    try {
      await api(method, path);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const invite = () => change("POST", `/api/tenants/${tenantId}/portal-invite`);
  const revoke = () => change("DELETE", `/api/tenants/${tenantId}/portal`);

  if (!state) return null;
  const badge = BADGE[state.status];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Portal del inquilino</h2>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            {state.status === "active" &&
              "Ve su contrato, su estado de cuenta, el contrato firmado, sus solicitudes de mantenimiento y los correos que le envíes."}
            {state.status === "pending" &&
              `Invitado con ${state.email} hasta el ${formatDate(state.expires_at)}. RENT no envía correo: pídele que cree su cuenta en RENT con ese correo para entrar al portal.`}
            {state.status === "none" && `Invítalo con el correo de su ficha${email ? ` (${email})` : ""}.`}
            {state.status === "no_email" && "Agrega un correo en la ficha para invitarlo al portal."}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            {state.status === "none" && (
              <Button disabled={busy} onClick={() => void invite()}>
                Invitar al portal
              </Button>
            )}
            {state.status === "pending" && (
              <>
                <Button variant="ghost" disabled={busy} onClick={() => void revoke()}>
                  Cancelar invitación
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void invite()}>
                  Renovar
                </Button>
              </>
            )}
            {state.status === "active" && (
              <Button variant="outline" disabled={busy} onClick={() => void revoke()}>
                Quitar acceso
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
