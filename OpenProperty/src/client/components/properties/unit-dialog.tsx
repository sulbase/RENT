import { useEffect, useState } from "react";
import { api } from "@/api";
import { useApp } from "@/context";
import { useAuth } from "@/hooks/use-auth";
import { displayToSqft, getFormatPrefs, sqftToDisplay } from "@/lib/format-prefs";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { BUILTIN_UNIT_TYPES, isBuiltinUnitType } from "../../../shared/unit-types";
import { unitStatusLabel } from "@/lib/labels";
import type { Unit, UnitStatus } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unit?: Unit;
  onSaved?: () => void;
}

const CREATE_STATUSES: { value: UnitStatus; label: string }[] = [
  { value: "vacant", label: "Vacante" },
  { value: "unavailable", label: "No disponible" },
];

const EDIT_STATUSES: { value: UnitStatus; label: string }[] = [
  ...CREATE_STATUSES,
  { value: "turnover", label: "En preparación" },
];

export function UnitDialog({ open, onOpenChange, propertyId, unit, onSaved }: Props) {
  const app = useApp();
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [bedrooms, setBedrooms] = useState("1");
  const [bathrooms, setBathrooms] = useState("1");
  const [sqft, setSqft] = useState("");
  const [marketRent, setMarketRent] = useState("0");
  const [status, setStatus] = useState<UnitStatus>("vacant");
  const [floor, setFloor] = useState("");
  const [unitType, setUnitType] = useState("departamento");
  const [furnished, setFurnished] = useState(false);
  const [aliquotPrice, setAliquotPrice] = useState("0");
  const [extraKinds, setExtraKinds] = useState<string[]>([]);
  const [draftKind, setDraftKind] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { role } = useAuth();
  const canEditKinds = role === "owner" || role === "manager" || role === "staff";

  useEffect(() => {
    if (!open) return;
    setName(unit?.name ?? "");
    setBedrooms(String(unit?.bedrooms ?? 1));
    setBathrooms(String(unit?.bathrooms ?? 1));
    const areaUnit = getFormatPrefs().areaUnit;
    setSqft(unit?.sqft ? String(sqftToDisplay(unit.sqft, areaUnit)) : "");
    setMarketRent(String(unit?.market_rent ?? 0));
    setStatus(unit?.status ?? "vacant");
    setFloor(unit?.floor == null ? "" : String(unit.floor));
    setUnitType(unit?.unit_type ?? "departamento");
    setFurnished(unit?.furnished ?? false);
    setAliquotPrice(String(unit?.aliquot_price ?? 0));
    setDraftKind("");
    setNotes(unit?.notes ?? "");
  }, [open, unit]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api<{ kinds: string[] }>("GET", "/api/units/type-kinds")
      .then((data) => {
        if (!cancelled) setExtraKinds(data.kinds);
      })
      .catch((err: Error) => {
        if (!cancelled) app.setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, app.setError]);

  async function save() {
    if (!name.trim()) return;
    const floorValue = floor.trim() === "" ? null : Number.parseInt(floor, 10);
    if (floorValue !== null && Number.isNaN(floorValue)) {
      app.setError("El piso debe ser un número entero");
      return;
    }
    setSaving(true);
    try {
      const heldByLease = Boolean(unit?.active_lease_id);
      const payload = {
        property_id: propertyId,
        name: name.trim(),
        bedrooms: parseFloat(bedrooms) || 0,
        bathrooms: parseFloat(bathrooms) || 0,
        sqft: sqft ? displayToSqft(parseFloat(sqft), getFormatPrefs().areaUnit) : null,
        market_rent: parseFloat(marketRent) || 0,
        ...(heldByLease || status === "occupied" ? {} : { status }),
        floor: floorValue,
        unit_type: unitType,
        furnished,
        aliquot_price: parseFloat(aliquotPrice) || 0,
        notes: notes.trim() || null,
      };
      if (unit) {
        await app.updateUnit(unit.id, payload);
      } else {
        await app.createUnit(payload);
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addKind() {
    const label = draftKind.trim().replace(/\s+/g, " ");
    if (!label) return;
    try {
      const data = await api<{ kinds: string[] }>("PUT", "/api/units/type-kinds", {
        kinds: [...extraKinds, label],
      });
      setExtraKinds(data.kinds);
      setUnitType(label);
      setDraftKind("");
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  async function removeKind(label: string) {
    try {
      const data = await api<{ kinds: string[] }>("PUT", "/api/units/type-kinds", {
        kinds: extraKinds.filter((item) => item !== label),
      });
      setExtraKinds(data.kinds);
      if (unitType === label) setUnitType("departamento");
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  const typeOptions = [...extraKinds];
  if (!isBuiltinUnitType(unitType) && unitType && !typeOptions.includes(unitType)) {
    typeOptions.unshift(unitType);
  }

  async function remove() {
    if (!unit) return;
    try {
      await app.deleteUnit(unit.id);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{unit ? "Edit unit" : "New unit"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="unit-name">Name</Label>
            <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Unit 1A" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="unit-beds">Bedrooms</Label>
              <Input id="unit-beds" type="number" step="0.5" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="unit-baths">Bathrooms</Label>
              <Input id="unit-baths" type="number" step="0.5" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="unit-sqft">{getFormatPrefs().areaUnit === "m2" ? "m²" : "ft²"}</Label>
              <Input id="unit-sqft" type="number" step="0.1" value={sqft} onChange={(e) => setSqft(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="unit-floor">Piso</Label>
              <Input
                id="unit-floor"
                type="number"
                step="1"
                min={-5}
                max={200}
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="3"
              />
            </div>
            <div>
              <Label htmlFor="unit-aliquot">Precio alícuota</Label>
              <Input
                id="unit-aliquot"
                type="number"
                min={0}
                value={aliquotPrice}
                onChange={(e) => setAliquotPrice(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Tipo de unidad</Label>
            <Select value={unitType} onValueChange={setUnitType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUILTIN_UNIT_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
                {typeOptions.map((label) => (
                  <SelectItem key={label} value={label}>{label}</SelectItem>
                ))}
                {canEditKinds && (
                  <div className="border-t p-2" onKeyDown={(event) => event.stopPropagation()}>
                    <div className="flex gap-1">
                      <Input
                        value={draftKind}
                        placeholder="Nueva opción"
                        maxLength={40}
                        onChange={(event) => setDraftKind(event.target.value)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void addKind();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => void addKind()}
                      >
                        Añadir
                      </Button>
                    </div>
                  </div>
                )}
              </SelectContent>
            </Select>
            {canEditKinds && !isBuiltinUnitType(unitType) && extraKinds.includes(unitType) && (
              <button
                type="button"
                className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => void removeKind(unitType)}
              >
                Quitar esta opción de la organización
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="unit-rent">Market rent</Label>
              <Input id="unit-rent" type="number" value={marketRent} onChange={(e) => setMarketRent(e.target.value)} />
            </div>
            <div>
              <Label>Estado</Label>
              {unit?.active_lease_id ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {unitStatusLabel("occupied")}. La define el contrato activo.
                </p>
              ) : (
                <Select value={status} onValueChange={(v) => setStatus(v as UnitStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {unit?.status === "occupied" && (
                      <SelectItem value="occupied" disabled>
                        {unitStatusLabel("occupied")}
                      </SelectItem>
                    )}
                    {(unit ? EDIT_STATUSES : CREATE_STATUSES).map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm" htmlFor="unit-furnished">
            <input
              id="unit-furnished"
              type="checkbox"
              className="size-4 accent-foreground"
              checked={furnished}
              onChange={(event) => setFurnished(event.target.checked)}
            />
            Amoblado
          </label>
          <div>
            <Label htmlFor="unit-notes">Notes</Label>
            <Textarea id="unit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {unit && (
            <div className="border-t pt-3">
              <DocumentsPanel entityType="unit" entityId={unit.id} hideEmptyState />
            </div>
          )}
        </div>
        <DialogFooter className="mt-2">
          {unit && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={saving || !name.trim()}>
            {unit ? "Guardar cambios" : "Crear unidad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {unit ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete unit "${unit.name}"?`}
          description="Its leases and rent history go with it. This cannot be undone."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
