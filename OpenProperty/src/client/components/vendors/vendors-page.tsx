import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useApp } from "@/context";
import { cn, colorClasses } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Vendor, VendorCategory } from "@/types";
import { PageShell } from "@/components/page-shell";

const COLORS = ["sky", "emerald", "amber", "rose", "violet", "fuchsia", "teal", "orange", "slate"];

const VENDOR_CATEGORIES: { value: VendorCategory; label: string }[] = [
  { value: "plumber", label: "Plomería" },
  { value: "electrician", label: "Electricidad" },
  { value: "hvac", label: "Climatización" },
  { value: "handyman", label: "Mantenimiento" },
  { value: "cleaning", label: "Limpieza" },
  { value: "landscaping", label: "Jardinería" },
  { value: "general", label: "General" },
];

function categoryLabel(value: string) {
  return VENDOR_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function VendorsPage() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | undefined>(undefined);

  function startCreate() {
    setEditing(undefined);
    setOpen(true);
  }

  return (
    <PageShell
      title="Proveedores"
      meta="Plomeros, electricistas y otros servicios"
      actions={
        app.vendors.length > 0 ? (
          <Button onClick={startCreate}>
            <Plus className="h-4 w-4" /> Nuevo proveedor
          </Button>
        ) : null
      }
    >
      {app.vendors.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <p className="font-medium">Todavía no hay proveedores</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Registra a quienes hacen el mantenimiento de las propiedades.
          </p>
          <Button className="mt-2" onClick={startCreate}>
            <Plus className="size-4" /> Nuevo proveedor
          </Button>
        </div>
      ) : (
        <Card>
          <ul className="divide-y">
            {app.vendors.map((v) => {
              const palette = colorClasses(v.color);
              return (
                <li key={v.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <span className={cn("h-2.5 w-2.5 rounded-full", palette.dot)} />
                    <div>
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[v.phone, v.email].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{categoryLabel(v.category)}</Badge>
                    <Button size="icon" variant="ghost" aria-label={`Editar ${v.name}`} onClick={() => { setEditing(v); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <VendorDialog open={open} onOpenChange={setOpen} vendor={editing} />
    </PageShell>
  );
}

function VendorDialog({
  open, onOpenChange, vendor,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendor?: Vendor;
}) {
  const app = useApp();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<VendorCategory>("general");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [color, setColor] = useState("slate");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(vendor?.name ?? "");
    setCategory(vendor?.category ?? "general");
    setPhone(vendor?.phone ?? "");
    setEmail(vendor?.email ?? "");
    setColor(vendor?.color ?? "slate");
    setNotes(vendor?.notes ?? "");
  }, [open, vendor]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        phone: phone.trim() || null,
        email: email.trim() || null,
        color,
        notes: notes.trim() || null,
      };
      if (vendor) await app.updateVendor(vendor.id, payload);
      else await app.createVendor(payload);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!vendor) return;
    try {
      await app.deleteVendor(vendor.id);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{vendor ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="v-name">Nombre</Label>
              <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoría</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as VendorCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VENDOR_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Color</Label>
                <Select value={color} onValueChange={setColor}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COLORS.map((c) => (
                      <SelectItem key={c} value={c}>
                        <span className="flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full bg-${c}-500`} />
                          <span className="capitalize">{c}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="v-phone">Teléfono</Label>
                <Input id="v-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="v-email">Correo</Label>
                <Input id="v-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="v-notes">Notas</Label>
              <Textarea id="v-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            {vendor && (
              <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Eliminar
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" onClick={save} disabled={saving || !name.trim()}>
              {vendor ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {vendor ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`¿Eliminar ${vendor.name}?`}
          description="Las órdenes de trabajo ya asignadas conservan el nombre."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}
