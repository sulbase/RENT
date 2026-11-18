import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, Loader2, Upload, X } from "lucide-react";
import { api, apiBlob, apiForm } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
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
import { formatDate, formatMoney, formatPeriod, toIsoDate } from "@/lib/utils";
import { allocateOldestFirst } from "../../../shared/allocate-oldest";
import { chargeConcept } from "../../../shared/parking-charge";
import type { AppSettings } from "@/hooks/use-app-state";
import { buildTenantLedger } from "../../../shared/tenant-ledger";
import { PageShell } from "@/components/page-shell";
import { usePortal } from "./portal-context";
import { balanceOf } from "./portal-lease-balance";
import { PortalStatementSection } from "./portal-statement";
import { PortalUnitPicker } from "./portal-unit-picker";
import type { PortalCharge, PortalHome, PortalLease, PortalReceipt } from "./portal-types";

function leaseIdFromLocation(location: string): string | null {
  const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
  const id = new URLSearchParams(query).get("lease");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function isTransferPath(location: string): boolean {
  const path = location.split("?")[0] ?? location;
  return path.endsWith("/transferencia");
}

const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

function receiptSentFromLocation(location: string): boolean {
  const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get("enviado") === "1";
}

type PortalReceiptGroupStatus = "pending" | "approved" | "rejected" | "voided";

function receiptGroupStatus(rows: PortalReceipt[]): PortalReceiptGroupStatus {
  if (rows.some((row) => row.status === "pending")) return "pending";
  if (rows.every((row) => row.status === "rejected")) return "rejected";
  if (rows.some((row) => row.status === "approved" && row.payment_voided_at)) return "voided";
  if (rows.some((row) => row.status === "approved")) return "approved";
  return "rejected";
}

function groupReceipts(rows: PortalReceipt[]) {
  const groups: { key: string; rows: PortalReceipt[] }[] = [];
  for (const row of rows) {
    const key = row.document_id ?? row.id;
    const current = groups.find((group) => group.key === key);
    if (current) current.rows.push(row);
    else groups.push({ key, rows: [row] });
  }
  return groups.map((group) => {
    const ordered = [...group.rows].sort((a, b) => a.period.localeCompare(b.period));
    const head = ordered[0];
    return {
      key: group.key,
      rows: ordered,
      total: ordered.reduce((sum, row) => sum + Number(row.amount), 0),
      status: receiptGroupStatus(ordered),
      paidOn: head.paid_on,
      createdAt: head.created_at,
      reviewedAt: ordered.find((row) => row.reviewed_at)?.reviewed_at ?? null,
      receiptNumber: head.receipt_number,
      payerBankName: head.payer_bank_name,
      reference: head.reference,
      rejectionReason: ordered.find((row) => row.rejection_reason)?.rejection_reason ?? null,
      voidReason: ordered.find((row) => row.payment_void_reason)?.payment_void_reason ?? null,
      submissionId: head.id,
      documentId: head.document_id,
    };
  });
}

function PortalReceiptsList({ receipts, currency }: { receipts: PortalReceipt[]; currency: string }) {
  const [fileError, setFileError] = useState<string | null>(null);
  const groups = useMemo(() => groupReceipts(receipts), [receipts]);

  async function openFile(submissionId: string) {
    setFileError(null);
    try {
      const blob = await apiBlob(`/api/portal/payment-submissions/${submissionId}/document`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "No se pudo abrir el archivo");
    }
  }

  return (
    <Card className="mt-6 p-5">
      <h2 className="mb-3 text-[1.0625rem] font-semibold">Mis comprobantes</h2>
      {fileError ? <p className="mb-3 text-sm text-destructive">{fileError}</p> : null}
      <ul className="divide-y">
        {groups.map((group) => (
          <li key={group.key} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <p className="text-sm font-medium capitalize">
                  {group.rows.length === 1
                    ? `Renta de ${formatPeriod(group.rows[0].period)}`
                    : group.rows.map((row) => formatPeriod(row.period)).join(", ")}
                  {" · "}
                  {formatMoney(group.total, currency)}
                </p>
                <dl className="grid gap-0.5 text-xs text-muted-foreground sm:grid-cols-2 sm:gap-x-4">
                  <div>
                    <dt className="inline after:content-[':']">Fecha de pago</dt>{" "}
                    <dd className="inline text-foreground">{formatDate(group.paidOn)}</dd>
                  </div>
                  <div>
                    <dt className="inline after:content-[':']">Enviado</dt>{" "}
                    <dd className="inline text-foreground">{formatDate(group.createdAt)}</dd>
                  </div>
                  {group.receiptNumber ? (
                    <div>
                      <dt className="inline after:content-[':']">Comprobante</dt>{" "}
                      <dd className="inline text-foreground">n.º {group.receiptNumber}</dd>
                    </div>
                  ) : null}
                  {group.payerBankName ? (
                    <div>
                      <dt className="inline after:content-[':']">Banco</dt>{" "}
                      <dd className="inline text-foreground">{group.payerBankName}</dd>
                    </div>
                  ) : null}
                  {group.reference ? (
                    <div className="sm:col-span-2">
                      <dt className="inline after:content-[':']">Referencia</dt>{" "}
                      <dd className="inline text-foreground">{group.reference}</dd>
                    </div>
                  ) : null}
                  {group.reviewedAt ? (
                    <div>
                      <dt className="inline after:content-[':']">Revisado</dt>{" "}
                      <dd className="inline text-foreground">{formatDate(group.reviewedAt)}</dd>
                    </div>
                  ) : null}
                </dl>
                {group.status === "rejected" && group.rejectionReason ? (
                  <p className="text-xs text-destructive">Motivo: {group.rejectionReason}</p>
                ) : null}
                {group.status === "voided" && group.voidReason ? (
                  <p className="text-xs text-destructive">Anulación: {group.voidReason}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                <Badge
                  variant={
                    group.status === "rejected" || group.status === "voided"
                      ? "destructive"
                      : group.status === "approved"
                        ? "default"
                        : "secondary"
                  }
                >
                  {group.status === "pending"
                    ? "En revisión"
                    : group.status === "approved"
                      ? "Aprobado"
                      : group.status === "voided"
                        ? "Pago anulado"
                        : "Rechazado"}
                </Badge>
                {group.documentId ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => void openFile(group.submissionId)}>
                    <FileText className="h-4 w-4" aria-hidden /> Ver comprobante
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function openChargesForLease(charges: PortalCharge[], leaseId: string): PortalCharge[] {
  return charges
    .filter(
      (charge) =>
        charge.lease_id === leaseId &&
        charge.status !== "paid" &&
        charge.status !== "waived" &&
        balanceOf(charge) > 0,
    )
    .sort((a, b) => {
      if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
      if (a.period !== b.period) return a.period < b.period ? -1 : 1;
      return (a.kind === "parking" ? 1 : 0) - (b.kind === "parking" ? 1 : 0);
    });
}

export function PortalPaymentsPage() {
  const { home, settings, reload, navigate, location } = usePortal();
  const currency = settings.currency;
  const leaseId = useMemo(() => leaseIdFromLocation(location), [location]);
  const transferFlow = isTransferPath(location);
  const receiptJustSent = !transferFlow && receiptSentFromLocation(location);
  const [receipts, setReceipts] = useState<PortalReceipt[]>([]);
  const [statementLeaseId, setStatementLeaseId] = useState<string>("all");

  const loadReceipts = useCallback(async () => {
    try {
      const data = await api<{ submissions: PortalReceipt[] }>("GET", "/api/portal/payment-submissions");
      setReceipts(data.submissions);
    } catch (err) {
      // receipts are optional on this page
    }
  }, []);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  const lease = home?.leases.find((row) => row.id === leaseId) ?? null;
  const charges = useMemo(
    () => (lease ? openChargesForLease(home?.charges ?? [], lease.id) : []),
    [home, lease],
  );
  const ledger = useMemo(() => {
    if (!home) return [];
    const ledgerCharges =
      statementLeaseId === "all"
        ? home.charges
        : home.charges.filter((row) => row.lease_id === statementLeaseId);
    const payments =
      statementLeaseId === "all"
        ? home.payments
        : home.payments.filter((row) => row.lease_id === statementLeaseId);
    return buildTenantLedger({ charges: ledgerCharges, payments });
  }, [home, statementLeaseId]);

  const chargeLeaseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const charge of home?.charges ?? []) {
      map.set(charge.id, charge.lease_id);
    }
    return map;
  }, [home]);

  const receiptsForLease = useMemo(() => {
    if (!lease) return [];
    return receipts.filter((row) => chargeLeaseById.get(row.charge_id) === lease.id);
  }, [receipts, lease, chargeLeaseById]);

  useEffect(() => {
    if (!home || !transferFlow) return;
    if (!leaseId || !lease) {
      navigate("/portal/pagos");
    }
  }, [home, transferFlow, leaseId, lease, navigate]);

  if (!home) return null;

  const leaseQuery = lease ? `?lease=${lease.id}` : "";

  return (
    <PageShell title="Pagos" meta={lease?.unit_name ?? home.tenant.organization_name} width="max-w-5xl" notifications={false}>
      {!lease ? (
        <Card className="p-5">
          <PortalUnitPicker
            title="Elige la unidad"
            leases={home.leases}
            charges={home.charges}
            currency={currency}
            onSelect={(id) => navigate(`/portal/pagos?lease=${id}`)}
          />
        </Card>
      ) : transferFlow ? (
        <TransferPaymentPage
          lease={lease}
          charges={charges}
          currency={currency}
          settings={settings}
          onBack={() => navigate(`/portal/pagos${leaseQuery}`)}
          onSent={async () => {
            await loadReceipts();
            await reload();
            navigate(`/portal/pagos${leaseQuery}${leaseQuery ? "&" : "?"}enviado=1`);
          }}
        />
      ) : (
        <>
          {receiptJustSent && (
            <Card className="mb-4 border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
              <p className="font-medium text-emerald-700 dark:text-emerald-300">Comprobante enviado</p>
              <p className="mt-1 text-muted-foreground">
                Tu pago quedó en revisión. El equipo lo aprobará o rechazará; puedes ver el estado en Mis
                comprobantes.
              </p>
            </Card>
          )}
          <PayOverviewPage
            home={home}
            charges={charges}
            currency={currency}
            onChangeUnit={() => navigate("/portal/pagos")}
            onSelectTransfer={() => navigate(`/portal/pagos/transferencia${leaseQuery}`)}
          />
        </>
      )}

      {!lease && (
        <PortalStatementSection
          ledger={ledger}
          currency={currency}
          leases={home.leases}
          statementLeaseId={statementLeaseId}
          onStatementLeaseIdChange={setStatementLeaseId}
        />
      )}

      {!transferFlow && lease && receiptsForLease.length > 0 ? (
        <PortalReceiptsList receipts={receiptsForLease} currency={currency} />
      ) : null}
    </PageShell>
  );
}

function PayOverviewPage({
  home,
  charges,
  currency,
  onChangeUnit,
  onSelectTransfer,
}: {
  home: PortalHome;
  charges: PortalCharge[];
  currency: string;
  onChangeUnit: () => void;
  onSelectTransfer: () => void;
}) {
  const total = charges.reduce((sum, charge) => sum + balanceOf(charge), 0);

  return (
    <>
      {home.leases.length > 1 && (
        <Button type="button" variant="ghost" className="px-0" onClick={onChangeUnit}>
          Cambiar unidad
        </Button>
      )}
      <Card className="p-5">
        <h2 className="text-[1.0625rem] font-semibold">Método de pago</h2>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name="pay-method"
            className="size-4 cursor-pointer accent-foreground"
            onChange={onSelectTransfer}
          />
          Transferencia
        </label>
      </Card>

      <Card className="p-5">
        <h2 className="text-[1.0625rem] font-semibold">Revisar y pagar</h2>
        {charges.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No tienes cargos pendientes en esta unidad.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {charges.map((charge) => (
              <li key={charge.id} className="flex items-baseline justify-between gap-3">
                <span className="capitalize">
                  {chargeConcept(charge.kind)} de {formatPeriod(charge.period)}
                </span>
                <span className="tabular-nums">{formatMoney(balanceOf(charge), currency)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3 text-sm font-semibold">
          <span>Suma total</span>
          <span className="text-2xl tabular-nums">{formatMoney(total, currency)}</span>
        </div>
      </Card>
    </>
  );
}

function TransferPaymentPage({
  lease,
  charges,
  currency,
  settings,
  onBack,
  onSent,
}: {
  lease: PortalLease;
  charges: PortalCharge[];
  currency: string;
  settings: AppSettings;
  onBack: () => void;
  onSent: () => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const total = charges.reduce((sum, charge) => sum + balanceOf(charge), 0);
  const [amount, setAmount] = useState(() => total.toFixed(2));
  const [paidOn, setPaidOn] = useState(toIsoDate(new Date()));
  const [payerBank, setPayerBank] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [reference, setReference] = useState("");
  const [locked, setLocked] = useState({
    amount: false,
    paidOn: false,
    payerBank: false,
    receiptNumber: false,
    reference: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountCents = Math.round(Number(amount) * 100);
  const allocation = allocateOldestFirst(
    charges.map((charge) => ({
      id: charge.id,
      period: charge.period,
      kind: charge.kind ?? undefined,
      remainingCents: Math.round(balanceOf(charge) * 100),
    })),
    Number.isFinite(amountCents) ? amountCents : 0,
  );
  const amountTooHigh = allocation.ok === false && allocation.error === "exceeds";

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clearFile() {
    setFile(null);
    setFieldsOpen(false);
    setLocked({ amount: false, paidOn: false, payerBank: false, receiptNumber: false, reference: false });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onPickFile(next: File | null) {
    setError(null);
    if (!next) {
      clearFile();
      return;
    }
    if (next.size > RECEIPT_MAX_BYTES) {
      setError("El comprobante puede pesar como máximo 10 MB");
      clearFile();
      return;
    }
    setFile(next);
    setReading(true);
    try {
      const form = new FormData();
      form.set("file", next);
      form.set("lease_id", lease.id);
      const draft = await apiForm<{
        manual?: boolean;
        error?: string;
        draft?: {
          amount: number | null;
          paid_on: string | null;
          payer_bank_name: string | null;
          receipt_number: string | null;
          reference: string | null;
        };
      }>("/api/portal/receipts/read", form);
      if (draft.manual || !draft.draft) {
        setLocked({ amount: false, paidOn: false, payerBank: false, receiptNumber: false, reference: false });
        setError(draft.error ?? "Llénalo a mano.");
        setFieldsOpen(true);
        return;
      }
      const nextLocked = {
        amount: false,
        paidOn: false,
        payerBank: false,
        receiptNumber: false,
        reference: false,
      };
      if (draft.draft?.amount != null) {
        setAmount(draft.draft.amount.toFixed(2));
        nextLocked.amount = true;
      }
      if (draft.draft.paid_on) {
        setPaidOn(draft.draft.paid_on);
        nextLocked.paidOn = true;
      }
      if (draft.draft.payer_bank_name) {
        setPayerBank(draft.draft.payer_bank_name);
        nextLocked.payerBank = true;
      }
      if (draft.draft.receipt_number) {
        setReceiptNumber(draft.draft.receipt_number);
        nextLocked.receiptNumber = true;
      }
      if (draft.draft.reference) {
        setReference(draft.draft.reference);
        nextLocked.reference = true;
      }
      setLocked(nextLocked);
      setFieldsOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo leer el comprobante. Llénalo a mano.";
      setError(message);
      setLocked({ amount: false, paidOn: false, payerBank: false, receiptNumber: false, reference: false });
      if (message.includes("una sola página") || message.includes("ya fue usado")) clearFile();
      else setFieldsOpen(true);
    } finally {
      setReading(false);
    }
  }

  const formComplete =
    charges.length > 0 &&
    allocation.ok &&
    paidOn &&
    payerBank.trim().length > 0 &&
    receiptNumber.trim().length > 0 &&
    file;

  async function send() {
    if (!file || charges.length === 0) return;
    setConfirmOpen(false);
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("charge_ids", JSON.stringify(charges.map((charge) => charge.id)));
      form.set("amount", (amountCents / 100).toFixed(2));
      form.set("paid_on", paidOn);
      form.set("payer_bank_name", payerBank.trim());
      form.set("receipt_number", receiptNumber.trim());
      form.set("reference", reference.trim());
      form.set("file", file);
      form.set(
        "fill_source",
        Object.values(locked).some(Boolean) ? "automatic" : "manual",
      );
      await apiForm("/api/portal/receipts", form);
      clearFile();
      setPayerBank("");
      setReceiptNumber("");
      setReference("");
      await onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el comprobante");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden />
        Método de pago
      </button>

      <Card className="p-5">
        <h2 className="text-[1.0625rem] font-semibold">Transferencia</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Realiza tu transferencia con los datos bancarios y luego registra el pago.
        </p>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Titular</dt>
            <dd className="font-medium">{settings.bank_holder || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Banco</dt>
            <dd className="font-medium">{settings.bank_name || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Cuenta</dt>
            <dd className="font-medium">{settings.bank_account || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">CLABE</dt>
            <dd className="font-medium">{settings.bank_clabe || "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-5">
        <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
          <span className="text-sm text-muted-foreground">{lease.unit_name ?? "Unidad"}</span>
          <span className="text-xl font-semibold tabular-nums">{formatMoney(total, currency)}</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Si transfieres menos del total, el abono se aplica primero a la renta más antigua.
        </p>
        <div className="mt-4">
            <Label>Comprobante</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Una sola página (imagen o PDF), máximo 10 MB.
            </p>
            <input
              ref={fileInputRef}
              id="pay-file"
              type="file"
              className="sr-only"
              accept={RECEIPT_ACCEPT}
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" className="gap-2" disabled={reading} onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-4" aria-hidden />
                Elegir comprobante
              </Button>
              {file && (
                <span className="max-w-[min(100%,14rem)] truncate text-sm text-muted-foreground">{file.name}</span>
              )}
              {file && (
                <Button type="button" variant="ghost" size="icon" className="size-8" onClick={clearFile} aria-label="Quitar archivo">
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {reading ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Leyendo comprobante…
              </p>
            ) : null}
            {previewUrl && file && (
              <div className="mt-3 overflow-hidden rounded-md border border-border bg-muted/30">
                <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{file.name}</p>
                {file.type === "application/pdf" ? (
                  <iframe
                    title="Vista previa del comprobante PDF"
                    src={previewUrl}
                    className="h-72 w-full bg-background"
                  />
                ) : (
                  <img src={previewUrl} alt="Vista previa del comprobante" className="max-h-72 w-full object-contain" />
                )}
              </div>
            )}
        </div>
        {fieldsOpen && file ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="pay-amount">Monto de la transferencia</Label>
            <MoneyInput id="pay-amount" value={amount} currency={currency} onChange={setAmount} disabled={locked.amount} />
            {amountTooHigh ? (
              <p className="mt-1 text-xs text-destructive">El monto supera el saldo pendiente.</p>
            ) : null}
            {allocation.ok ? (
              <ul className="mt-2 space-y-1 text-sm">
                {allocation.rows.map((row) => {
                  const charge = charges.find((item) => item.id === row.id);
                  return (
                    <li key={row.id} className="flex items-baseline justify-between gap-3">
                      <span className="capitalize">
                        {chargeConcept(charge?.kind)} de {formatPeriod(row.period)}
                      </span>
                      <span className="tabular-nums">
                        {formatMoney(row.cents / 100, currency)}
                        {charge && row.cents < Math.round(balanceOf(charge) * 100) ? " (abono)" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <div>
            <Label htmlFor="pay-bank">Nombre del banco (desde el que pagaste)</Label>
            <Input
              id="pay-bank"
              value={payerBank}
              maxLength={80}
              autoComplete="off"
              disabled={locked.payerBank}
              onChange={(e) => setPayerBank(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pay-receipt-no">Número de comprobante</Label>
            <Input
              id="pay-receipt-no"
              value={receiptNumber}
              maxLength={80}
              autoComplete="off"
              disabled={locked.receiptNumber}
              onChange={(e) => setReceiptNumber(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pay-date">Fecha del pago</Label>
            <Input id="pay-date" type="date" value={paidOn} disabled={locked.paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pay-ref">Referencia (opcional)</Label>
            <Input
              id="pay-ref"
              value={reference}
              maxLength={120}
              disabled={locked.reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>
        ) : null}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {fieldsOpen && file ? (
        <Button
          type="button"
          className="mt-4"
          disabled={saving || reading || !formComplete}
          onClick={() => setConfirmOpen(true)}
        >
          Enviar pago
        </Button>
        ) : null}
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Enviar este comprobante?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Registrarás un pago de <strong>{formatMoney(amountCents / 100, currency)}</strong> por transferencia.
                  Los datos quedarán en revisión hasta que el equipo los apruebe o rechace.
                </p>
                <ul className="list-inside list-disc text-sm">
                  <li>Banco: {payerBank.trim()}</li>
                  <li>Comprobante n.º {receiptNumber.trim()}</li>
                  <li>Fecha: {paidOn}</li>
                  {reference.trim() ? <li>Referencia: {reference.trim()}</li> : null}
                  <li>Archivo: {file?.name}</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Volver</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => void send()}>
              Sí, enviar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
