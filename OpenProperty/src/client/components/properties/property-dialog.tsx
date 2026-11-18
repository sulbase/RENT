import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Property } from "@/types";
import { PropertyFields, usePropertyForm } from "./property-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (p: Property) => void;
}

export function PropertyDialog({ open, onOpenChange, onSaved }: Props) {
  const { form, setForm, saving, save } = usePropertyForm(undefined, open);

  async function submit() {
    const saved = await save();
    if (!saved) return;
    onSaved?.(saved);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva propiedad</DialogTitle>
        </DialogHeader>
        <PropertyFields form={form} setForm={setForm} />
        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || !form.name.trim()}>
            Crear propiedad
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
