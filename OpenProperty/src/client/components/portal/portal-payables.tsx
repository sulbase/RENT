import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { api, apiForm } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { chargeStatusLabel } from "@/lib/labels";
import { formatDate, formatMoney, formatPeriod, toIsoDate } from "@/lib/utils";
import { ledgerPlace } from "../../../shared/tenant-ledger";
import { usePortal } from "./portal-context";
import type { PortalCharge, PortalReceipt } from "./portal-types";

const RECEIPT_STATUS: Record<PortalReceipt["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "En revisión", variant: "secondary" },
  approved: { label: "Aprobado", variant: "default" },
  rejected: { label: "Rechazado", variant: "destructive" },
};

function balanceOf(charge: PortalCharge): number {
  return Math.max(0, Math.round((charge.amount - (charge.amount_paid ?? 0)) * 100) / 100);
}

export function PortalPayables() {
  const { home, settings, reload } = usePortal();
  const currency = settings.currency;
  const [receipts, setReceipts] = useState<PortalReceipt[]>([]);
  const [target, setTarget] = useState<PortalCharge | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReceipts = useCallback(async () => {
    try {
      const data = await api<{ submissions: PortalReceipt[] }>("GET", "/api/portal/payment-submissions");
      setReceipts(data.submissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar tus comprobantes");
    }
  }, []);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  const payable = useMemo(
    () =>
      (home?.charges ?? [])
        .filter((charge) => charge.status !== "paid" && charge.status !== "waived" && balanceOf(charge) > 0)
        .sort((a, b) => (a.due_date < b.due_date ? -1 : 1)),
    [home],
  );
  const pendingByCharge = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of receipts) {
      if (row.status === "pending") map.set(row.charge_id, (map.get(row.charge_id) ?? 0) + row.amount);
    }
    return map;
  }, [receipts]);

  return (
    <>
      <Card className="p-5">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Por pagar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paga por transferencia o depósito y sube el comprobante. Tu administración lo revisa y lo aplica a tu
          saldo.
        </p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {payable.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No tienes cargos pendientes.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {payable.map((charge) => {
              const inReview = pendingByCharge.get(charge.id) ?? 0;
              return (
                <li key={charge.id} className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize">Renta de {formatPeriod(charge.period)}</p>
                    <p className="text-xs text-muted-foreground">
                      {[ledgerPlace(charge.property_name, charge.unit_name), `vence ${formatDate(charge.due_date)}`, chargeStatusLabel(charge.status)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {inReview > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {formatMoney(inReview, currency)} en revisión
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums">{formatMoney(balanceOf(charge), currency)}</span>
                    <Button variant="outline" onClick={() => setTarget(charge)}>
                      <Upload className="h-4 w-4" /> Subir comprobante
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {receipts.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 text-[1.0625rem] font-semibold leading-tight">Mis comprobantes</h2>
          <ul className="divide-y">
            {receipts.map((row) => {
              const status = RECEIPT_STATUS[row.status];
              return (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize">
                      Renta de {formatPeriod(row.period)} · {formatMoney(row.amount, currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pagado el {formatDate(row.paid_on)}
                      {row.reference ? ` · Ref. ${row.reference}` : ""} · Enviado {formatDate(row.created_at)}
                    </p>
                    {row.status === "rejected" && row.rejection_reason && (
                      <p className="mt-1 text-xs text-destructive">Motivo: {row.rejection_reason}</p>
                    )}
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ReceiptDialog
        charge={target}
        currency={currency}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        onSent={() => {
          void loadReceipts();
          void reload();
        }}
      />
    </>
  );
}

function ReceiptDialog({
  charge,
  currency,
  onOpenChange,
  onSent,
}: {
  charge: PortalCharge | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(toIsoDate(new Date()));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!charge) return;
    setAmount(String(balanceOf(charge)));
    setPaidOn(toIsoDate(new Date()));
    setReference("");
    setNote("");
    setFile(null);
    setError(null);
  }, [charge]);

  async function send() {
    if (!charge || !file) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("amount", amount);
      form.set("paid_on", paidOn);
      if (reference.trim()) form.set("reference", reference.trim());
      if (note.trim()) form.set("note", note.trim());
      form.set("file", file);
      await apiForm(`/api/portal/charges/${charge.id}/receipts`, form);
      onSent();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el comprobante");
    } finally {
      setSaving(false);
    }
  }

  const amountValue = Number(amount);
  const valid = Boolean(file) && Number.isFinite(amountValue) && amountValue > 0 && paidOn.length === 10;

  return (
    <Dialog open={charge !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subir comprobante</DialogTitle>
        </DialogHeader>
        {charge && (
          <p className="text-sm text-muted-foreground">
            <span className="capitalize">Renta de {formatPeriod(charge.period)}</span> · saldo{" "}
            {formatMoney(balanceOf(charge), currency)}
          </p>
        )}
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="receipt-amount">Monto pagado</Label>
              <Input
                id="receipt-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="receipt-date">Fecha del pago</Label>
              <Input id="receipt-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="receipt-reference">Número de referencia</Label>
            <Input
              id="receipt-reference"
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          <div>
            <Label htmlFor="receipt-file">Comprobante</Label>
            <Input
              id="receipt-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1 text-xs text-muted-foreground">Imagen o PDF, hasta 10 MB.</p>
          </div>
          <div>
            <Label htmlFor="receipt-note">Nota</Label>
            <Textarea
              id="receipt-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={saving || !valid} onClick={() => void send()}>
            Enviar comprobante
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
