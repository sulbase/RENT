import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_VEHICLES_PER_UNIT } from "../../../shared/parking-charge";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell } from "@/components/page-shell";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import type { Lease, Tenant } from "@/types";
import { leaseHoldsUnit } from "../../../shared/lease-unit";
import { LeaseSigning } from "./lease-signature-panel";
import {
  LeaseFields,
  leaseCloseDescription,
  leaseCloseLabel,
  leaseCloseTitle,
  useLeaseForm,
} from "./lease-form";

export function LeaseEditPage({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const app = useApp();
  const back = "/leases";
  const [lease, setLease] = useState<Lease | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const form = useLeaseForm({ lease, resetKey: id });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<{ lease: Lease }>("GET", `/api/leases/${id}`)
      .then((data) => {
        if (!cancelled) setLease(data.lease);
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
    if (await form.save()) navigate(back);
  }

  async function remove() {
    try {
      await app.deleteLease(id);
      navigate(back);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Cargando contrato…</div>;
  }
  if (!lease) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Contrato no encontrado.</p>
        <Button variant="outline" onClick={() => navigate(back)}>
          Volver a contratos
        </Button>
      </div>
    );
  }

  const title = [lease.property_name, lease.unit_name].filter(Boolean).join(" · ") || "Contratos";
  const closable = leaseHoldsUnit(lease.status);
  const onTenantSaved = (saved: Tenant) => {
    form.setTenants((current) => current.map((item) => (item.id === saved.id ? { ...item, ...saved } : item)));
  };

  return (
    <PageShell
      title={
        <button
          type="button"
          onClick={() => navigate(back)}
          className="inline-flex items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          {title}
        </button>
      }
    >
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold">Editar contrato</h2>
        <Tabs defaultValue="info" className="mt-4">
          <TabsList>
            <TabsTrigger value="info">Información</TabsTrigger>
            <TabsTrigger value="contract">Contrato</TabsTrigger>
            <TabsTrigger value="inventory">Inventario</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-4 space-y-6">
            <LeaseFields form={form} />
            <LeaseVehicles leaseId={lease.id} hasTenant={Boolean(lease.primary_tenant_id)} />
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                type="button"
                className="rounded-full px-4"
                onClick={() => void submit()}
                disabled={form.saving || !form.ready}
              >
                Guardar cambios
              </Button>
              <Button type="button" variant="outline" className="rounded-full px-4" onClick={() => navigate(back)}>
                Cancelar
              </Button>
              {closable && (
                <Button
                  type="button"
                  variant="destructive"
                  className="ml-auto rounded-full px-4"
                  onClick={() => setConfirming(true)}
                >
                  {leaseCloseLabel(lease.status)}
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="contract" className="mt-4">
            <LeaseSigning lease={lease} tenants={form.tenants} onTenantSaved={onTenantSaved} />
          </TabsContent>

          <TabsContent value="inventory" className="mt-4">
            <DocumentsPanel entityType="lease" entityId={lease.id} variant="lease" />
          </TabsContent>
        </Tabs>
      </div>
      {closable && (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={leaseCloseTitle(lease.status)}
          description={leaseCloseDescription(lease.status)}
          confirmLabel={leaseCloseLabel(lease.status)}
          onConfirm={remove}
        />
      )}
    </PageShell>
  );
}

type LeaseVehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  color: string;
  vehicle_type: string;
  plate_state: string;
  license_number: string;
};

const VEHICLE_TYPES = ["Automóvil", "Motocicleta", "Camioneta", "SUV", "Otro"] as const;
const VEHICLE_YEAR_MIN = 1980;
const VEHICLE_YEAR_TOP = Math.min(new Date().getFullYear(), 2100);
const VEHICLE_YEARS = Array.from(
  { length: VEHICLE_YEAR_TOP - VEHICLE_YEAR_MIN + 1 },
  (_, i) => String(VEHICLE_YEAR_TOP - i),
);

function LeaseVehicles({ leaseId, hasTenant }: { leaseId: string; hasTenant: boolean }) {
  const app = useApp();
  const [vehicles, setVehicles] = useState<LeaseVehicle[]>([]);
  const [creating, setCreating] = useState(false);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [plateState, setPlateState] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LeaseVehicle | null>(null);

  function load() {
    return api<{ vehicles: LeaseVehicle[] }>("GET", `/api/leases/${leaseId}/vehicles`).then((data) => {
      setVehicles(data.vehicles);
    });
  }

  useEffect(() => {
    let cancelled = false;
    void api<{ vehicles: LeaseVehicle[] }>("GET", `/api/leases/${leaseId}/vehicles`)
      .then((data) => {
        if (!cancelled) setVehicles(data.vehicles);
      })
      .catch((err: Error) => app.setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [leaseId, app.setError]);

  function resetForm() {
    setMake("");
    setModel("");
    setYear("");
    setColor("");
    setVehicleType("");
    setPlateState("");
    setLicenseNumber("");
    setError(null);
    setCreating(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api("POST", `/api/leases/${leaseId}/vehicles`, {
        make: make.trim(),
        model: model.trim(),
        year: Number(year),
        color: color.trim(),
        vehicle_type: vehicleType,
        plate_state: plateState.trim(),
        license_number: licenseNumber.trim(),
      });
      await load();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el vehículo");
    } finally {
      setSaving(false);
    }
  }

  const full = vehicles.length >= MAX_VEHICLES_PER_UNIT;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Vehículos</h2>
        {!creating && (
          <Button type="button" className="rounded-full px-4" disabled={!hasTenant || full} onClick={() => setCreating(true)}>
            Agregar vehículo
          </Button>
        )}
      </div>
      {!hasTenant ? (
        <p className="text-sm text-muted-foreground">Asigna un inquilino al contrato para registrar vehículos.</p>
      ) : creating ? (
        <div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="staff-veh-make">Marca</Label>
              <Input id="staff-veh-make" value={make} maxLength={80} onChange={(e) => setMake(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="staff-veh-model">Modelo</Label>
              <Input id="staff-veh-model" value={model} maxLength={80} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="staff-veh-year">Año</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger id="staff-veh-year" aria-label="Año">
                  <SelectValue placeholder="Año" />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_YEARS.map((value) => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="staff-veh-color">Color</Label>
              <Input id="staff-veh-color" value={color} maxLength={40} onChange={(e) => setColor(e.target.value)} />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={vehicleType} onValueChange={setVehicleType}>
                <SelectTrigger aria-label="Tipo de vehículo">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="staff-veh-state">Estado</Label>
              <Input id="staff-veh-state" value={plateState} maxLength={40} onChange={(e) => setPlateState(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="staff-veh-plate">Placa</Label>
              <Input id="staff-veh-plate" value={licenseNumber} maxLength={20} onChange={(e) => setLicenseNumber(e.target.value)} />
            </div>
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              className="rounded-full px-4"
              disabled={saving || !year || !vehicleType || !plateState.trim() || !licenseNumber.trim()}
              onClick={() => void save()}
            >
              Guardar vehículo
            </Button>
            <Button type="button" variant="outline" className="rounded-full px-4" onClick={resetForm}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : vehicles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin vehículos. Este mes no se cobra estacionamiento.</p>
      ) : (
        <ul className="divide-y">
          {vehicles.map((vehicle) => (
            <li key={vehicle.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {[vehicle.vehicle_type, vehicle.color, vehicle.plate_state, vehicle.license_number]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(vehicle)}>
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDelete
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="¿Quitar este vehículo?"
        description="Deja de cobrarse a partir del próximo mes que generes. El cargo de este mes, si ya existe, se conserva."
        confirmLabel="Quitar"
        onConfirm={() => {
          const vehicle = removing;
          setRemoving(null);
          if (!vehicle) return;
          void api("DELETE", `/api/leases/${leaseId}/vehicles/${vehicle.id}`)
            .then(() => load())
            .catch((err: Error) => setError(err.message));
        }}
      />
      {!creating && error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {hasTenant && !creating && full ? (
        <p className="mt-3 text-sm text-muted-foreground">Esta unidad ya tiene 3 vehículos.</p>
      ) : null}
    </Card>
  );
}
