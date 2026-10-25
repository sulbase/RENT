import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api, apiBlob } from "@/api";
import { useApp } from "@/context";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney, formatPeriod } from "@/lib/utils";

type PendingReceipt = {
  id: string;
  amount: number;
  paid_on: string;
  reference: string | null;
  note: string | null;
  created_at: string;
  period: string;
  charge_amount: number;
  amount_paid: number;
  tenant_first_name: string;
  tenant_last_name: string;
  unit_name: string | null;
  property_name: string | null;
  document_id: string | null;
  document_filename: string | null;
};

/** Receipts tenants sent from the portal. Approving records an ordinary payment. */
export function ReceiptReview({ onChanged }: { onChanged: () => void }) {
  const { setError, settings } = useApp();
  const auth = useAuth();
  const canReview = auth.devBypass || (auth.role !== null && auth.role !== "viewer");
  const [rows, setRows] = useState<PendingReceipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingReceipt | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ submissions: PendingReceipt[] }>("GET", "/api/payment-submissions?status=pending");
      setRows(data.submissions);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [setError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openFile(row: PendingReceipt) {
    if (!row.document_id) return;
    try {
      const blob = await apiBlob(`/api/documents/${row.document_id}`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function review(row: PendingReceipt, action: "approve" | "reject", body?: unknown) {
    setBusy(row.id);
    try {
      await api("POST", `/api/payment-submissions/${row.id}/${action}`, body);
      await load();
      onChanged();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) return null;
  const currency = settings.currency;

  return (
    <Card className="p-5">
      <h2 className="text-[1.0625rem] font-semibold leading-tight">Comprobantes por revisar</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enviados por inquilinos desde el portal. Al aprobar se registra el pago como transferencia.
      </p>
      <ul className="mt-3 divide-y">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3 last:pb-0">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">
                {row.tenant_first_name} {row.tenant_last_name} · {formatMoney(row.amount, currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="capitalize">Renta de {formatPeriod(row.period)}</span>
                {[row.property_name, row.unit_name].filter(Boolean).length > 0 &&
                  ` · ${[row.property_name, row.unit_name].filter(Boolean).join(" · ")}`}
                {` · saldo ${formatMoney(Math.max(0, row.charge_amount - row.amount_paid), currency)}`}
              </p>
              <p className="text-xs text-muted-foreground">
                Pagado el {formatDate(row.paid_on)}
                {row.reference ? ` · Ref. ${row.reference}` : ""} · Enviado {formatDate(row.created_at)}
              </p>
              {row.note && <p className="text-xs text-muted-foreground">“{row.note}”</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {row.document_id && (
                <Button variant="ghost" size="sm" onClick={() => void openFile(row)}>
                  <FileText className="h-4 w-4" /> Ver comprobante
                </Button>
              )}
              {canReview && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === row.id}
                    onClick={() => {
                      setReason("");
                      setRejecting(row);
                    }}
                  >
                    Rechazar
                  </Button>
                  <Button size="sm" disabled={busy === row.id} onClick={() => void review(row, "approve")}>
                    Aprobar
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar comprobante</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="reject-reason">Motivo (lo verá el inquilino)</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="No encontramos la transferencia con esa referencia"
            />
          </div>
          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || busy !== null}
              onClick={async () => {
                if (!rejecting) return;
                if (await review(rejecting, "reject", { reason: reason.trim() })) setRejecting(null);
              }}
            >
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
