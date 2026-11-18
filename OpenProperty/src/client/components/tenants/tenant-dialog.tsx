import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Tenant } from "@/types";
import { TenantFields, useTenantForm } from "./tenant-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant?: Tenant;
  onSaved?: (t: Tenant) => void;
}

export function TenantDialog({ open, onOpenChange, tenant, onSaved }: Props) {
  const { form, setForm, saving, ready, save } = useTenantForm(tenant, open);

  async function submit() {
    const saved = await save();
    if (!saved) return;
    onSaved?.(saved);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tenant ? "Editar inquilino" : "Nuevo inquilino"}</DialogTitle>
        </DialogHeader>
        <TenantFields form={form} setForm={setForm} />
        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || !ready}>
            {tenant ? "Guardar cambios" : "Crear inquilino"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
