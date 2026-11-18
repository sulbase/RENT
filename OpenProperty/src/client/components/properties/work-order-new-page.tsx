import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import type { Property, Unit, WorkOrderPriority, WorkOrderStatus } from "@/types";

const PRIORITIES: { value: WorkOrderPriority; label: string }[] = [
  { value: "low", label: "Baja" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

const STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: "open", label: "Abierta" },
  { value: "assigned", label: "Asignada" },
  { value: "in_progress", label: "En curso" },
  { value: "completed", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
];

export function WorkOrderNewPage({ propertyId, navigate }: { propertyId: string; navigate: (to: string) => void }) {
  const app = useApp();
  const back = `/properties/${propertyId}`;
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedPropertyId, setSelectedPropertyId] = useState(propertyId);
  const [unitId, setUnitId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<WorkOrderPriority>("normal");
  const [status, setStatus] = useState<WorkOrderStatus>("open");
  const [scheduledAt, setScheduledAt] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([api<{ property: Property }>("GET", `/api/properties/${propertyId}`), app.listUnits()])
      .then(([data, all]) => {
        if (cancelled) return;
        setProperty(data.property);
        setUnits(all);
      })
      .catch((err: Error) => app.setError(err.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const filteredUnits = useMemo(
    () => (selectedPropertyId ? units.filter((u) => u.property_id === selectedPropertyId) : units),
    [units, selectedPropertyId],
  );

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await app.createWorkOrder({
        property_id: selectedPropertyId || null,
        unit_id: unitId || null,
        vendor_id: vendorId || null,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        status,
        scheduled_at: scheduledAt || null,
        cost: cost ? Number.parseFloat(cost) : null,
        notes: notes.trim() || null,
      });
      navigate(back);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando…</div>;
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
          onClick={() => navigate(back)}
          className="inline-flex items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          {property.name}
        </button>
      }
    >
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold">Nueva orden de trabajo</h2>
        <p className="mt-4 text-sm">Datos de la orden</p>
        <div className="mt-4 grid gap-4">
          <div>
            <Label htmlFor="wo-title">Título</Label>
            <Input
              id="wo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fuga en la llave de la cocina"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Propiedad</Label>
              <Select
                value={selectedPropertyId}
                onValueChange={(v) => {
                  setSelectedPropertyId(v);
                  setUnitId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {app.properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidad</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {filteredUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="wo-desc">Descripción</Label>
            <Textarea id="wo-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as WorkOrderPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as WorkOrderStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Proveedor</Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {app.vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wo-sched">Fecha programada</Label>
              <Input id="wo-sched" type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="wo-cost">Costo</Label>
              <Input id="wo-cost" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="wo-notes">Notas</Label>
            <Textarea id="wo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            className="rounded-full px-4"
            onClick={() => void save()}
            disabled={saving || !title.trim()}
          >
            Crear orden
          </Button>
          <Button type="button" variant="outline" className="rounded-full px-4" onClick={() => navigate(back)}>
            Cancelar
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
