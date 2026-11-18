import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { PageShell } from "@/components/page-shell";
import type { Property } from "@/types";
import { PropertyFields, usePropertyForm } from "./property-form";

export function PropertyEditPage({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const app = useApp();
  const [property, setProperty] = useState<Property | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const { form, setForm, saving, save } = usePropertyForm(property, id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<{ property: Property }>("GET", `/api/properties/${id}`)
      .then((data) => {
        if (!cancelled) setProperty(data.property);
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
    if (saved) navigate(`/properties/${id}`);
  }

  async function remove() {
    try {
      await app.deleteProperty(id);
      navigate("/properties");
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando propiedad…</div>
    );
  }
  if (!property) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Propiedad no encontrada.</p>
        <Button variant="outline" onClick={() => navigate("/properties")}>
          Volver a propiedades
        </Button>
      </div>
    );
  }

  return (
    <PageShell
      title={
        <button
          type="button"
          onClick={() => navigate(`/properties/${id}`)}
          className="inline-flex items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          {property.name}
        </button>
      }
    >
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold">Editar propiedad</h2>
        <p className="mt-4 text-sm">Datos de la propiedad</p>
        <div className="mt-4">
          <PropertyFields form={form} setForm={setForm} />
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            className="rounded-full px-4"
            onClick={() => void submit()}
            disabled={saving || !form.name.trim()}
          >
            Guardar cambios
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-full px-4"
            onClick={() => navigate(`/properties/${id}`)}
          >
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
      </div>
      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title={`¿Eliminar "${property.name}"?`}
        description="Se eliminan también sus unidades, contratos e historial de rentas. No se puede deshacer."
        onConfirm={remove}
      />
    </PageShell>
  );
}
