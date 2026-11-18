import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context";
import { toIsoDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { leaseStatusLabel } from "@/lib/labels";
import type { Lease, LeaseStatus, Tenant, Unit } from "@/types";
import { leaseHoldsUnit } from "../../../shared/lease-unit";
import { clampRentDueDay } from "../../../shared/rent-due-day";
import { RentDueDaySelect } from "@/components/rent-due-day-select";

const OPEN_STATUSES: LeaseStatus[] = ["upcoming", "active"];

type GuaranteeMode = "amount" | "months";

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function leaseCloseLabel(status: LeaseStatus): string {
  return status === "active" ? "Terminar" : "Eliminar";
}

export function leaseCloseTitle(status: LeaseStatus): string {
  return status === "active" ? "¿Terminar este contrato?" : "¿Eliminar este contrato?";
}

export function leaseCloseDescription(status: LeaseStatus): string {
  if (status === "active") {
    return "Pasa a terminado y la unidad queda libre. Se conservan fechas, cargos y pagos. Se borran fotos y PDF.";
  }
  return "Se elimina el contrato y sus archivos. Un borrador no tiene historial de pagos.";
}

export function useLeaseForm({
  lease,
  defaults,
  resetKey,
}: {
  lease?: Lease;
  defaults?: { unit_id?: string; primary_tenant_id?: string };
  resetKey: unknown;
}) {
  const app = useApp();
  const [units, setUnits] = useState<Unit[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rent, setRent] = useState("0");
  const [deposit, setDeposit] = useState("0");
  const [guaranteeMode, setGuaranteeMode] = useState<GuaranteeMode>("amount");
  const [guaranteeMonths, setGuaranteeMonths] = useState("1");
  const [dueDay, setDueDay] = useState("1");
  const [lateFee, setLateFee] = useState("0");
  const [lateFeeOn, setLateFeeOn] = useState(false);
  const [graceDays, setGraceDays] = useState("5");
  const [vehicleFee, setVehicleFee] = useState("0");
  const [status, setStatus] = useState<LeaseStatus>("upcoming");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [u, t, existing] = await Promise.all([app.listUnits(), app.listTenants(), app.listLeases()]);
        setUnits(u);
        setTenants(t);
        setLeases(existing);
      } catch (err) {
        app.setError((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
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
    const months = lease?.metadata?.guarantee_months;
    setGuaranteeMode(months ? "months" : "amount");
    setGuaranteeMonths(String(months ?? 1));
    setDueDay(
      String(clampRentDueDay(lease?.rent_due_day ?? app.settings.default_rent_due_day)),
    );
    const fee = Number(lease?.late_fee ?? 0);
    setLateFeeOn(fee > 0);
    setLateFee(fee > 0 ? String(lease?.late_fee ?? 0) : "0");
    const grace = lease?.late_fee_grace_days;
    setGraceDays(grace && grace >= 1 && grace <= 5 ? String(grace) : "5");
    setVehicleFee(String(lease?.vehicle_monthly_fee ?? 0));
    setStatus(lease?.status ?? "upcoming");
    setNotes(lease?.notes ?? "");
  }, [resetKey, lease, defaults, app.settings]);

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

  const selectedUnit = useMemo(() => units.find((u) => u.id === unitId), [units, unitId]);
  useEffect(() => {
    if (!lease && selectedUnit && Number.parseFloat(rent) === 0) {
      setRent(String(selectedUnit.market_rent ?? 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit?.id]);

  function pickProperty(nextPropertyId: string) {
    setPropertyId(nextPropertyId);
    const stillThere = selectableUnits.some(
      (unit) => unit.id === unitId && unit.property_id === nextPropertyId,
    );
    if (!stillThere) setUnitId("");
  }

  const monthsCount = Math.min(24, Math.max(1, Number.parseInt(guaranteeMonths, 10) || 1));
  const guaranteeTotal =
    guaranteeMode === "months"
      ? Math.round(monthsCount * (Number.parseFloat(rent) || 0) * 100) / 100
      : Number.parseFloat(deposit) || 0;

  const ready = Boolean(unitId && start && end);

  async function save(): Promise<boolean> {
    if (!ready) return false;
    setSaving(true);
    try {
      const payload = {
        unit_id: unitId,
        primary_tenant_id: tenantId || null,
        start_date: start,
        end_date: end,
        monthly_rent: Number.parseFloat(rent) || 0,
        deposit: guaranteeTotal,
        guarantee_months: guaranteeMode === "months" ? monthsCount : null,
        rent_due_day: clampRentDueDay(Number.parseInt(dueDay, 10) || 1),
        late_fee: lateFeeOn ? Number.parseFloat(lateFee) || 0 : 0,
        late_fee_grace_days: lateFeeOn ? Number(graceDays) : null,
        vehicle_monthly_fee: Number.parseFloat(vehicleFee) || 0,
        status,
        notes: notes.trim() || null,
      };
      if (lease) {
        await app.updateLease(lease.id, payload);
      } else {
        await app.createLease(payload);
      }
      return true;
    } catch (err) {
      app.setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    lease,
    tenants,
    setTenants,
    properties,
    unitsInProperty,
    selectableUnits,
    propertyId,
    pickProperty,
    unitId,
    setUnitId,
    tenantId,
    setTenantId,
    start,
    setStart,
    end,
    setEnd,
    rent,
    setRent,
    deposit,
    setDeposit,
    guaranteeMode,
    setGuaranteeMode,
    guaranteeMonths,
    setGuaranteeMonths,
    guaranteeTotal,
    dueDay,
    setDueDay,
    lateFee,
    setLateFee,
    lateFeeOn,
    setLateFeeOn,
    graceDays,
    setGraceDays,
    vehicleFee,
    setVehicleFee,
    status,
    setStatus,
    notes,
    setNotes,
    saving,
    ready,
    save,
  };
}

export type LeaseFormApi = ReturnType<typeof useLeaseForm>;

export function LeaseFields({ form }: { form: LeaseFormApi }) {
  const { lease } = form;
  return (
    <div className="grid gap-4">
      <div>
        <Label>Estado</Label>
        {lease && !leaseHoldsUnit(lease.status) ? (
          <p className="mt-2 text-sm font-medium">{leaseStatusLabel(lease.status)}</p>
        ) : (
          <Select value={form.status} onValueChange={(v) => form.setStatus(v as LeaseStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPEN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {leaseStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Propiedad</Label>
          <Select value={form.propertyId || undefined} onValueChange={form.pickProperty}>
            <SelectTrigger>
              <SelectValue placeholder="Elige una propiedad" />
            </SelectTrigger>
            <SelectContent>
              {form.properties.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Unidad</Label>
          <Select value={form.unitId} onValueChange={(v) => form.setUnitId(v || "")} disabled={!form.propertyId}>
            <SelectTrigger>
              <SelectValue placeholder={form.propertyId ? "Elige una unidad" : "Primero elige una propiedad"} />
            </SelectTrigger>
            <SelectContent>
              {form.unitsInProperty.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.selectableUnits.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Todas las unidades ya tienen contrato.</p>
          )}
        </div>
      </div>
      <div>
        <Label>Inquilino principal</Label>
        <Select value={form.tenantId} onValueChange={(v) => form.setTenantId(v || "")}>
          <SelectTrigger>
            <SelectValue placeholder="Elige un inquilino" />
          </SelectTrigger>
          <SelectContent>
            {form.tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.first_name} {t.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="l-start">Inicio</Label>
          <Input id="l-start" type="date" value={form.start} onChange={(e) => form.setStart(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="l-end">Fin</Label>
          <Input id="l-end" type="date" value={form.end} onChange={(e) => form.setEnd(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="l-rent">Renta mensual</Label>
          <MoneyInput id="l-rent" value={form.rent} onChange={form.setRent} />
        </div>
        <div>
          <Label htmlFor="l-dep">Garantía</Label>
          <div className="flex gap-2">
            <Select value={form.guaranteeMode} onValueChange={(v) => form.setGuaranteeMode(v as GuaranteeMode)}>
              <SelectTrigger className="w-40 shrink-0" aria-label="Tipo de garantía">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="amount">Monto fijo</SelectItem>
                <SelectItem value="months">Meses de renta</SelectItem>
              </SelectContent>
            </Select>
            {form.guaranteeMode === "amount" ? (
              <MoneyInput id="l-dep" className="flex-1" value={form.deposit} onChange={form.setDeposit} />
            ) : (
              <Input
                id="l-dep"
                type="number"
                min={1}
                max={24}
                step={1}
                className="flex-1"
                value={form.guaranteeMonths}
                onChange={(e) => form.setGuaranteeMonths(e.target.value)}
              />
            )}
          </div>
          {form.guaranteeMode === "months" && (
            <p className="mt-1 text-xs text-muted-foreground">
              {DOLLARS.format(form.guaranteeTotal)} · se recalcula con la renta mensual
            </p>
          )}
        </div>
      </div>
      <RentDueDaySelect
        id="l-day"
        label="Día de pago"
        value={form.dueDay}
        onChange={form.setDueDay}
      />
      {form.lateFeeOn ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="l-late">Multa por retraso</Label>
            <MoneyInput id="l-late" value={form.lateFee} onChange={form.setLateFee} />
          </div>
          <div>
            <Label htmlFor="l-grace">Días de gracia</Label>
            <Select value={form.graceDays} onValueChange={form.setGraceDays}>
              <SelectTrigger id="l-grace" aria-label="Días de gracia">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1", "2", "3", "4", "5"].map((day) => (
                  <SelectItem key={day} value={day}>
                    {day} {day === "1" ? "día" : "días"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-2 text-sm"
              onClick={() => {
                form.setLateFeeOn(false);
                form.setLateFee("0");
              }}
            >
              Quitar multa
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="w-fit" onClick={() => form.setLateFeeOn(true)}>
          Agregar Multa por Retraso
        </Button>
      )}
      <div>
        <Label htmlFor="l-vehicle">Estacionamiento por vehículo / mes</Label>
        <MoneyInput id="l-vehicle" value={form.vehicleFee} onChange={form.setVehicleFee} />
        <p className="mt-1 text-xs text-muted-foreground">
          Al generar el mes se cobra este monto por cada vehículo de la unidad, hasta 3. Cero no genera cargo.
        </p>
      </div>
      <div>
        <Label htmlFor="l-notes">Notas</Label>
        <Textarea id="l-notes" value={form.notes} onChange={(e) => form.setNotes(e.target.value)} rows={3} />
      </div>
    </div>
  );
}
