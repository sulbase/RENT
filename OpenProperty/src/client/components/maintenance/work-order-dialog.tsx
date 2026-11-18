import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Unit, WorkOrder, WorkOrderPriority, WorkOrderStatus } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder?: WorkOrder;
  defaults?: { property_id?: string; unit_id?: string };
  onSaved?: () => void;
}

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

export function WorkOrderDialog({ open, onOpenChange, workOrder, defaults, onSaved }: Props) {
  const app = useApp();
  const [units, setUnits] = useState<Unit[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [propertyId, setPropertyId] = useState<string | "">("");
  const [unitId, setUnitId] = useState<string | "">("");
  const [vendorId, setVendorId] = useState<string | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<WorkOrderPriority>("normal");
  const [status, setStatus] = useState<WorkOrderStatus>("open");
  const [scheduledAt, setScheduledAt] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const all = await app.listUnits();
        setUnits(all);
      } catch (err) {
        app.setError((err as Error).message);
      }
    })();
  }, [open, app]);

  useEffect(() => {
    if (!open) return;
    setPropertyId(workOrder?.property_id ?? defaults?.property_id ?? "");
    setUnitId(workOrder?.unit_id ?? defaults?.unit_id ?? "");
    setVendorId(workOrder?.vendor_id ?? "");
    setTitle(workOrder?.title ?? "");
    setDescription(workOrder?.description ?? "");
    setPriority(workOrder?.priority ?? "normal");
    setStatus(workOrder?.status ?? "open");
    setScheduledAt(workOrder?.scheduled_at?.slice(0, 10) ?? "");
    setCost(workOrder?.cost != null ? String(workOrder.cost) : "");
    setNotes(workOrder?.notes ?? "");
  }, [open, workOrder, defaults]);

  const filteredUnits = useMemo(() => {
    if (!propertyId) return units;
    return units.filter((u) => u.property_id === propertyId);
  }, [units, propertyId]);

  // Auto-set property when picking a unit.
  useEffect(() => {
    if (!unitId) return;
    const u = units.find((x) => x.id === unitId);
    if (u && propertyId !== u.property_id) setPropertyId(u.property_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        property_id: propertyId || null,
        unit_id: unitId || null,
        vendor_id: vendorId || null,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        status,
        scheduled_at: scheduledAt || null,
        cost: cost ? parseFloat(cost) : null,
        notes: notes.trim() || null,
      };
      if (workOrder) {
        await app.updateWorkOrder(workOrder.id, payload);
      } else {
        await app.createWorkOrder(payload);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!workOrder) return;
    try {
      await app.deleteWorkOrder(workOrder.id);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{workOrder ? "Editar orden de trabajo" : "Nueva orden de trabajo"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label htmlFor="wo-title">Título</Label>
            <Input id="wo-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fuga en la llave de la cocina" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Propiedad</Label>
              <Select value={String(propertyId || "")} onValueChange={(v) => { setPropertyId(v || ""); setUnitId(""); }}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {app.properties.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidad</Label>
              <Select value={String(unitId || "")} onValueChange={(v) => setUnitId(v || "")}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {filteredUnits.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as WorkOrderStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Proveedor</Label>
              <Select value={String(vendorId || "")} onValueChange={(v) => setVendorId(v || "")}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {app.vendors.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
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
            <Textarea id="wo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter className="mt-2">
          {workOrder && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Eliminar
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={saving || !title.trim()}>
            {workOrder ? "Guardar cambios" : "Crear orden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Eliminar esta orden de trabajo?"
        description="Se eliminan también su historial y notas. No se puede deshacer."
        onConfirm={remove}
      />
    </>
  );
}
