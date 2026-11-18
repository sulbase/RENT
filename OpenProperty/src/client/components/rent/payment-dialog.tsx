import { useEffect, useRef, useState } from "react";
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
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { resolveVoidReason, VOID_REASONS } from "@/lib/void-reasons";
import type { Payment, PaymentMethod, RentCharge } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  charge: RentCharge | null;
  onSaved?: () => void;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "check", label: "Cheque" },
  { value: "ach", label: "Transferencia bancaria" },
  { value: "credit", label: "Tarjeta de crédito" },
  { value: "other", label: "Otro" },
];

function releasePagePointer() {
  window.setTimeout(() => {
    const openLayer = document.querySelector("[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']");
    if (!openLayer) document.body.style.pointerEvents = "";
  }, 50);
}

const METHOD_LABEL: Record<PaymentMethod, string> = Object.fromEntries(
  METHODS.map((m) => [m.value, m.label]),
) as Record<PaymentMethod, string>;

export function PaymentDialog({ open, onOpenChange, charge, onSaved }: Props) {
  const app = useApp();
  const [amount, setAmount] = useState("0");
  const [liveCharge, setLiveCharge] = useState<RentCharge | null>(charge);
  /** The payment awaiting a void reason — its id is the open state. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const ignoreDialogClose = useRef(false);
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
    if (!Number.isFinite(a) || a <= 0 || paidAt > toIsoDate(new Date())) return;
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
    return resolveVoidReason(voidKind, voidOther);
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
  const todayIso = toIsoDate(new Date());
  const paidAtFuture = paidAt > todayIso;

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && ignoreDialogClose.current) return;
        if (!next) setConfirming(null);
        onOpenChange(next);
        if (!next) releasePagePointer();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <div className="font-medium">
            {shown.property_name} · {shown.unit_name}
          </div>
          <div className="text-xs text-muted-foreground">
            {shown.tenant_first_name} {shown.tenant_last_name} · Vence {formatDate(shown.due_date)} ·{" "}
            {formatMoney(shown.amount, app.settings.currency)} del cargo
          </div>
          <div className="mt-1 text-xs">
            Pagado: <span className="font-medium tabular-nums">{formatMoney(shown.amount_paid, app.settings.currency)}</span> ·
            Saldo: <span className="font-medium tabular-nums">{formatMoney(remaining, app.settings.currency)}</span>
          </div>
        </div>

        {remaining > 0 ? <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-amount">Importe</Label>
              <MoneyInput
                id="pay-amount"
                value={amount}
                currency={app.settings.currency}
                onChange={setAmount}
              />
              {amountTooHigh ? (
                <p className="mt-1 text-xs text-destructive">El importe supera el saldo del cargo.</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="pay-date">Fecha de pago</Label>
              <Input
                id="pay-date"
                type="date"
                value={paidAt}
                max={todayIso}
                onChange={(e) => setPaidAt(e.target.value)}
              />
              {paidAtFuture ? (
                <p className="mt-1 text-xs text-destructive">La fecha no puede ser posterior a hoy.</p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Método</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pay-ref">Referencia</Label>
              <Input
                id="pay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="N.º de cheque, folio de transferencia"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="pay-notes">Notas</Label>
            <Textarea id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div> : null}

        {history.length > 0 && (
          <div className="mt-2">
            <div className="section-label mb-1.5">Pagos anteriores</div>
            <ul className="divide-y divide-border overflow-hidden rounded-md shadow-edge">
              {history.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div>
                    <span className={`font-medium tabular-nums ${p.voided_at ? "text-muted-foreground line-through" : ""}`}>
                      {formatMoney(p.amount, app.settings.currency)}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatDate(p.paid_at)} · {METHOD_LABEL[p.method] ?? p.method}
                    </span>
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
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cerrar</Button>
          {remaining > 0 ? (
            <Button
              type="button"
              onClick={save}
              disabled={saving || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || amountTooHigh || paidAtFuture}
            >
              Registrar pago
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {pending ? (
        <AlertDialog
          open
          onOpenChange={(o) => {
            if (o) return;
            ignoreDialogClose.current = true;
            setConfirming(null);
            window.setTimeout(() => {
              ignoreDialogClose.current = false;
              releasePagePointer();
            }, 0);
          }}
        >
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
                  ignoreDialogClose.current = true;
                  setConfirming(null);
                  window.setTimeout(() => {
                    ignoreDialogClose.current = false;
                  }, 0);
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
