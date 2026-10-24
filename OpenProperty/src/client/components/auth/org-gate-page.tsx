import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useAuth } from "../../hooks/use-auth";

export function OrgGatePage() {
  const { memberships, bootstrapOrganization, setActiveOrganization, signOut } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (memberships.length !== 1) return;
    void setActiveOrganization(memberships[0].organization_id);
  }, [memberships, setActiveOrganization]);

  if (memberships.length === 1) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Abriendo {memberships[0].name}…
      </div>
    );
  }

  if (memberships.length > 1) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8">
          <h1 className="text-xl font-semibold">Elige la organización</h1>
          <ul className="space-y-2">
            {memberships.map((m) => (
              <li key={m.organization_id}>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => void setActiveOrganization(m.organization_id)}
                >
                  {m.name}
                  <span className="ml-auto text-xs text-muted-foreground">{m.role}</span>
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => void signOut()}>Cerrar sesión</Button>
        </div>
      </div>
    );
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await bootstrapOrganization(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la organización");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Crea tu organización</h1>
          <p className="text-sm text-muted-foreground">
            Este espacio guardará tus propiedades, inquilinos y contratos.
          </p>
        </div>
        <form className="space-y-4" onSubmit={createOrg}>
          <div className="space-y-2">
            <Label htmlFor="org-name">Nombre de la organización</Label>
            <Input
              id="org-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Property Management"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
            {busy ? "Creando…" : "Continuar"}
          </Button>
        </form>
        <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
