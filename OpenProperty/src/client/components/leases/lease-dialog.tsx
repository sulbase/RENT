import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeaseFields, useLeaseForm } from "./lease-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: { unit_id?: string; primary_tenant_id?: string };
  onSaved?: () => void;
}

export function LeaseDialog({ open, onOpenChange, defaults, onSaved }: Props) {
  const form = useLeaseForm({ defaults, resetKey: open });

  async function submit() {
    if (!(await form.save())) return;
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo contrato</DialogTitle>
        </DialogHeader>
        <LeaseFields form={form} />
        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={form.saving || !form.ready}>
            Crear contrato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
