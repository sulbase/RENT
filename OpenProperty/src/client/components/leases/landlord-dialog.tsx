import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LandlordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const app = useApp();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [governmentId, setGovernmentId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(app.settings.landlord_first_name);
    setLastName(app.settings.landlord_last_name);
    setEmail(app.settings.landlord_email);
    setGovernmentId(app.settings.landlord_government_id);
  }, [open, app.settings]);

  async function save() {
    setSaving(true);
    try {
      await app.updateSettings({
        landlord_first_name: firstName.trim(),
        landlord_last_name: lastName.trim(),
        landlord_email: email.trim(),
        landlord_government_id: governmentId.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar arrendador</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Estos datos se usan en todos los contratos que envías a firma.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="ll-first">Nombre</Label>
            <Input id="ll-first" value={firstName} maxLength={80} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ll-last">Apellido</Label>
            <Input id="ll-last" value={lastName} maxLength={80} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ll-email">Correo</Label>
            <Input
              id="ll-email"
              type="email"
              value={email}
              maxLength={200}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ll-id">Documento de identidad</Label>
            <Input
              id="ll-id"
              value={governmentId}
              maxLength={18}
              onChange={(e) => setGovernmentId(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
