import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { toIsoDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { LeaseSigning } from "@/components/leases/lease-signature-panel";
import { leaseStatusLabel } from "@/lib/labels";
import type { Lease, LeaseStatus, Tenant, Unit } from "@/types";
import { leaseHoldsUnit } from "../../../shared/lease-unit";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lease?: Lease;
  defaults?: { unit_id?: string; primary_tenant_id?: string };
  onSaved?: () => void;
}

function leaseCloseLabel(status: LeaseStatus): string {
  return status === "active" ? "Terminar" : "Eliminar";
}

function leaseCloseTitle(status: LeaseStatus): string {
  return status === "active" ? "¿Terminar este contrato?" : "¿Eliminar este contrato?";
}

function leaseCloseDescription(status: LeaseStatus): string {
  if (status === "active") {
    return "Pasa a terminado y la unidad queda libre. Se conservan fechas, cargos y pagos. Se borran fotos y PDF.";
  }
  return "Se elimina el contrato y sus archivos. Un borrador no tiene historial de pagos.";
}

const OPEN_STATUSES: LeaseStatus[] = ["upcoming", "active"];

export function LeaseDialog({ open, onOpenChange, lease, defaults, onSaved }: Props) {
  const app = useApp();
  const [units, setUnits] = useState<Unit[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState<string | "">("");
  const [tenantId, setTenantId] = useState<string | "">("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rent, setRent] = useState("0");
  const [deposit, setDeposit] = useState("0");
  const [dueDay, setDueDay] = useState("1");
  const [lateFee, setLateFee] = useState("0");
  const [status, setStatus] = useState<LeaseStatus>("upcoming");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [u, t, existing] = await Promise.all([
          app.listUnits(),
          app.listTenants(),
          app.listLeases(),
        ]);
        setUnits(u);
        setTenants(t);
        setLeases(existing);
      } catch (err) {
        app.setError((err as Error).message);
      }
    })();
  }, [open, app]);

  useEffect(() => {
    if (!open) return;
    setPropertyId("");
    setUnitId(lease?.unit_id ?? defaults?.unit_id ?? "");
    setTenantId(lease?.primary_tenant_id ?? defaults?.primary_tenant_id ?? "");
    const today = toIsoDate(new Date());
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() + 1);
    setStart(lease?.start_date ?? today);
    setEnd(lease?.end_date ?? toIsoDate(oneYear));
    setRent(String(lease?.monthly_rent ?? 0));
    setDeposit(String(lease?.deposit ?? 0));
    setDueDay(String(lease?.rent_due_day ?? app.settings.default_rent_due_day));
    setLateFee(String(lease?.late_fee ?? app.settings.late_fee_amount));
    setStatus(lease?.status ?? "upcoming");
    setNotes(lease?.notes ?? "");
  }, [open, lease, defaults, app.settings]);

  // When picking a unit we don't already have rent for, pre-fill from market_rent.
  const takenUnitIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of leases) {
      if (item.id === lease?.id) continue;
      if (leaseHoldsUnit(item.status)) ids.add(item.unit_id);
    }
    return ids;
  }, [leases, lease?.id]);
  const selectableUnits = useMemo(
    () => units.filter((unit) => !takenUnitIds.has(unit.id)),
    [units, takenUnitIds],
  );
  const properties = useMemo(() => {
    const names = new Map<string, string>();
    for (const unit of selectableUnits) {
      names.set(unit.property_id, unit.property_name ?? "—");
    }
    return [...names.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [selectableUnits]);
  const unitsInProperty = useMemo(
    () => selectableUnits.filter((unit) => unit.property_id === propertyId),
    [selectableUnits, propertyId],
  );

  useEffect(() => {
    if (!unitId) return;
    const unit = units.find((item) => item.id === unitId);
    if (unit) setPropertyId(unit.property_id);
  }, [unitId, units]);

  function pickProperty(nextPropertyId: string) {
    setPropertyId(nextPropertyId);
    const stillThere = selectableUnits.some(
      (unit) => unit.id === unitId && unit.property_id === nextPropertyId,
    );
    if (!stillThere) setUnitId("");
  }

  const selectedUnit = useMemo(() => units.find((u) => u.id === unitId), [units, unitId]);
  useEffect(() => {
    if (!lease && selectedUnit && parseFloat(rent) === 0) {
      setRent(String(selectedUnit.market_rent ?? 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit?.id]);

  async function save() {
    if (!unitId || !start || !end) return;
    setSaving(true);
    try {
      const payload = {
        unit_id: unitId,
        primary_tenant_id: tenantId || null,
        start_date: start,
        end_date: end,
        monthly_rent: parseFloat(rent) || 0,
        deposit: parseFloat(deposit) || 0,
        rent_due_day: Math.min(31, Math.max(1, parseInt(dueDay, 10) || 1)),
        late_fee: parseFloat(lateFee) || 0,
        status,
        notes: notes.trim() || null,
      };
      if (lease) {
        await app.updateLease(lease.id, payload);
      } else {
        // Auto-create tenant fallback would go here, but we require selecting an existing tenant.
        await app.createLease(payload);
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
    if (!lease) return;
    try {
      await app.deleteLease(lease.id);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lease ? "Editar contrato" : "Nuevo contrato"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Estado</Label>
            {lease && !leaseHoldsUnit(lease.status) ? (
              <p className="mt-2 text-sm font-medium">{leaseStatusLabel(lease.status)}</p>
            ) : (
              <Select value={status} onValueChange={(v) => setStatus(v as LeaseStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OPEN_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{leaseStatusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Propiedad</Label>
              <Select value={propertyId || undefined} onValueChange={pickProperty}>
                <SelectTrigger><SelectValue placeholder="Elige una propiedad" /></SelectTrigger>
                <SelectContent>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidad</Label>
              <Select
                value={String(unitId || "")}
                onValueChange={(v) => setUnitId(v || "")}
                disabled={!propertyId}
              >
                <SelectTrigger><SelectValue placeholder={propertyId ? "Elige una unidad" : "Primero elige una propiedad"} /></SelectTrigger>
                <SelectContent>
                  {unitsInProperty.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectableUnits.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Todas las unidades ya tienen contrato.</p>
              )}
            </div>
          </div>
          <div>
            <Label>Inquilino principal</Label>
              <Select value={String(tenantId || "")} onValueChange={(v) => setTenantId(v || "")}>
                <SelectTrigger><SelectValue placeholder="Elige un inquilino" /></SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.first_name} {t.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="l-start">Inicio</Label>
              <Input id="l-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="l-end">Fin</Label>
              <Input id="l-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="l-rent">Renta mensual</Label>
              <Input id="l-rent" type="number" value={rent} onChange={(e) => setRent(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="l-dep">Depósito</Label>
              <Input id="l-dep" type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="l-day">Día de pago</Label>
              <Input id="l-day" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="l-late">Recargo por mora</Label>
              <Input id="l-late" type="number" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="l-notes">Notas</Label>
            <Textarea id="l-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {lease && (
            <LeaseSigning
              lease={lease}
              tenants={tenants}
              onTenantSaved={(saved) => {
                setTenants((current) =>
                  current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)),
                );
              }}
            />
          )}
          {lease && (
            <DocumentsPanel entityType="lease" entityId={lease.id} variant="lease" hideEmptyState />
          )}
        </div>
        <DialogFooter className="mt-2">
          {lease && leaseHoldsUnit(lease.status) && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              {leaseCloseLabel(lease.status)}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={saving || !unitId || !start || !end}>
            {lease ? "Guardar cambios" : "Crear contrato"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <ConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title={lease && leaseHoldsUnit(lease.status) ? leaseCloseTitle(lease.status) : ""}
        description={lease && leaseHoldsUnit(lease.status) ? leaseCloseDescription(lease.status) : undefined}
        confirmLabel={lease && leaseHoldsUnit(lease.status) ? leaseCloseLabel(lease.status) : "Eliminar"}
        onConfirm={remove}
      />
    </>
  );
}
