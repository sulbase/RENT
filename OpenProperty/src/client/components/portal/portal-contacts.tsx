import { useCallback, useEffect, useMemo, useState } from "react";
import { Minus, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { api } from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const MAX_CONTACTS = 3;

const PHONE_CODES = ["+52", "+1", "+593"] as const;

const COUNTRIES = ["México", "Estados Unidos", "Ecuador", "Otro"] as const;

const MX_STATES = [
  "Aguascalientes",
  "Baja California",
  "Baja California Sur",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
];

const US_STATES = [
  "Alabama",
  "Alaska",
  "Arizona",
  "California",
  "Colorado",
  "Florida",
  "Georgia",
  "Illinois",
  "Massachusetts",
  "New York",
  "Texas",
  "Washington",
];

export type EmergencyContact = {
  id: string;
  first_name: string;
  last_name: string;
  phone_country: string;
  phone_number: string;
  relationship: string;
  email: string;
  company: string;
  has_access: boolean;
  age: number;
  country: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state_region: string;
  postal_code: string;
  notes: string;
};

type ContactPayload = Omit<EmergencyContact, "id">;

const EMPTY: ContactPayload = {
  first_name: "",
  last_name: "",
  phone_country: "+52",
  phone_number: "",
  relationship: "",
  email: "",
  company: "",
  has_access: false,
  age: 0,
  country: "México",
  address_line1: "",
  address_line2: "",
  city: "",
  state_region: "",
  postal_code: "",
  notes: "",
};

export function PortalContactsPage({
  creating,
  editContactId,
  onCreate,
  onEdit,
  onDone,
}: {
  creating: boolean;
  editContactId: string | null;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDone: () => void;
}) {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ contacts: EmergencyContact[] }>("GET", "/api/portal/emergency-contacts");
    setContacts(data.contacts);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los contactos");
    });
  }, [load]);

  const editing = useMemo(
    () => (editContactId ? contacts.find((row) => row.id === editContactId) ?? null : null),
    [contacts, editContactId],
  );

  async function remove(id: string) {
    setDeleting(true);
    setError(null);
    try {
      await api("DELETE", `/api/portal/emergency-contacts/${id}`);
      setDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el contacto");
    } finally {
      setDeleting(false);
    }
  }

  if (editContactId && contacts.length > 0 && !editing) {
    return <p className="text-sm text-destructive">No se encontró el contacto.</p>;
  }

  if (creating || editContactId) {
    if (editContactId && !editing) {
      return <p className="text-sm text-muted-foreground">Cargando…</p>;
    }
    return (
      <EmergencyContactForm
        contactId={editContactId}
        initial={editing ? contactToPayload(editing) : EMPTY}
        isEdit={Boolean(editContactId)}
        onCancel={onDone}
        onSaved={async () => {
          await load();
          onDone();
        }}
      />
    );
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">Información de contacto de emergencia</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Puedes registrar hasta {MAX_CONTACTS} contactos ({contacts.length}/{MAX_CONTACTS}).
        </p>
        <Button
          type="button"
          className="rounded-full px-4"
          disabled={contacts.length >= MAX_CONTACTS}
          onClick={onCreate}
        >
          Agregar contacto
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {contacts.length === 0 ? (
        <p className="py-10 text-center text-sm italic text-muted-foreground">No tiene contactos de emergencia.</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {initials(contact.first_name, contact.last_name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {[contact.first_name, contact.last_name].filter(Boolean).join(" ")}
                      </span>
                      <span className="block text-xs text-muted-foreground">{contact.relationship}</span>
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="ghost" size="icon" aria-label="Editar" onClick={() => onEdit(contact.id)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Eliminar"
                      onClick={() => setDeleteId(contact.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <p className="mt-3 flex items-center gap-2 text-sm">
                  <Phone className="size-4 text-muted-foreground" aria-hidden />
                  {contact.phone_country} {contact.phone_number}
                </p>
                {contact.email ? <p className="mt-1 text-sm text-muted-foreground">{contact.email}</p> : null}
                <span className="mt-3 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs">
                  {contact.has_access ? "Puede ingresar en emergencia" : "Sin acceso a la unidad"}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar contacto?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={() => deleteId && void remove(deleteId)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function contactToPayload(contact: EmergencyContact): ContactPayload {
  const { id: _id, ...rest } = contact;
  return rest;
}

function hasAdditionalInfo(form: ContactPayload): boolean {
  return (
    form.age > 0 ||
    form.address_line1.trim() !== "" ||
    form.address_line2.trim() !== "" ||
    form.city.trim() !== "" ||
    form.state_region.trim() !== "" ||
    form.postal_code.trim() !== "" ||
    form.notes.trim() !== "" ||
    (form.country !== "" && form.country !== "México")
  );
}

function EmergencyContactForm({
  contactId,
  initial,
  isEdit,
  onCancel,
  onSaved,
}: {
  contactId: string | null;
  initial: ContactPayload;
  isEdit: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<ContactPayload>(initial);
  const [additionalOpen, setAdditionalOpen] = useState(() => hasAdditionalInfo(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(initial);
    setAdditionalOpen(hasAdditionalInfo(initial));
  }, [initial]);

  const stateOptions = form.country === "Estados Unidos" ? US_STATES : form.country === "México" ? MX_STATES : [];

  const ready =
    form.first_name.trim() !== "" &&
    form.last_name.trim() !== "" &&
    form.phone_number.trim() !== "" &&
    form.relationship.trim() !== "";

  function setField<K extends keyof ContactPayload>(key: K, value: ContactPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...form,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone_number: form.phone_number.trim(),
        relationship: form.relationship.trim(),
        email: form.email.trim(),
        company: form.company.trim(),
        address_line1: form.address_line1.trim(),
        address_line2: form.address_line2.trim(),
        city: form.city.trim(),
        state_region: form.state_region.trim(),
        postal_code: form.postal_code.trim(),
        notes: form.notes.trim(),
      };
      if (contactId) {
        await api("PATCH", `/api/portal/emergency-contacts/${contactId}`, body);
      } else {
        await api("POST", "/api/portal/emergency-contacts", body);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el contacto");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-muted-foreground">Información de contacto de emergencia</p>
      <h3 className="mt-4 text-lg font-semibold">
        {isEdit ? "Editar contacto de emergencia" : "Agregar contacto de emergencia"}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Indique la información de contacto esencial para este contacto de emergencia.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">Los campos marcados con * son obligatorios.</p>

      <section className="mt-6">
        <h4 className="text-sm font-semibold">Información de contacto</h4>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="ec-first">Nombre *</Label>
            <Input
              id="ec-first"
              value={form.first_name}
              maxLength={40}
              onChange={(e) => setField("first_name", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ec-last">Apellido *</Label>
            <Input
              id="ec-last"
              value={form.last_name}
              maxLength={40}
              onChange={(e) => setField("last_name", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Número de teléfono *</Label>
            <div className="mt-1 flex gap-2">
              <Select value={form.phone_country} onValueChange={(value) => setField("phone_country", value)}>
                <SelectTrigger className="w-24 cursor-pointer" aria-label="Código de país">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHONE_CODES.map((code) => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id="ec-phone"
                className="flex-1"
                value={form.phone_number}
                maxLength={32}
                onChange={(e) => setField("phone_number", e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ec-rel">Relación *</Label>
            <Input
              id="ec-rel"
              value={form.relationship}
              maxLength={80}
              onChange={(e) => setField("relationship", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ec-email">Correo electrónico</Label>
            <Input
              id="ec-email"
              type="email"
              value={form.email}
              maxLength={120}
              onChange={(e) => setField("email", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="ec-company">Compañía</Label>
            <Input
              id="ec-company"
              value={form.company}
              maxLength={80}
              onChange={(e) => setField("company", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 rounded-md border border-sky-500/40 bg-sky-500/10 p-4">
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-sky-500"
              checked={form.has_access}
              onChange={(e) => setField("has_access", e.target.checked)}
            />
            <span>
              Esta persona tiene permiso para ingresar a mi unidad. La gestión de la propiedad puede permitir a esta
              persona acceder a su unidad en caso de emergencia.
            </span>
          </label>
        </div>
      </section>

      <section className="mt-8 border-t border-white/10 pt-8">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-2 text-sm font-semibold"
          aria-expanded={additionalOpen}
          onClick={() => setAdditionalOpen((open) => !open)}
        >
          {additionalOpen ? (
            <Minus className="size-4 shrink-0" aria-hidden />
          ) : (
            <Plus className="size-4 shrink-0" aria-hidden />
          )}
          Información adicional
        </button>
        {additionalOpen && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="ec-age">Edad</Label>
            <Input
              id="ec-age"
              type="number"
              min={0}
              max={130}
              value={form.age === 0 ? "" : String(form.age)}
              onChange={(e) => setField("age", e.target.value === "" ? 0 : Number(e.target.value))}
            />
          </div>
          <div>
            <Label>País</Label>
            <Select
              value={form.country || COUNTRIES[0]}
              onValueChange={(value) => {
                setField("country", value);
                setField("state_region", "");
              }}
            >
              <SelectTrigger className="cursor-pointer" aria-label="País">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((country) => (
                  <SelectItem key={country} value={country}>{country}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="ec-addr1">Línea de dirección 1</Label>
            <Input
              id="ec-addr1"
              value={form.address_line1}
              maxLength={120}
              onChange={(e) => setField("address_line1", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="ec-addr2">Línea de dirección 2</Label>
            <Input
              id="ec-addr2"
              value={form.address_line2}
              maxLength={120}
              onChange={(e) => setField("address_line2", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ec-city">Ciudad</Label>
            <Input id="ec-city" value={form.city} maxLength={80} onChange={(e) => setField("city", e.target.value)} />
          </div>
          <div>
            <Label>Estado</Label>
            {stateOptions.length > 0 ? (
              <Select value={form.state_region} onValueChange={(value) => setField("state_region", value)}>
                <SelectTrigger className="cursor-pointer" aria-label="Estado">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {stateOptions.map((state) => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={form.state_region}
                maxLength={80}
                onChange={(e) => setField("state_region", e.target.value)}
              />
            )}
          </div>
          <div>
            <Label htmlFor="ec-zip">Código postal</Label>
            <Input
              id="ec-zip"
              value={form.postal_code}
              maxLength={20}
              onChange={(e) => setField("postal_code", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="ec-notes">Avisos adicionales</Label>
            <Textarea
              id="ec-notes"
              rows={4}
              maxLength={2000}
              placeholder="Cualquier información adicional que podría ser útil en caso de emergencia..."
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </div>
        </div>
        )}
      </section>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="button"
          className="rounded-full bg-[#9eb3bc] px-8 font-semibold text-[#100f0e] hover:bg-[#8da5ae]"
          disabled={saving || !ready}
          onClick={() => void save()}
        >
          Guardar contacto
        </Button>
        <Button type="button" variant="outline" className="rounded-full px-8" disabled={saving} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function initials(first: string, last: string): string {
  return [first, last]
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
