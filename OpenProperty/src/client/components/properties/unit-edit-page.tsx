import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { useAuth } from "@/hooks/use-auth";
import { displayToSqft, getFormatPrefs, sqftToDisplay } from "@/lib/format-prefs";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { PageShell } from "@/components/page-shell";
import { BUILTIN_UNIT_TYPES, isBuiltinUnitType } from "../../../shared/unit-types";
import { unitStatusLabel } from "@/lib/labels";
import type { Property, Unit, UnitStatus } from "@/types";

const CREATE_STATUSES: { value: UnitStatus; label: string }[] = [
  { value: "vacant", label: "Vacante" },
  { value: "unavailable", label: "No disponible" },
];

const EDIT_STATUSES: { value: UnitStatus; label: string }[] = [
  ...CREATE_STATUSES,
  { value: "turnover", label: "En preparación" },
];

export function UnitEditPage({
  propertyId,
  unitId,
  navigate,
}: {
  propertyId: string;
  unitId?: string;
  navigate: (to: string) => void;
}) {
  const app = useApp();
  const { role } = useAuth();
  const canEditKinds = role === "owner" || role === "manager" || role === "staff";
  const back = `/properties/${propertyId}`;

  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<Unit | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    void (async () => {
      try {
        const [{ property: p }, unitData, kinds] = await Promise.all([
          api<{ property: Property }>("GET", `/api/properties/${propertyId}`),
          unitId ? api<{ unit: Unit }>("GET", `/api/units/${unitId}`) : Promise.resolve(null),
          api<{ kinds: string[] }>("GET", "/api/units/type-kinds"),
        ]);
        if (cancelled) return;
        const u = unitData?.unit;
        if (unitId && (!u || u.property_id !== propertyId)) {
          setMissing(true);
          return;
        }
        setProperty(p);
        setUnit(u);
        setExtraKinds(kinds.kinds);
        setName(u?.name ?? "");
        setBedrooms(String(u?.bedrooms ?? 1));
        setBathrooms(String(u?.bathrooms ?? 1));
        setSqft(u?.sqft ? String(sqftToDisplay(u.sqft, getFormatPrefs().areaUnit)) : "");
        setMarketRent((u?.market_rent ?? 0).toFixed(2));
        setStatus(u?.status ?? "vacant");
        setFloor(u?.floor == null ? "" : String(u.floor));
        setUnitType(u?.unit_type ?? "departamento");
        setFurnished(u?.furnished ?? false);
        setAliquotPrice(String(u?.aliquot_price ?? 0));
        setNotes(u?.notes ?? "");
      } catch (err) {
        if (!cancelled) {
          app.setError((err as Error).message);
          setMissing(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, unitId, app.setError]);

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
        bedrooms: Number.parseFloat(bedrooms) || 0,
        bathrooms: Number.parseFloat(bathrooms) || 0,
        sqft: sqft ? displayToSqft(Number.parseFloat(sqft), getFormatPrefs().areaUnit) : null,
        market_rent: Number.parseFloat(marketRent) || 0,
        ...(heldByLease || status === "occupied" ? {} : { status }),
        floor: floorValue,
        unit_type: unitType,
        furnished,
        aliquot_price: Number.parseFloat(aliquotPrice) || 0,
        notes: notes.trim() || null,
      };
      if (unit) {
        await app.updateUnit(unit.id, payload);
      } else {
        await app.createUnit(payload);
      }
      navigate(back);
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

  async function remove() {
    if (!unit) return;
    try {
      await app.deleteUnit(unit.id);
      navigate(back);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando unidad…</div>;
  }
  if (missing || !property) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Unidad no encontrada.</p>
        <Button variant="outline" onClick={() => navigate(back)}>
          Volver a la propiedad
        </Button>
      </div>
    );
  }

  const typeOptions = [...extraKinds];
  if (!isBuiltinUnitType(unitType) && unitType && !typeOptions.includes(unitType)) {
    typeOptions.unshift(unitType);
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
        <h2 className="text-2xl font-semibold">{unit ? "Editar unidad" : "Nueva unidad"}</h2>
        <Tabs defaultValue="info" className="mt-4">
          <TabsList>
            <TabsTrigger value="info">Información</TabsTrigger>
            <TabsTrigger value="images">Imágenes</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-4">
            <div className="grid gap-4">
              <div>
                <Label htmlFor="unit-name">Nombre</Label>
                <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Unidad 1A" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="unit-beds">Habitaciones</Label>
                  <Input
                    id="unit-beds"
                    type="number"
                    step="0.5"
                    value={bedrooms}
                    onChange={(e) => setBedrooms(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="unit-baths">Baños</Label>
                  <Input
                    id="unit-baths"
                    type="number"
                    step="0.5"
                    value={bathrooms}
                    onChange={(e) => setBathrooms(e.target.value)}
                  />
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUILTIN_UNIT_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                    {typeOptions.map((label) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
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
                  <Label htmlFor="unit-rent">Renta de mercado</Label>
                  <MoneyInput
                    id="unit-rent"
                    value={marketRent}
                    currency={app.settings.currency}
                    onChange={setMarketRent}
                  />
                </div>
                <div>
                  <Label>Estado</Label>
                  {unit?.active_lease_id ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {unitStatusLabel("occupied")}. La define el contrato activo.
                    </p>
                  ) : (
                    <Select value={status} onValueChange={(v) => setStatus(v as UnitStatus)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {unit?.status === "occupied" && (
                          <SelectItem value="occupied" disabled>
                            {unitStatusLabel("occupied")}
                          </SelectItem>
                        )}
                        {(unit ? EDIT_STATUSES : CREATE_STATUSES).map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
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
                <Label htmlFor="unit-notes">Notas</Label>
                <Textarea id="unit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                type="button"
                className="rounded-full px-4"
                onClick={() => void save()}
                disabled={saving || !name.trim()}
              >
                {unit ? "Guardar cambios" : "Crear unidad"}
              </Button>
              <Button type="button" variant="outline" className="rounded-full px-4" onClick={() => navigate(back)}>
                Cancelar
              </Button>
              {unit && (
                <Button
                  type="button"
                  variant="destructive"
                  className="ml-auto rounded-full px-4"
                  onClick={() => setConfirming(true)}
                >
                  Eliminar
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="images" className="mt-4">
            {unit ? (
              <DocumentsPanel entityType="unit" entityId={unit.id} />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Crea la unidad para poder agregar imágenes.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
      {unit && (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`¿Eliminar la unidad "${unit.name}"?`}
          description="Se eliminan también sus contratos e historial de rentas. No se puede deshacer."
          onConfirm={remove}
        />
      )}
    </PageShell>
  );
}
