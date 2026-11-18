import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api, apiBlob } from "@/api";
import { useApp } from "@/context";
import { useAuth } from "@/hooks/use-auth";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney, formatPeriod } from "@/lib/utils";
import { resolveVoidReason, VOID_REASONS } from "@/lib/void-reasons";

type PendingReceipt = {
  id: string;
  amount: number;
  paid_on: string;
  reference: string | null;
  payer_bank_name: string | null;
  receipt_number: string | null;
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
  fill_source?: "manual" | "automatic";
};

type ReceiptGroup = {
  key: string;
  rows: PendingReceipt[];
};

/** One uploaded file is one review, even when it covers several months. */
function groupReceipts(rows: PendingReceipt[]): ReceiptGroup[] {
  const groups: ReceiptGroup[] = [];
  for (const row of rows) {
    const key = row.document_id ?? row.id;
    const current = groups.find((group) => group.key === key);
    if (current) current.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups
    .map((group) => ({
      key: group.key,
      rows: [...group.rows].sort((a, b) => a.period.localeCompare(b.period) || a.created_at.localeCompare(b.created_at)),
    }))
    .sort(
      (a, b) =>
        a.rows[0].period.localeCompare(b.rows[0].period) || a.rows[0].created_at.localeCompare(b.rows[0].created_at),
    );
}

/** Receipts tenants sent from the portal. Approving records an ordinary payment. */
export function ReceiptReview({ onChanged }: { onChanged: () => void }) {
  const { setError, settings } = useApp();
  const auth = useAuth();
  const canReview = auth.devBypass || (auth.role !== null && auth.role !== "viewer");
  const [rows, setRows] = useState<PendingReceipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingReceipt | null>(null);
  const [rejectKind, setRejectKind] = useState("");
  const [rejectOther, setRejectOther] = useState("");

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
  const groups = groupReceipts(rows);

  return (
    <Card className="p-5">
      <h2 className="text-[1.0625rem] font-semibold leading-tight">Comprobantes por revisar</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enviados por inquilinos desde el portal. Al aprobar se registra el pago como transferencia.
      </p>
      <ul className="mt-3 divide-y">
        {groups.map((group) => {
          const row = group.rows[0];
          const total = group.rows.reduce((sum, item) => sum + Number(item.amount), 0);
          return (
          <li key={group.key} className="flex flex-wrap items-start justify-between gap-3 py-3 last:pb-0">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">
                {row.tenant_first_name} {row.tenant_last_name} · {formatMoney(total, currency)}
                <span
                  className={
                    row.fill_source === "automatic"
                      ? "ml-2 text-xs font-medium text-green-600"
                      : "ml-2 text-xs font-medium text-amber-600"
                  }
                >
                  {row.fill_source === "automatic" ? "Llenado automático" : "Llenado manual"}
                </span>
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {group.rows.map((item) => (
                  <li key={item.id}>
                    Renta de{" "}
                    <span className="font-medium capitalize text-destructive">{formatPeriod(item.period)}</span>
                    {` · ${formatMoney(item.amount, currency)}`}
                    {` · saldo ${formatMoney(Math.max(0, item.charge_amount - item.amount_paid), currency)}`}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {[row.property_name, row.unit_name].filter(Boolean).join(" · ")}
                {([row.property_name, row.unit_name].filter(Boolean).length > 0 ? " · " : "")}
                Pagado el {formatDate(row.paid_on)}
                {row.payer_bank_name ? ` · ${row.payer_bank_name}` : ""}
                {row.receipt_number ? ` · Comprobante ${row.receipt_number}` : ""}
                {row.reference ? ` · Ref. ${row.reference}` : ""}
                {` · Enviado ${formatDate(row.created_at)}`}
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
                      setRejectKind("");
                      setRejectOther("");
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
          );
        })}
      </ul>

      {rejecting ? (
        <AlertDialog open onOpenChange={(open) => { if (!open) setRejecting(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rechazar comprobante</AlertDialogTitle>
              <AlertDialogDescription>
                El inquilino verá el motivo en el portal. Se rechazarán todos los meses de este envío.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Motivo</Label>
                <Select value={rejectKind || undefined} onValueChange={setRejectKind}>
                  <SelectTrigger aria-label="Motivo">
                    <SelectValue placeholder="Elige un motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {VOID_REASONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {rejectKind === "otro" ? (
                <div>
                  <Label htmlFor="reject-other">Describe el motivo</Label>
                  <Textarea
                    id="reject-other"
                    value={rejectOther}
                    onChange={(e) => setRejectOther(e.target.value)}
                    rows={2}
                    maxLength={200}
                  />
                </div>
              ) : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={!resolveVoidReason(rejectKind, rejectOther) || busy !== null}
                onClick={async () => {
                  const reason = resolveVoidReason(rejectKind, rejectOther);
                  const row = rejecting;
                  setRejecting(null);
                  if (row && reason) await review(row, "reject", { reason });
                }}
              >
                Rechazar comprobante
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </Card>
  );
}
