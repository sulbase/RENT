import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NotificationKind =
  | "rent_due"
  | "rent_overdue"
  | "lease_expiring"
  | "work_order"
  | "signature"
  | "payment_receipt"
  | "system";

type NotificationRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  read_at: string | null;
  created_at: string;
};

const KIND_LABEL: Record<NotificationKind | "all", string> = {
  all: "Todos los tipos",
  rent_due: "Renta por vencer",
  rent_overdue: "Renta vencida",
  lease_expiring: "Contratos",
  work_order: "Órdenes",
  signature: "Firma",
  payment_receipt: "Comprobantes",
  system: "Sistema",
};

const READ_LABEL = {
  unread: "No leídas",
  read: "Leídas",
  all: "Todas",
} as const;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [kind, setKind] = useState<NotificationKind | "all">("all");
  const [read, setRead] = useState<"unread" | "read" | "all">("unread");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadList() {
    const params = new URLSearchParams({ read });
    if (kind !== "all") params.set("kind", kind);
    const data = await api<{ notifications: NotificationRow[]; unread_count: number }>(
      "GET",
      `/api/notifications?${params.toString()}`,
    );
    setRows(data.notifications);
    setUnread(data.unread_count);
    setError(null);
    setLoaded(true);
  }

  async function loadCount() {
    const data = await api<{ unread_count: number }>("GET", "/api/notifications?limit=1&read=unread");
    setUnread(data.unread_count);
  }

  useEffect(() => {
    void loadCount().catch(() => {
      /* The mailbox appears once the table exists. */
    });
    const timer = window.setInterval(() => {
      void loadCount().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    void loadList()
      .catch((err: unknown) => {
        setRows([]);
        setError(err instanceof Error ? err.message : "No se pudieron cargar las alertas");
      })
      .finally(() => setBusy(false));
  }, [open, kind, read]);

  async function markOne(id: string) {
    await api("POST", `/api/notifications/${id}/read`);
    await loadList();
  }

  async function markAll() {
    setBusy(true);
    try {
      await api("POST", "/api/notifications/read-all");
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron marcar las alertas");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Alertas, ${unread} sin leer` : "Alertas"}
        aria-expanded={open}
        className="relative"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Cerrar alertas"
            className="absolute inset-0 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-background shadow-raised">
            <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Alertas</h2>
                <p className="text-xs text-muted-foreground">
                  {unread === 1 ? "1 sin leer" : `${unread} sin leer`}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={busy || unread === 0} onClick={() => void markAll()}>
                Marcar todas
              </Button>
            </header>
            <div className="flex gap-2 border-b border-border px-4 py-2">
              <select
                aria-label="Tipo de alerta"
                className="h-7 min-w-0 flex-1 rounded-sm bg-secondary px-2 text-sm shadow-raised"
                value={kind}
                onChange={(event) => setKind(event.target.value as NotificationKind | "all")}
              >
                {(Object.keys(KIND_LABEL) as Array<NotificationKind | "all">).map((value) => (
                  <option key={value} value={value}>
                    {KIND_LABEL[value]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Estado de lectura"
                className="h-7 rounded-sm bg-secondary px-2 text-sm shadow-raised"
                value={read}
                onChange={(event) => setRead(event.target.value as "unread" | "read" | "all")}
              >
                {(Object.keys(READ_LABEL) as Array<keyof typeof READ_LABEL>).map((value) => (
                  <option key={value} value={value}>
                    {READ_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {error ? <p className="px-4 py-3 text-sm text-destructive">{error}</p> : null}
              {!error && (busy || !loaded) ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">Cargando…</p>
              ) : null}
              {!error && loaded && !busy && rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No hay alertas con este filtro.
                </p>
              ) : null}
              {!error && rows.length > 0 ? (
                <ul>
                  {rows.map((row) => (
                    <li key={row.id} className="border-b border-border">
                      <button
                        type="button"
                        className={cn(
                          "flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted",
                          row.read_at ? "opacity-70" : "",
                        )}
                        onClick={() => {
                          if (!row.read_at) void markOne(row.id).catch((err: unknown) => {
                            setError(err instanceof Error ? err.message : "No se pudo marcar la alerta");
                          });
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <Badge
                            variant={
                              row.severity === "critical"
                                ? "destructive"
                                : row.severity === "warning"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {KIND_LABEL[row.kind]}
                          </Badge>
                          <span className="text-sm font-medium">{row.title}</span>
                        </span>
                        <span className="text-sm text-muted-foreground">{row.body}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(row.created_at).toLocaleString("es-MX", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
