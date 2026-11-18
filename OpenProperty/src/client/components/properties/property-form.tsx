import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { propertyTypeLabel } from "@/lib/labels";
import { colorClasses } from "@/lib/utils";
import type { Property, PropertyType } from "@/types";

const TYPES: PropertyType[] = ["single_family", "multi_family", "condo", "townhouse", "commercial"];

const COLORS: { value: string; label: string }[] = [
  { value: "sky", label: "Celeste" },
  { value: "emerald", label: "Esmeralda" },
  { value: "amber", label: "Ámbar" },
  { value: "rose", label: "Rosa" },
  { value: "violet", label: "Violeta" },
  { value: "fuchsia", label: "Fucsia" },
  { value: "teal", label: "Verde azulado" },
  { value: "orange", label: "Naranja" },
  { value: "slate", label: "Pizarra" },
];

export type PropertyFormState = {
  name: string;
  type: PropertyType;
  address: string;
  city: string;
  state: string;
  zip: string;
  yearBuilt: string;
  color: string;
  notes: string;
};

export function emptyPropertyForm(property?: Property): PropertyFormState {
  return {
    name: property?.name ?? "",
    type: (property?.type as PropertyType) ?? "single_family",
    address: property?.address ?? "",
    city: property?.city ?? "",
    state: property?.state ?? "",
    zip: property?.zip ?? "",
    yearBuilt: property?.year_built ? String(property.year_built) : "",
    color: property?.color ?? "sky",
    notes: property?.notes ?? "",
  };
}

export function usePropertyForm(property: Property | undefined, resetKey: unknown) {
  const app = useApp();
  const [form, setForm] = useState<PropertyFormState>(() => emptyPropertyForm(property));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(emptyPropertyForm(property));
  }, [property, resetKey]);

  async function save(): Promise<Property | null> {
    if (!form.name.trim()) return null;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        year_built: form.yearBuilt ? Number.parseInt(form.yearBuilt, 10) : null,
        color: form.color,
        notes: form.notes.trim() || null,
      };
      return property
        ? await app.updateProperty(property.id, payload)
        : await app.createProperty(payload);
    } catch (err) {
      app.setError((err as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  return { form, setForm, saving, save };
}

export function PropertyFields({
  form,
  setForm,
}: {
  form: PropertyFormState;
  setForm: (update: (current: PropertyFormState) => PropertyFormState) => void;
}) {
  const set = <K extends keyof PropertyFormState>(key: K, value: PropertyFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid gap-4">
      <div>
        <Label htmlFor="prop-name">Nombre</Label>
        <Input
          id="prop-name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Edificio Central"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Tipo</Label>
          <Select value={form.type} onValueChange={(v) => set("type", v as PropertyType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {propertyTypeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Color</Label>
          <Select value={form.color} onValueChange={(v) => set("color", v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLORS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  <span className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${colorClasses(c.value).dot}`} />
                    <span>{c.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="prop-addr">Dirección</Label>
        <Input
          id="prop-addr"
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="Av. Principal 123"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="prop-city">Ciudad</Label>
          <Input id="prop-city" value={form.city} onChange={(e) => set("city", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="prop-state">Provincia</Label>
          <Input id="prop-state" value={form.state} onChange={(e) => set("state", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="prop-zip">Código postal</Label>
          <Input id="prop-zip" value={form.zip} onChange={(e) => set("zip", e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="prop-year">Año de construcción</Label>
        <Input
          id="prop-year"
          type="number"
          value={form.yearBuilt}
          onChange={(e) => set("yearBuilt", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="prop-notes">Notas</Label>
        <Textarea id="prop-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
      </div>
    </div>
  );
}
