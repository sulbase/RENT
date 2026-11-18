import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Mail, MailOpen, Trash2, X } from "lucide-react";
import { api, apiBlob } from "@/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CONTACT_REASONS = ["Mantenimiento", "Pagos", "Contrato", "Acceso", "Otro"] as const;
const BODY_MAX = 1000;

type MailView = "list" | "letter" | "compose";

type Participant = {
  participant_kind: "membership" | "tenant";
  email: string;
  role: "from" | "to" | "cc";
  user_id: string | null;
  tenant_id: string | null;
};

type Attachment = { id: string; filename: string; mime: string };

type MailRow = {
  id: string;
  thread_id: string;
  subject: string;
  body: string;
  created_at: string;
  sender_user_id: string;
  sender_email: string;
  mine: boolean;
  read: boolean;
};

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

function people(participants: Participant[], roles: Array<"from" | "to" | "cc">) {
  return participants
    .filter((row) => roles.includes(row.role))
    .map((row) => row.email)
    .join(", ");
}

export function MessagesPage({ onUnreadCount }: { onUnreadCount?: (count: number) => void }) {
  const [view, setView] = useState<MailView>("list");
  const [rows, setRows] = useState<MailRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [opened, setOpened] = useState<MailRow | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composeSeed, setComposeSeed] = useState({ subject: "", body: "" });
  const [reply, setReply] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadRows() {
    const data = await api<{ messages: MailRow[]; unread_count: number }>(
      "GET",
      "/api/messages?box=inbox",
    );
    setRows(data.messages);
    setUnread(data.unread_count);
    onUnreadCount?.(data.unread_count);
    return data.messages;
  }

  useEffect(() => {
    void loadRows().catch((err: Error) => setError(err.message));
  }, []);

  async function openLetter(row: MailRow) {
    setOpened(row);
    setView("letter");
    setReplying(false);
    setReply("");
    setParticipants([]);
    setAttachments([]);
    const data = await api<{
      participants: Participant[];
      messages: { id: string; attachments: Attachment[] }[];
    }>("GET", `/api/messages/${row.thread_id}`);
    setParticipants(data.participants);
    setAttachments(data.messages.find((message) => message.id === row.id)?.attachments ?? []);
    if (!row.read && !row.mine) {
      await api("POST", `/api/messages/${row.thread_id}/read`, { message_id: row.id });
      setOpened({ ...row, read: true });
      await loadRows();
    }
  }

  function closeLetter() {
    setView("list");
    setOpened(null);
    setReplying(false);
    setReply("");
  }

  async function changeState(action: "read" | "unread" | "hide", ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/api/messages/state", { ids, action });
      setSelected([]);
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el correo");
    } finally {
      setBusy(false);
    }
  }

  function openCompose(seed = { subject: "", body: "" }) {
    setNotice(null);
    setError(null);
    setComposeSeed(seed);
    setView("compose");
  }

  async function sendReply() {
    if (!opened || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/messages/${opened.thread_id}/replies`, { body: reply });
      setReply("");
      setReplying(false);
      setView("list");
      setOpened(null);
      setNotice("Enviado exitosamente");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo responder");
    } finally {
      setBusy(false);
    }
  }

  async function openAttachment(file: Attachment) {
    const blob = await apiBlob(`/api/documents/${file.id}`);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function startForward() {
    if (!opened) return;
    openCompose({
      subject: opened.subject.startsWith("Fwd:") ? opened.subject : `Fwd: ${opened.subject}`,
      body: `\n\n---------- Mensaje reenviado ----------\n${opened.body}`,
    });
  }

  const toLine = people(participants, ["to"]);
  const ccLine = people(participants, ["cc"]);
  const allSelected = rows.length > 0 && selected.length === rows.length;

  return (
    <PageShell
      title="Mensajes"
      meta={unread > 0 ? `${unread} sin leer` : undefined}
      actions={
        view === "list" ? (
          <Button onClick={() => openCompose()}>
            Redactar
          </Button>
        ) : undefined
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && view === "list" && <p className="text-sm">{notice}</p>}
      {view === "compose" ? (
        <ComposeForm
          initialSubject={composeSeed.subject}
          initialBody={composeSeed.body}
          busy={busy}
          setBusy={setBusy}
          onCancel={() => setView("list")}
          onError={setError}
          onSent={async () => {
            setView("list");
            setOpened(null);
            setNotice("Enviado exitosamente");
            await loadRows();
          }}
        />
      ) : view === "letter" && opened ? (
        <article>
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-lg font-semibold"
              onClick={closeLetter}
            >
              <ArrowLeft className="size-5 shrink-0" aria-hidden />
              <span className="truncate">{opened.subject}</span>
            </button>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" onClick={() => setReplying(true)}>
                Responder
              </Button>
              <Button variant="secondary" onClick={startForward}>
                Reenviar
              </Button>
            </div>
          </div>
          <div className="mt-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">{opened.sender_email || "Sin remitente"}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Para: {toLine || "—"}
                {ccLine ? ` · CC: ${ccLine}` : ""}
              </p>
            </div>
            <p className="shrink-0 text-sm text-muted-foreground">{formatOpened(opened.created_at)}</p>
          </div>
          <div className="mx-auto mt-6 max-w-3xl bg-white px-8 py-6 text-sm leading-relaxed text-neutral-900">
            <p className="whitespace-pre-wrap">{opened.body}</p>
            {attachments.length > 0 && (
              <ul className="mt-4">
                {attachments.map((file) => (
                  <li key={file.id}>
                    <button type="button" className="underline" onClick={() => void openAttachment(file)}>
                      {file.filename}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {replying && (
            <form
              className="mx-auto mt-4 max-w-3xl space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendReply();
              }}
            >
              <Label htmlFor="reply-body">Respuesta</Label>
              <Textarea
                id="reply-body"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Escribe la respuesta"
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || reply.trim().length === 0}>
                  Enviar
                </Button>
                <Button type="button" variant="secondary" onClick={() => setReplying(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </article>
      ) : (
        <div>
          <h2 className="text-2xl font-semibold">Bandeja de entrada</h2>
          {rows.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No hay mensajes.</p>
          ) : (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3 border-b border-white px-3 py-2">
                <label className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])}
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
                {rows.map((row) => {
                  const isSelected = selected.includes(row.id);
                  const isRead = row.read === true;
                  return (
                    <li
                      key={row.id}
                      className={cn(
                        "flex items-center gap-3 border-b border-white px-3 py-3 last:border-b-0",
                        isSelected ? "bg-[#9a9894] text-[#100f0e]" : isRead ? "bg-[#2a2928]" : "bg-[#100f0e]",
                      )}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${row.subject}`}
                        checked={isSelected}
                        onChange={(event) => {
                          setSelected((current) =>
                            event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id),
                          );
                        }}
                      />
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-4 text-left"
                        onClick={() => void openLetter(row).catch((err: Error) => setError(err.message))}
                      >
                        <span className="truncate text-sm">{row.subject}</span>
                        <span className={cn("shrink-0 text-xs", isSelected ? "text-[#100f0e]" : "text-muted-foreground")}>
                          {formatWhen(row.created_at)}
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

type ActiveLease = {
  id: string;
  status: string;
  property_id: string | null;
  property_name: string | null;
  unit_name: string | null;
  primary_tenant_id: string | null;
  tenant_first_name: string | null;
  tenant_last_name: string | null;
  tenant_email: string | null;
};

const ALL_UNITS = "all";

function ComposeForm({
  initialSubject,
  initialBody,
  busy,
  setBusy,
  onCancel,
  onError,
  onSent,
}: {
  initialSubject: string;
  initialBody: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
  onError: (message: string | null) => void;
  onSent: () => Promise<void>;
}) {
  const [leases, setLeases] = useState<ActiveLease[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [reason, setReason] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);

  useEffect(() => {
    void api<{ leases: ActiveLease[] }>("GET", "/api/leases")
      .then((data) => {
        setLeases(
          data.leases.filter((row) => row.status === "active" && row.primary_tenant_id),
        );
      })
      .catch((err: Error) => onError(err.message))
      .finally(() => setLoaded(true));
  }, [onError]);

  async function send() {
    const targets =
      leaseId === ALL_UNITS ? units : units.filter((row) => row.id === leaseId);
    if (targets.length === 0 || targets.some((row) => !row.primary_tenant_id)) return;
    const missing = targets.filter((row) => !row.tenant_email?.trim());
    if (missing.length > 0) {
      onError("Hay inquilinos sin correo en esa selección.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      for (const lease of targets) {
        if (!lease.primary_tenant_id) continue;
        const unitLabel = lease.unit_name ?? "Unidad";
        await api("POST", "/api/messages", {
          subject: subject.trim(),
          body: `Unidad: ${unitLabel}\nRazón de contacto: ${reason}\n\n${body.trim()}`,
          recipients: [{ kind: "tenant", id: lease.primary_tenant_id, role: "to" }],
          entity_type: "lease",
          entity_id: lease.id,
        });
      }
      await onSent();
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo enviar el mensaje");
    } finally {
      setBusy(false);
    }
  }

  const properties = [...new Map(
    leases
      .filter((row) => row.property_id)
      .map((row) => [row.property_id, row.property_name ?? "Propiedad"]),
  ).entries()].map(([id, name]) => ({ id: id as string, name }));
  const units = leases.filter((row) => row.property_id === propertyId);
  const ready = propertyId !== "" && leaseId !== "" && reason !== "" && subject.trim() !== "" && body.trim() !== "";

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold">Contactar al inquilino</h2>
      <p className="mt-4 text-sm">Mensaje al inquilino</p>
      <div className="mt-4 grid gap-4">
        {loaded && properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay un contrato vigente para enviar mensajes.</p>
        ) : (
          <>
            <div>
              <Label>Propiedad *</Label>
              <Select
                value={propertyId}
                onValueChange={(value) => {
                  setPropertyId(value);
                  setLeaseId("");
                }}
              >
                <SelectTrigger aria-label="Propiedad">
                  <SelectValue placeholder="Seleccionar uno" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidad *</Label>
              <Select value={leaseId} onValueChange={setLeaseId} disabled={propertyId === ""}>
                <SelectTrigger aria-label="Unidad">
                  <SelectValue placeholder="Seleccionar uno" />
                </SelectTrigger>
                <SelectContent>
                  {units.length > 1 && (
                    <SelectItem value={ALL_UNITS}>Todas las unidades</SelectItem>
                  )}
                  {units.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.unit_name ?? "Unidad"}
                      {row.tenant_first_name || row.tenant_last_name
                        ? ` · ${[row.tenant_first_name, row.tenant_last_name].filter(Boolean).join(" ")}`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        <div>
          <Label>Razón de contacto *</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger aria-label="Razón de contacto">
              <SelectValue placeholder=" " />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_REASONS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="mail-subject">Asunto *</Label>
          <Input
            id="mail-subject"
            value={subject}
            maxLength={200}
            onChange={(event) => setSubject(event.target.value)}
          />
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
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {body.length}/{BODY_MAX} caracteres
          </p>
        </div>
      </div>
      <div className="mt-6 flex gap-2">
        <Button
          type="button"
          className="rounded-full px-4"
          disabled={busy || !ready || properties.length === 0}
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
