import { useEffect, useState } from "react";
import { CircleAlert, Plus, Wrench } from "lucide-react";
import { api } from "@/api";
import { PRIORITY_TONE, STATUS_VARIANT } from "@/components/maintenance/maintenance-page";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { priorityLabel, workStatusLabel } from "@/lib/labels";
import { cn, formatDate } from "@/lib/utils";
import { usePortal } from "./portal-context";
import type { PortalLease, PortalWorkOrder } from "./portal-types";

const PRIORITIES: PortalWorkOrder["priority"][] = ["low", "normal", "high", "urgent"];

function leaseLabel(lease: PortalLease): string {
  return [lease.property_name, lease.unit_name].filter(Boolean).join(" · ") || "Contrato";
}

export function PortalMaintenancePage() {
  const { home } = usePortal();
  const leases = home?.leases ?? [];
  const [orders, setOrders] = useState<PortalWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const data = await api<{ work_orders: PortalWorkOrder[] }>("GET", "/api/portal/work-orders");
      setOrders(data.work_orders);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar tus solicitudes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const open = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled").length;
  const canRequest = leases.length > 0;

  return (
    <PageShell
      title="Mantenimiento"
      meta={`${open} abiertas`}
      notifications={false}
      actions={
        canRequest && orders.length > 0 ? (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Nueva solicitud
          </Button>
        ) : null
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Cargando…</Card>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <Wrench className="size-7 text-faint" aria-hidden />
          <p className="font-medium">Sin solicitudes</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {canRequest
              ? "Avisa de una reparación en tu unidad y sigue su estado aquí."
              : "Necesitas un contrato vigente para pedir una reparación."}
          </p>
          {canRequest && (
            <Button className="mt-2" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Nueva solicitud
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {orders.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{w.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[w.property_name, w.unit_name].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize",
                    PRIORITY_TONE[w.priority],
                  )}
                >
                  {w.priority === "urgent" && <CircleAlert className="mr-1 h-3 w-3" />}
                  {priorityLabel(w.priority)}
                </span>
              </div>
              {w.description && (
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{w.description}</p>
              )}
              <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
                <Badge variant={STATUS_VARIANT[w.status] ?? "secondary"}>{workStatusLabel(w.status)}</Badge>
                <div className="text-right text-muted-foreground">
                  {w.scheduled_at ? `Programada ${formatDate(w.scheduled_at)}` : `Enviada ${formatDate(w.created_at)}`}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <RequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leases={leases}
        onCreated={() => void load()}
      />
    </PageShell>
  );
}

function RequestDialog({
  open,
  onOpenChange,
  leases,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leases: PortalLease[];
  onCreated: () => void;
}) {
  const [leaseId, setLeaseId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<PortalWorkOrder["priority"]>("normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeaseId(leases.length === 1 ? leases[0].id : "");
    setTitle("");
    setDescription("");
    setPriority("normal");
    setError(null);
  }, [open, leases]);

  async function save() {
    if (!leaseId || !title.trim()) return;
    setSaving(true);
    try {
      await api("POST", "/api/portal/work-orders", {
        lease_id: leaseId,
        title: title.trim(),
        description: description.trim() || null,
        priority,
      });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar la solicitud");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva solicitud</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Contrato</Label>
            <Select value={leaseId} onValueChange={setLeaseId}>
              <SelectTrigger aria-label="Contrato">
                <SelectValue placeholder="Elige la unidad" />
              </SelectTrigger>
              <SelectContent>
                {leases.map((lease) => (
                  <SelectItem key={lease.id} value={lease.id}>
                    {leaseLabel(lease)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="portal-wo-title">Qué pasa</Label>
            <Input
              id="portal-wo-title"
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Gotea la llave de la cocina"
            />
          </div>
          <div>
            <Label htmlFor="portal-wo-desc">Detalles</Label>
            <Textarea
              id="portal-wo-desc"
              value={description}
              maxLength={4000}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <div>
            <Label>Prioridad</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as PortalWorkOrder["priority"])}>
              <SelectTrigger aria-label="Prioridad">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {priorityLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !leaseId || !title.trim()}>
            Enviar solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
