import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell } from "@/components/page-shell";
import type { Tenant } from "@/types";
import { TenantFields, useTenantForm } from "./tenant-form";
import { TenantIdentification } from "./tenant-identification";

export function TenantEditPage({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const app = useApp();
  const back = `/tenants/${id}`;
  const [tenant, setTenant] = useState<Tenant | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const { form, setForm, saving, ready, save } = useTenantForm(tenant, id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<{ tenant: Tenant }>("GET", `/api/tenants/${id}`)
      .then((data) => {
        if (!cancelled) setTenant(data.tenant);
      })
      .catch((err: Error) => app.setError(err.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, app.setError]);

  async function submit() {
    const saved = await save();
    if (saved) navigate(back);
  }

  async function remove() {
    try {
      await app.deleteTenant(id);
      navigate("/tenants");
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando inquilino…</div>;
  }
  if (!tenant) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Inquilino no encontrado.</p>
        <Button variant="outline" onClick={() => navigate("/tenants")}>
          Volver a inquilinos
        </Button>
      </div>
    );
  }

  return (
    <PageShell
      title={
        <button
          type="button"
          onClick={() => navigate(back)}
          className="inline-flex items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          {tenant.first_name} {tenant.last_name}
        </button>
      }
    >
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold">Editar inquilino</h2>
        <Tabs defaultValue="info" className="mt-4">
          <TabsList>
            <TabsTrigger value="info">Información</TabsTrigger>
            <TabsTrigger value="identification">Identificación</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-4">
            <TenantFields form={form} setForm={setForm} />
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                type="button"
                className="rounded-full px-4"
                onClick={() => void submit()}
                disabled={saving || !ready}
              >
                Guardar cambios
              </Button>
              <Button type="button" variant="outline" className="rounded-full px-4" onClick={() => navigate(back)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="ml-auto rounded-full px-4"
                onClick={() => setConfirming(true)}
              >
                Eliminar
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="identification" className="mt-4">
            <TenantIdentification tenantId={tenant.id} />
          </TabsContent>
        </Tabs>
      </div>
      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title={`¿Eliminar a ${tenant.first_name} ${tenant.last_name}?`}
        description="Se eliminan también sus contratos y el historial de renta. Esta acción no se puede deshacer."
        onConfirm={remove}
      />
    </PageShell>
  );
}
