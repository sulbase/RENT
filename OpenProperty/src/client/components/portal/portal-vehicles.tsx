import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import { MAX_VEHICLES_PER_UNIT } from "../../../shared/parking-charge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PortalLease } from "./portal-types";

const VEHICLE_TYPES = ["Automóvil", "Motocicleta", "Camioneta", "SUV", "Otro"] as const;

const VEHICLE_YEAR_MIN = 1980;
const VEHICLE_YEAR_MAX = 2100;
const VEHICLE_YEAR_TOP = Math.min(new Date().getFullYear(), VEHICLE_YEAR_MAX);
const VEHICLE_YEARS = Array.from(
  { length: VEHICLE_YEAR_TOP - VEHICLE_YEAR_MIN + 1 },
  (_, i) => String(VEHICLE_YEAR_TOP - i),
);

type Vehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  vehicle_type: string;
  plate_state: string;
  license_number: string;
};

export function PortalVehiclesPage({
  lease,
  creating,
  onCreate,
  onDone,
}: {
  lease: PortalLease | null;
  creating: boolean;
  onCreate: () => void;
  onDone: () => void;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [plateState, setPlateState] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!lease) return;
    const data = await api<{ vehicles: Vehicle[] }>("GET", `/api/portal/vehicles?lease_id=${lease.id}`);
    setVehicles(data.vehicles);
  }, [lease]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los vehículos");
    });
  }, [load]);

  async function save() {
    if (!lease) return;
    setSaving(true);
    setError(null);
    try {
      await api("POST", "/api/portal/vehicles", {
        lease_id: lease.id,
        make: make.trim(),
        model: model.trim(),
        year: Number(year),
        color: color.trim(),
        vehicle_type: vehicleType,
        plate_state: plateState,
        license_number: licenseNumber.trim(),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el vehículo");
    } finally {
      setSaving(false);
    }
  }

  if (!lease) {
    return <p className="text-sm text-muted-foreground">Elige una unidad para ver sus vehículos.</p>;
  }

  if (creating) {
    const yearOk = year !== "";
    return (
      <div>
        <p className="text-sm text-muted-foreground">Proporcione los detalles de este vehículo.</p>
        <p className="mt-1 text-sm text-muted-foreground">Los campos marcados con * son obligatorios.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="veh-make">Marca</Label>
            <Input id="veh-make" value={make} maxLength={80} onChange={(e) => setMake(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="veh-model">Modelo</Label>
            <Input id="veh-model" value={model} maxLength={80} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="veh-year">Año *</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="veh-year" aria-label="Año">
                <SelectValue placeholder=" " />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_YEARS.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="veh-color">Color</Label>
            <Input id="veh-color" value={color} maxLength={40} onChange={(e) => setColor(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Tipo de vehículo *</Label>
            <Select value={vehicleType} onValueChange={setVehicleType}>
              <SelectTrigger aria-label="Tipo de vehículo">
                <SelectValue placeholder=" " />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <h2 className="mb-3 mt-6 text-[1.0625rem] font-semibold">Información de registro</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="veh-state">Estado *</Label>
            <Input id="veh-state" value={plateState} maxLength={40} onChange={(e) => setPlateState(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="veh-plate">Número de placa *</Label>
            <Input id="veh-plate" value={licenseNumber} maxLength={20} onChange={(e) => setLicenseNumber(e.target.value)} />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex gap-2">
          <Button
            type="button"
            className="rounded-full px-4"
            disabled={saving || !yearOk || !vehicleType || !plateState || !licenseNumber.trim()}
            onClick={() => void save()}
          >
            Guardar vehículo
          </Button>
          <Button type="button" variant="outline" className="rounded-full px-4" onClick={onDone}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Hasta {MAX_VEHICLES_PER_UNIT} vehículos por unidad.</p>
        <Button
          type="button"
          className="rounded-full px-4"
          disabled={vehicles.length >= MAX_VEHICLES_PER_UNIT}
          onClick={onCreate}
        >
          Agregar Vehículo
        </Button>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {vehicles.length === 0 ? (
        <p className="py-16 text-center text-sm italic text-muted-foreground">No se encontraron vehículos</p>
      ) : (
        <ul className="divide-y">
          {vehicles.map((vehicle) => (
            <li key={vehicle.id} className="py-3 text-sm">
              <p className="font-medium">
                {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
              </p>
              <p className="text-muted-foreground">
                {vehicle.vehicle_type} · {vehicle.color || "Sin color"} · {vehicle.plate_state} · {vehicle.license_number}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
