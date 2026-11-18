import { useMemo, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatMoney, formatPeriod, toIsoDate } from "@/lib/utils";
import type { LedgerEntry } from "../../../shared/tenant-ledger";

type LedgerFilter = "all" | "payments" | "charges";
type DateRangeMode = "6m" | "custom";
type ExportFormat = "xlsx" | "pdf";

const FILTER_TABS: { id: LedgerFilter; label: string }[] = [
  { id: "all", label: "Libro de contabilidad completo" },
  { id: "payments", label: "Pagos" },
  { id: "charges", label: "Cargos" },
];

function ledgerTipo(entry: LedgerEntry): string {
  if (entry.kind === "payment") return `Pago - ${entry.typeLabel}`;
  const match = entry.typeLabel.match(/^(.*) (\d{4}-\d{2})$/);
  return match ? `Cargo - ${match[1]} de ${formatPeriod(match[2])}` : `Cargo - ${entry.typeLabel}`;
}

function formatStatementDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es", { month: "short", day: "numeric", year: "numeric" });
}

function formatLedgerBalance(amount: number, currency: string): string {
  if (amount < 0) return `(${formatMoney(-amount, currency)})`;
  return formatMoney(amount, currency);
}

function filterByKind(rows: LedgerEntry[], kind: LedgerFilter): LedgerEntry[] {
  if (kind === "payments") return rows.filter((row) => row.kind === "payment");
  if (kind === "charges") return rows.filter((row) => row.kind === "charge");
  return rows;
}

function sixMonthsAgoIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return toIsoDate(d);
}

function filterByDateRange(rows: LedgerEntry[], mode: DateRangeMode, from: string, to: string): LedgerEntry[] {
  if (mode === "6m") {
    const min = sixMonthsAgoIso();
    return rows.filter((row) => row.date >= min);
  }
  if (!from && !to) return rows;
  return rows.filter((row) => {
    if (from && row.date < from) return false;
    if (to && row.date > to) return false;
    return true;
  });
}

function exportRows(rows: LedgerEntry[], currency: string): string[][] {
  const chronological = [...rows].reverse();
  return [
    ["Fecha", "Tipo", "Fuente", "Cargos / Pagos", "Saldo"],
    ...chronological.map((entry) => [
      formatStatementDate(entry.date),
      ledgerTipo(entry),
      entry.source === "owner" ? "Propiedad" : "Usted",
      entry.counts ? formatMoney(entry.amount, currency) : `${formatMoney(entry.amount, currency)} (no cuenta)`,
      formatLedgerBalance(entry.balance, currency),
    ]),
  ];
}

function downloadCsv(rows: string[][]): void {
  const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const body = rows.map((line) => line.map(escape).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "libro-contabilidad.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadPdf(rows: string[][]): void {
  const table = rows
    .map(
      (line, index) =>
        `<tr>${line.map((cell) => `<${index === 0 ? "th" : "td"}>${cell}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Libro de contabilidad</title>
    <style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f4f4f4}</style>
    </head><body><h1>Libro de contabilidad</h1><table>${table}</table></body></html>`;
  const win = window.open("", "_blank", "noopener");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export function PortalStatementSection({
  ledger,
  currency,
  leases,
  statementLeaseId,
  onStatementLeaseIdChange,
}: {
  ledger: LedgerEntry[];
  currency: string;
  leases: { id: string; unit_name: string | null }[];
  statementLeaseId: string;
  onStatementLeaseIdChange: (value: string) => void;
}) {
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("all");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadScope, setDownloadScope] = useState<LedgerFilter>("all");
  const [dateRangeMode, setDateRangeMode] = useState<DateRangeMode>("6m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(toIsoDate(new Date()));
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");

  const visibleLedger = useMemo(() => filterByKind(ledger, ledgerFilter), [ledger, ledgerFilter]);

  function openDownload() {
    setDownloadScope(ledgerFilter);
    setDownloadOpen(true);
  }

  function runDownload() {
    const scoped = filterByKind(ledger, downloadScope);
    const ranged = filterByDateRange(scoped, dateRangeMode, customFrom, customTo);
    const rows = exportRows(ranged, currency);
    if (exportFormat === "pdf") downloadPdf(rows);
    else downloadCsv(rows);
    setDownloadOpen(false);
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Estado de Cuenta</h2>
        {leases.length > 1 && (
          <Select value={statementLeaseId} onValueChange={onStatementLeaseIdChange}>
            <SelectTrigger className="h-8 w-auto min-w-[10rem] cursor-pointer rounded-full px-4" aria-label="Unidad">
              <SelectValue placeholder="General" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">General</SelectItem>
              {leases.map((row) => (
                <SelectItem key={row.id} value={row.id}>{row.unit_name ?? "Unidad"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar movimientos">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={ledgerFilter === tab.id}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors",
                ledgerFilter === tab.id
                  ? "border-sky-500/40 bg-[#1c2a36] text-sky-300"
                  : "border-white/25 text-foreground hover:bg-[#2a2928]",
              )}
              onClick={() => setLedgerFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          className="w-full shrink-0 rounded-full bg-[#9eb3bc] px-5 font-semibold text-[#100f0e] hover:bg-[#8da5ae] lg:w-auto"
          onClick={openDownload}
        >
          <FileSpreadsheet className="size-4" aria-hidden />
          Descargar libro de contabilidad
        </Button>
      </div>

      {visibleLedger.length === 0 ? (
        <p className="mt-8 text-sm italic text-muted-foreground">Aún no hay movimientos.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/15">
                <th className="pb-3 pr-4 text-left text-xs font-normal italic">Fecha</th>
                <th className="pb-3 pr-4 text-left text-xs font-normal italic">Tipo</th>
                <th className="pb-3 pr-4 text-left text-xs font-normal italic">Fuente</th>
                <th className="pb-3 pr-4 text-right text-xs font-normal italic">
                  <span className="text-destructive-solid">Cargos</span>
                  <span className="text-foreground"> / Pagos</span>
                </th>
                <th className="pb-3 text-right text-xs font-normal italic">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {visibleLedger.map((entry) => (
                <tr key={entry.id} className="border-b border-white/10">
                  <td className="py-3 pr-4 italic text-muted-foreground">{formatStatementDate(entry.date)}</td>
                  <td className="py-3 pr-4">
                    <span className="text-sky-400">{ledgerTipo(entry)}</span>
                    {statementLeaseId === "all" && entry.place ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">{entry.place}</div>
                    ) : null}
                    {entry.note ? <div className="mt-0.5 text-xs text-muted-foreground">{entry.note}</div> : null}
                  </td>
                  <td className="py-3 pr-4">{entry.source === "owner" ? "Propiedad" : "Usted"}</td>
                  <td
                    className={cn(
                      "py-3 pr-4 text-right tabular-nums",
                      entry.kind === "charge" && entry.counts ? "font-semibold text-destructive-solid" : "",
                      entry.counts ? "" : "text-muted-foreground line-through",
                    )}
                  >
                    {formatMoney(entry.amount, currency)}
                  </td>
                  <td className="py-3 text-right font-medium tabular-nums">
                    {formatLedgerBalance(entry.balance, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={downloadOpen} onOpenChange={setDownloadOpen}>
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>Descargar libro de contabilidad</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 px-5 py-5">
            <fieldset>
              <legend className="text-sm font-semibold">Seleccione sus opciones de descarga:</legend>
              <div className="mt-3 space-y-2 text-sm">
                {FILTER_TABS.map((tab) => (
                  <label key={tab.id} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="download-scope"
                      className="size-4 accent-sky-500"
                      checked={downloadScope === tab.id}
                      onChange={() => setDownloadScope(tab.id)}
                    />
                    {tab.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-semibold">Intervalo de fecha:</legend>
              <div className="mt-3 space-y-2 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="date-range"
                    className="size-4 accent-sky-500"
                    checked={dateRangeMode === "6m"}
                    onChange={() => setDateRangeMode("6m")}
                  />
                  Últimos 6 meses
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="date-range"
                    className="size-4 accent-sky-500"
                    checked={dateRangeMode === "custom"}
                    onChange={() => setDateRangeMode("custom")}
                  />
                  Personalizado
                </label>
              </div>
              {dateRangeMode === "custom" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="stmt-from">Desde</Label>
                    <Input id="stmt-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="stmt-to">Hasta</Label>
                    <Input id="stmt-to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                  </div>
                </div>
              )}
            </fieldset>
            <div>
              <Label className="text-sm font-semibold">Formato:</Label>
              <Select value={exportFormat} onValueChange={(value) => setExportFormat(value as ExportFormat)}>
                <SelectTrigger className="mt-2 cursor-pointer" aria-label="Formato">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xlsx">XLSX</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border-t border-border px-5 py-4">
            <Button
              type="button"
              className="w-full rounded-full bg-[#9eb3bc] font-semibold text-[#100f0e] hover:bg-[#8da5ae]"
              onClick={runDownload}
            >
              Descargar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
