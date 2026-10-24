import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { api } from "@/api";
import { formatDate, formatMoney, toIsoDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Payment, PaymentMethod, RentCharge } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  charge: RentCharge | null;
  onSaved?: () => void;
}

const VOID_REASONS = [
  { value: "duplicado", label: "Pago duplicado" },
  { value: "monto", label: "Monto incorrecto" },
  { value: "cargo", label: "Cargo equivocado" },
  { value: "no_recibido", label: "Pago no recibido" },
  { value: "error", label: "Error de registro" },
  { value: "otro", label: "Otro" },
] as const;

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH / bank transfer" },
  { value: "credit", label: "Credit card" },
  { value: "other", label: "Other" },
];

export function PaymentDialog({ open, onOpenChange, charge, onSaved }: Props) {
  const app = useApp();
  const [amount, setAmount] = useState("0");
  const [liveCharge, setLiveCharge] = useState<RentCharge | null>(charge);
  /** The payment awaiting a void reason — its id is the open state. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [voidKind, setVoidKind] = useState("");
  const [voidOther, setVoidOther] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [paidAt, setPaidAt] = useState(toIsoDate(new Date()));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<Payment[]>([]);

  useEffect(() => {
    if (!open || !charge) return;
    setLiveCharge(charge);
    const remaining = Math.max(0, (charge.amount ?? 0) - (charge.amount_paid ?? 0));
    setAmount(String(remaining));
    setMethod("ach");
    setPaidAt(toIsoDate(new Date()));
    setReference("");
    setNotes("");
    setConfirming(null);
    setVoidKind("");
    setVoidOther("");
    (async () => {
      try {
        const data = await api<{ payments: Payment[] }>("GET", `/api/rent-charges/${charge.id}/payments`);
        setHistory(data.payments);
      } catch {
        setHistory([]);
      }
    })();
    // Reload only when opening a charge. A parent refresh must not replace this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, charge?.id]);

  async function save() {
    if (!charge) return;
    const a = parseFloat(amount);
    if (!Number.isFinite(a) || a <= 0) return;
    setSaving(true);
    try {
      await app.recordPayment({
        charge_id: charge.id,
        amount: a,
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        paid_at: paidAt,
      });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function resolvedVoidReason(): string {
    if (voidKind === "otro") return voidOther.trim();
    return VOID_REASONS.find((item) => item.value === voidKind)?.label ?? "";
  }

  async function voidPayment(id: string, reason: string) {
    if (!reason) return;
    try {
      const data = await api<{ charge: RentCharge; payments: Payment[] }>(
        "POST",
        `/api/payments/${id}/void`,
        { reason },
      );
      setHistory(data.payments);
      setLiveCharge(data.charge);
      const nextRemaining = Math.max(0, (data.charge.amount ?? 0) - (data.charge.amount_paid ?? 0));
      setAmount(String(nextRemaining));
      onSaved?.();
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  const pending = history.find((p) => p.id === confirming) ?? null;
  const shown = liveCharge ?? charge;

  if (!shown) return null;
  const remaining = Math.max(0, (shown.amount ?? 0) - (shown.amount_paid ?? 0));
  const parsedAmount = parseFloat(amount);
  const amountTooHigh = Number.isFinite(parsedAmount) && parsedAmount > remaining + 0.001;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <div className="font-medium">
            {shown.property_name} · {shown.unit_name}
          </div>
          <div className="text-xs text-muted-foreground">
            {shown.tenant_first_name} {shown.tenant_last_name} · Due {formatDate(shown.due_date)} · {formatMoney(shown.amount, app.settings.currency)} charged
          </div>
          <div className="mt-1 text-xs">
            Paid so far: <span className="font-medium tabular-nums">{formatMoney(shown.amount_paid, app.settings.currency)}</span> ·
            Remaining: <span className="font-medium tabular-nums">{formatMoney(remaining, app.settings.currency)}</span>
          </div>
        </div>

        {remaining > 0 ? <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-amount">Amount</Label>
              <Input id="pay-amount" type="number" step="0.01" min="0.01" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} />
              {amountTooHigh ? (
                <p className="mt-1 text-xs text-destructive">El importe supera el saldo del cargo.</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="pay-date">Paid on</Label>
              <Input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pay-ref">Reference</Label>
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #, transaction ID" />
            </div>
          </div>
          <div>
            <Label htmlFor="pay-notes">Notes</Label>
            <Textarea id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div> : null}

        {history.length > 0 && (
          <div className="mt-2">
            <div className="section-label mb-1.5">Past payments</div>
            <ul className="divide-y divide-border overflow-hidden rounded-md shadow-edge">
              {history.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div>
                    <span className={`font-medium tabular-nums ${p.voided_at ? "text-muted-foreground line-through" : ""}`}>
                      {formatMoney(p.amount, app.settings.currency)}
                    </span>
                    <span className="text-muted-foreground"> · {formatDate(p.paid_at)} · {p.method}</span>
                    {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                    {p.voided_at && <span className="text-muted-foreground"> · Anulado: {p.void_reason}</span>}
                  </div>
                  {p.voided_at ? null : (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground transition-colors duration-150 hover:text-destructive"
                      onClick={() => {
                        setVoidKind("");
                        setVoidOther("");
                        setConfirming(p.id);
                      }}
                      aria-label={`Anular el pago de ${formatMoney(p.amount, app.settings.currency)} del ${formatDate(p.paid_at)}`}
                    >
                      Anular
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {remaining > 0 ? (
            <Button type="button" onClick={save} disabled={saving || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || amountTooHigh}>
              Record payment
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {pending ? (
        <AlertDialog open onOpenChange={(o) => { if (!o) setConfirming(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Anular el pago de {formatMoney(pending.amount, app.settings.currency)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Deja de contar para el saldo del cargo y permanece en el historial con el motivo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Motivo</Label>
                <Select value={voidKind || undefined} onValueChange={setVoidKind}>
                  <SelectTrigger aria-label="Motivo">
                    <SelectValue placeholder="Elige un motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {VOID_REASONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {voidKind === "otro" ? (
                <div>
                  <Label htmlFor="void-other">Describe el motivo</Label>
                  <Textarea
                    id="void-other"
                    value={voidOther}
                    onChange={(e) => setVoidOther(e.target.value)}
                    rows={2}
                    maxLength={200}
                  />
                </div>
              ) : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={!resolvedVoidReason()}
                onClick={() => {
                  const reason = resolvedVoidReason();
                  const id = pending.id;
                  setConfirming(null);
                  void voidPayment(id, reason);
                }}
              >
                Anular pago
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
