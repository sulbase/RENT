import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Tenant } from "@/types";
import {
  GOVERNMENT_ID_MAX,
  MARITAL_STATUSES,
  OCCUPANT_COUNT_MAX,
  type MaritalStatus,
} from "../../../shared/tenant-profile";

export type TenantFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string;
  employer: string;
  income: string;
  governmentId: string;
  marital: MaritalStatus | "";
  occupation: string;
  workAddress: string;
  previousAddress: string;
  occupants: string;
  emergency: string;
  notes: string;
};

function formFrom(tenant?: Tenant): TenantFormState {
  return {
    firstName: tenant?.first_name ?? "",
    lastName: tenant?.last_name ?? "",
    email: tenant?.email ?? "",
    phone: tenant?.phone ?? "",
    dob: tenant?.date_of_birth ?? "",
    employer: tenant?.employer ?? "",
    income: tenant?.monthly_income ? String(tenant.monthly_income) : "",
    governmentId: tenant?.government_id ?? "",
    marital: tenant?.marital_status ?? "",
    occupation: tenant?.occupation ?? "",
    workAddress: tenant?.work_address ?? "",
    previousAddress: tenant?.previous_address ?? "",
    occupants: tenant?.occupant_count != null ? String(tenant.occupant_count) : "",
    emergency: tenant?.emergency_contact ?? "",
    notes: tenant?.notes ?? "",
  };
}

export function useTenantForm(tenant: Tenant | undefined, resetKey: unknown) {
  const app = useApp();
  const [form, setForm] = useState<TenantFormState>(() => formFrom(tenant));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(formFrom(tenant));
  }, [tenant, resetKey]);

  const ready = form.firstName.trim() !== "" && form.lastName.trim() !== "";

  async function save(): Promise<Tenant | null> {
    if (!ready) return null;
    setSaving(true);
    try {
      const payload = {
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        date_of_birth: form.dob || null,
        employer: form.employer.trim() || null,
        monthly_income: form.income ? Number.parseFloat(form.income) : null,
        government_id: form.governmentId.trim() || null,
        marital_status: form.marital || null,
        occupation: form.occupation.trim() || null,
        work_address: form.workAddress.trim() || null,
        previous_address: form.previousAddress.trim() || null,
        occupant_count:
          form.occupants === ""
            ? null
            : Math.min(OCCUPANT_COUNT_MAX, Math.max(0, Number.parseInt(form.occupants, 10) || 0)),
        emergency_contact: form.emergency.trim() || null,
        notes: form.notes.trim() || null,
      };
      return tenant ? await app.updateTenant(tenant.id, payload) : await app.createTenant(payload);
    } catch (err) {
      app.setError((err as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  return { form, setForm, saving, ready, save };
}

export function TenantFields({
  form,
  setForm,
}: {
  form: TenantFormState;
  setForm: (update: (current: TenantFormState) => TenantFormState) => void;
}) {
  const set = <K extends keyof TenantFormState>(key: K, value: TenantFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-first">Nombre</Label>
          <Input id="t-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="t-last">Apellido</Label>
          <Input id="t-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-email">Correo</Label>
          <Input id="t-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="t-phone">Teléfono</Label>
          <Input id="t-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-dob">Fecha de nacimiento</Label>
          <Input id="t-dob" type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="t-emerg">Contacto de emergencia</Label>
          <Input
            id="t-emerg"
            value={form.emergency}
            onChange={(e) => set("emergency", e.target.value)}
            placeholder="Nombre · teléfono"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-emp">Empleador</Label>
          <Input id="t-emp" value={form.employer} onChange={(e) => set("employer", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="t-inc">Ingreso mensual</Label>
          <Input id="t-inc" type="number" value={form.income} onChange={(e) => set("income", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-id">Documento de identidad</Label>
          <Input
            id="t-id"
            value={form.governmentId}
            maxLength={GOVERNMENT_ID_MAX}
            onChange={(e) => set("governmentId", e.target.value.slice(0, GOVERNMENT_ID_MAX))}
          />
          <p className="mt-1 text-xs text-muted-foreground">Máximo {GOVERNMENT_ID_MAX} caracteres</p>
        </div>
        <div>
          <Label>Estado civil</Label>
          <Select value={form.marital || undefined} onValueChange={(value) => set("marital", value as MaritalStatus)}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar" />
            </SelectTrigger>
            <SelectContent>
              {MARITAL_STATUSES.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-occ">Ocupación</Label>
          <Input
            id="t-occ"
            value={form.occupation}
            maxLength={80}
            onChange={(e) => set("occupation", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="t-people">Número de ocupantes</Label>
          <Input
            id="t-people"
            type="number"
            min={0}
            max={OCCUPANT_COUNT_MAX}
            value={form.occupants}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                set("occupants", "");
                return;
              }
              const count = Number(raw);
              if (!Number.isFinite(count)) return;
              set("occupants", String(Math.min(OCCUPANT_COUNT_MAX, Math.max(0, Math.trunc(count)))));
            }}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="t-work">Dirección de trabajo</Label>
        <Input
          id="t-work"
          value={form.workAddress}
          maxLength={200}
          onChange={(e) => set("workAddress", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="t-prev">Dirección anterior</Label>
        <Input
          id="t-prev"
          value={form.previousAddress}
          maxLength={200}
          onChange={(e) => set("previousAddress", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="t-notes">Notas</Label>
        <Textarea id="t-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
      </div>
    </div>
  );
}
