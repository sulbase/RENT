import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { TenantIdentification } from "./tenant-identification";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant?: Tenant;
  onSaved?: (t: Tenant) => void;
}

export function TenantDialog({ open, onOpenChange, tenant, onSaved }: Props) {
  const app = useApp();
  const [firstName, setFirstName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [employer, setEmployer] = useState("");
  const [income, setIncome] = useState("");
  const [governmentId, setGovernmentId] = useState("");
  const [marital, setMarital] = useState<MaritalStatus | "">("");
  const [occupation, setOccupation] = useState("");
  const [workAddress, setWorkAddress] = useState("");
  const [previousAddress, setPreviousAddress] = useState("");
  const [occupants, setOccupants] = useState("");
  const [emergency, setEmergency] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(tenant?.first_name ?? "");
    setLastName(tenant?.last_name ?? "");
    setEmail(tenant?.email ?? "");
    setPhone(tenant?.phone ?? "");
    setDob(tenant?.date_of_birth ?? "");
    setEmployer(tenant?.employer ?? "");
    setIncome(tenant?.monthly_income ? String(tenant.monthly_income) : "");
    setGovernmentId(tenant?.government_id ?? "");
    setMarital(tenant?.marital_status ?? "");
    setOccupation(tenant?.occupation ?? "");
    setWorkAddress(tenant?.work_address ?? "");
    setPreviousAddress(tenant?.previous_address ?? "");
    setOccupants(tenant?.occupant_count != null ? String(tenant.occupant_count) : "");
    setEmergency(tenant?.emergency_contact ?? "");
    setNotes(tenant?.notes ?? "");
  }, [open, tenant]);

  async function save() {
    if (!firstName.trim() || !lastName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        date_of_birth: dob || null,
        employer: employer.trim() || null,
        monthly_income: income ? parseFloat(income) : null,
        government_id: governmentId.trim() || null,
        marital_status: marital || null,
        occupation: occupation.trim() || null,
        work_address: workAddress.trim() || null,
        previous_address: previousAddress.trim() || null,
        occupant_count: occupants === "" ? null : Math.min(OCCUPANT_COUNT_MAX, Math.max(0, parseInt(occupants, 10) || 0)),
        emergency_contact: emergency.trim() || null,
        notes: notes.trim() || null,
      };
      const saved = tenant
        ? await app.updateTenant(tenant.id, payload)
        : await app.createTenant(payload);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!tenant) return;
    try {
      await app.deleteTenant(tenant.id);
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
          <DialogTitle>{tenant ? "Editar inquilino" : "Nuevo inquilino"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-first">Nombre</Label>
              <Input id="t-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-last">Apellido</Label>
              <Input id="t-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-email">Correo</Label>
              <Input id="t-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-phone">Teléfono</Label>
              <Input id="t-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-dob">Fecha de nacimiento</Label>
              <Input id="t-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-emerg">Contacto de emergencia</Label>
              <Input id="t-emerg" value={emergency} onChange={(e) => setEmergency(e.target.value)} placeholder="Nombre · teléfono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-emp">Empleador</Label>
              <Input id="t-emp" value={employer} onChange={(e) => setEmployer(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-inc">Ingreso mensual</Label>
              <Input id="t-inc" type="number" value={income} onChange={(e) => setIncome(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-id">Documento de identidad</Label>
              <Input
                id="t-id"
                value={governmentId}
                maxLength={GOVERNMENT_ID_MAX}
                onChange={(e) => setGovernmentId(e.target.value.slice(0, GOVERNMENT_ID_MAX))}
              />
              <p className="mt-1 text-xs text-muted-foreground">Máximo {GOVERNMENT_ID_MAX} caracteres</p>
            </div>
            <div>
              <Label>Estado civil</Label>
              <Select value={marital || undefined} onValueChange={(value) => setMarital(value as MaritalStatus)}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {MARITAL_STATUSES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-occ">Ocupación</Label>
              <Input id="t-occ" value={occupation} maxLength={80} onChange={(e) => setOccupation(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-people">Número de ocupantes</Label>
              <Input
                id="t-people"
                type="number"
                min={0}
                max={OCCUPANT_COUNT_MAX}
                value={occupants}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setOccupants("");
                    return;
                  }
                  const count = Number(raw);
                  if (!Number.isFinite(count)) return;
                  setOccupants(String(Math.min(OCCUPANT_COUNT_MAX, Math.max(0, Math.trunc(count)))));
                }}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="t-work">Dirección de trabajo</Label>
            <Input id="t-work" value={workAddress} maxLength={200} onChange={(e) => setWorkAddress(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="t-prev">Dirección anterior</Label>
            <Input id="t-prev" value={previousAddress} maxLength={200} onChange={(e) => setPreviousAddress(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="t-notes">Notas</Label>
            <Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {tenant && <TenantIdentification tenantId={tenant.id} />}
        </div>
        <DialogFooter className="mt-2">
          {tenant && (
            <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
              Eliminar
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={saving || !firstName.trim() || !lastName.trim()}>
            {tenant ? "Guardar cambios" : "Crear inquilino"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {tenant ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`¿Eliminar a ${tenant.first_name} ${tenant.last_name}?`}
          description="Se eliminan también sus contratos y el historial de renta. Esta acción no se puede deshacer."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
