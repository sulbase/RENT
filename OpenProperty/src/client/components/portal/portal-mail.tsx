import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Mail, MailOpen, Trash2, X } from "lucide-react";
import { api } from "@/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PORTAL_MAIL_COMPOSE_HREF, portalMailWantsCompose, usePortal } from "./portal-context";

const CONTACT_REASONS = ["Mantenimiento", "Pagos", "Contrato", "Acceso", "Otro"] as const;
const RESPONSE_PREFERENCES = ["Correo del portal", "Teléfono", "Correo electrónico"] as const;
const BODY_MAX = 1000;

type InboxMessage = {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  sender_name: string;
  mine: boolean;
  read: boolean;
};

type PortalAlert = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

type MailView = "inbox" | "compose" | "message";
type MailTab = "alerts" | "inbox";

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatOpened(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PortalMailPage() {
  const { location, navigate } = usePortal();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [alerts, setAlerts] = useState<PortalAlert[]>([]);
  const [tab, setTab] = useState<MailTab>("inbox");
  const [view, setView] = useState<MailView>("inbox");
  const [opened, setOpened] = useState<InboxMessage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api<{ messages: InboxMessage[]; unread_count: number }>("GET", "/api/portal/messages");
    setMessages(data.messages);
    try {
      const alertData = await api<{ alerts: PortalAlert[] }>("GET", "/api/portal/alerts");
      setAlerts(alertData.alerts);
    } catch {
      setAlerts([]);
    }
  }

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, []);

  const wantsCompose = portalMailWantsCompose(location);

  useEffect(() => {
    setView((current) => {
      if (wantsCompose) return "compose";
      if (current === "compose") return "inbox";
      return current;
    });
  }, [wantsCompose]);

  function openCompose() {
    setNotice(null);
    setView("compose");
    navigate(PORTAL_MAIL_COMPOSE_HREF);
  }

  function leaveCompose() {
    setView("inbox");
    navigate("/portal/correo");
  }

  async function changeState(action: "read" | "unread" | "hide", ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/api/portal/messages/state", { ids, action });
      setSelected([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el correo");
    } finally {
      setBusy(false);
    }
  }

  async function openMessage(message: InboxMessage) {
    setNotice(null);
    setOpened(message);
    setView("message");
    if (!message.read) {
      await changeState("read", [message.id]);
      setOpened({ ...message, read: true });
    }
  }

  async function openAlert(alert: PortalAlert) {
    setOpened({
      id: alert.id,
      subject: alert.title,
      body: alert.body,
      created_at: alert.created_at,
      sender_name: "Administración",
      mine: false,
      read: alert.read_at !== null,
    });
    setView("message");
    if (!alert.read_at) {
      await api("POST", `/api/portal/alerts/${alert.id}/read`);
      setAlerts((current) =>
        current.map((row) => (row.id === alert.id ? { ...row, read_at: new Date().toISOString() } : row)),
      );
    }
  }

  const allSelected = messages.length > 0 && selected.length === messages.length;

  return (
    <PageShell title="Mensajes" notifications={false} width="max-w-5xl">
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {notice && view !== "compose" && <p className="mb-3 text-sm">{notice}</p>}
      {view === "compose" ? (
        <ComposeForm
          busy={busy}
          onCancel={leaveCompose}
          onSent={async () => {
            await load();
            setNotice("Enviado exitosamente");
            leaveCompose();
          }}
          onError={setError}
          setBusy={setBusy}
        />
      ) : view === "message" && opened ? (
        <article>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-2 text-lg font-semibold"
            onClick={() => setView("inbox")}
          >
            <ArrowLeft className="size-5" aria-hidden />
            <span className="truncate">{opened.subject}</span>
          </button>
          <div className="mt-6 flex items-start justify-between gap-4">
            <h2 className="text-2xl font-semibold">{opened.sender_name}</h2>
            <p className="shrink-0 text-sm text-muted-foreground">{formatOpened(opened.created_at)}</p>
          </div>
          <div className="mx-auto mt-6 max-w-3xl bg-white px-8 py-6 text-sm leading-relaxed text-neutral-900">
            <p className="whitespace-pre-wrap">{opened.body}</p>
          </div>
        </article>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">{tab === "inbox" ? "Bandeja de entrada" : "Alertas"}</h2>
            {tab === "inbox" && (
              <Button type="button" className="rounded-full px-4" onClick={openCompose}>
                Mensajes sobre la propiedad
              </Button>
            )}
          </div>
          <div className="mt-4 flex gap-2" role="tablist">
            <TabButton active={tab === "alerts"} onClick={() => setTab("alerts")}>Alertas</TabButton>
            <TabButton active={tab === "inbox"} onClick={() => { setTab("inbox"); setSelected([]); }}>
              Bandeja de entrada
            </TabButton>
          </div>
          {tab === "alerts" ? (
            alerts.length === 0 ? (
              <p className="py-16 text-center text-sm italic text-muted-foreground">No hay alertas.</p>
            ) : (
              <ul className="mt-2 border-b border-white">
                {alerts.map((alert) => (
                  <li
                    key={alert.id}
                    className={cn(
                      "border-b border-white last:border-b-0",
                      alert.read_at ? "bg-[#2a2928]" : "bg-[#100f0e]",
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center justify-between gap-4 px-3 py-3 text-left"
                      onClick={() => void openAlert(alert)}
                    >
                      <span className="truncate text-sm">{alert.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatWhen(alert.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : messages.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No hay mensajes.</p>
          ) : (
            <div className="mt-2">
              <div className="flex items-center justify-between gap-3 border-b border-white px-3 py-2">
                <label className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => setSelected(event.target.checked ? messages.map((row) => row.id) : [])}
                  />
                  Seleccionar todos
                </label>
                {selected.length > 0 && (
                  <div className="flex items-center gap-1">
                    <IconButton label="Marcar como leído" disabled={busy} onClick={() => void changeState("read", selected)}>
                      <MailOpen className="size-4" />
                    </IconButton>
                    <IconButton label="Marcar como no leído" disabled={busy} onClick={() => void changeState("unread", selected)}>
                      <Mail className="size-4" />
                    </IconButton>
                    <IconButton label="Eliminar" disabled={busy} onClick={() => void changeState("hide", selected)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                    <IconButton label="Cancelar" disabled={busy} onClick={() => setSelected([])}>
                      <X className="size-4" />
                    </IconButton>
                  </div>
                )}
              </div>
              <ul className="border-b border-white">
                {messages.map((message) => {
                  const isSelected = selected.includes(message.id);
                  return (
                    <li
                      key={message.id}
                      className={cn(
                        "flex items-center gap-3 border-b border-white px-3 py-3 last:border-b-0",
                        isSelected ? "bg-[#9a9894] text-[#100f0e]" : message.read ? "bg-[#2a2928]" : "bg-[#100f0e]",
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${message.subject}`}
                        checked={isSelected}
                        onChange={(event) => {
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, message.id]
                              : current.filter((id) => id !== message.id),
                          );
                        }}
                      />
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-4 text-left"
                        onClick={() => void openMessage(message)}
                      >
                        <span className="truncate text-sm">{message.subject}</span>
                        <span className={cn("shrink-0 text-xs", isSelected ? "text-[#100f0e]" : "text-muted-foreground")}>
                          {formatWhen(message.created_at)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        "cursor-pointer rounded-full px-3 py-1 text-sm",
        active ? "bg-[#3a3937] font-medium" : "text-muted-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="cursor-pointer rounded-md p-2 text-sky-400 disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ComposeForm({
  busy,
  onCancel,
  onSent,
  onError,
  setBusy,
}: {
  busy: boolean;
  onCancel: () => void;
  onSent: () => Promise<void>;
  onError: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
}) {
  const { home } = usePortal();
  const leases = home?.leases ?? [];
  const [leaseId, setLeaseId] = useState("");
  const [reason, setReason] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preference, setPreference] = useState("");

  useEffect(() => {
    if (leases.length === 1) setLeaseId(leases[0].id);
  }, [leases]);

  async function send() {
    setBusy(true);
    onError(null);
    try {
      await api("POST", "/api/portal/messages", {
        lease_id: leaseId,
        reason,
        subject: subject.trim(),
        body: body.trim(),
        response_preference: preference,
      });
      await onSent();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo enviar el mensaje");
    } finally {
      setBusy(false);
    }
  }

  const ready =
    leaseId !== "" && reason !== "" && subject.trim() !== "" && body.trim() !== "" && preference !== "";

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold">Contactar a la propiedad</h2>
      <p className="mt-4 text-sm">Mensaje al personal de la propiedad</p>
      <div className="mt-4 grid gap-4">
        {leases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tienes un contrato vigente para enviar mensajes.</p>
        ) : (
          <div>
            <Label>Unidad *</Label>
            <Select value={leaseId} onValueChange={setLeaseId} disabled={leases.length === 1}>
              <SelectTrigger aria-label="Unidad">
                <SelectValue placeholder="Seleccionar uno" />
              </SelectTrigger>
              <SelectContent>
                {leases.map((row) => (
                  <SelectItem key={row.id} value={row.id}>{row.unit_name ?? "Unidad"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Razón de contacto *</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger aria-label="Razón de contacto">
              <SelectValue placeholder=" " />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_REASONS.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="mail-subject">Asunto *</Label>
          <Input id="mail-subject" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="mail-body">Mensaje *</Label>
          <Textarea
            id="mail-body"
            value={body}
            maxLength={BODY_MAX}
            rows={6}
            onChange={(event) => setBody(event.target.value)}
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">{body.length}/{BODY_MAX} caracteres</p>
        </div>
        <div>
          <Label>Preferencias de respuesta *</Label>
          <Select value={preference} onValueChange={setPreference}>
            <SelectTrigger aria-label="Preferencias de respuesta">
              <SelectValue placeholder=" " />
            </SelectTrigger>
            <SelectContent>
              {RESPONSE_PREFERENCES.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-6 flex gap-2">
        <Button
          type="button"
          className="rounded-full px-4"
          disabled={busy || !ready || leases.length === 0}
          onClick={() => void send()}
        >
          Enviar mensaje
        </Button>
        <Button type="button" variant="outline" className="rounded-full px-4" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
