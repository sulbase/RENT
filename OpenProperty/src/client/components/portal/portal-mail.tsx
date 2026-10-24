import { useEffect, useState } from "react";
import { api } from "@/api";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PortalMessage, PortalParticipant, PortalThread } from "./portal-types";

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

function people(participants: PortalParticipant[], roles: PortalParticipant["role"][]) {
  return participants
    .filter((row) => roles.includes(row.role))
    .map((row) => row.email)
    .join(", ");
}

export function PortalMailPage() {
  const [threads, setThreads] = useState<PortalThread[]>([]);
  const [unread, setUnread] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [participants, setParticipants] = useState<PortalParticipant[]>([]);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadThreads() {
    const data = await api<{ threads: PortalThread[]; unread_count: number }>(
      "GET",
      "/api/portal/messages",
    );
    setThreads(data.threads);
    setUnread(data.unread_count);
  }

  async function openThread(id: string) {
    setSelectedId(id);
    const data = await api<{
      thread: { subject: string };
      participants: PortalParticipant[];
      messages: PortalMessage[];
    }>("GET", `/api/portal/messages/${id}`);
    setSubject(data.thread.subject);
    setParticipants(data.participants);
    setMessages(data.messages);
    await api("POST", `/api/portal/messages/${id}/read`);
    await loadThreads();
  }

  useEffect(() => {
    void loadThreads().catch((err: Error) => setError(err.message));
  }, []);

  async function sendReply() {
    if (!selectedId || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/portal/messages/${selectedId}/replies`, { body: reply });
      setReply("");
      await openThread(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo responder");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      title="Correo"
      meta={unread > 0 ? `${unread} sin leer` : "Mensajes de tu administración"}
      notifications={false}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid min-h-[28rem] gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-md border border-border">
          {threads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Aún no tienes mensajes. Cuando tu administración te escriba, aparecerán aquí.
            </p>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={cn(
                  "block w-full border-b border-border px-3 py-3 text-left last:border-b-0",
                  selectedId === thread.id ? "bg-muted" : "hover:bg-muted/60",
                )}
                onClick={() => void openThread(thread.id).catch((err: Error) => setError(err.message))}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{thread.subject}</span>
                  {thread.unread_count > 0 && (
                    <span className="text-xs text-muted-foreground">{thread.unread_count}</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {people(thread.participants, ["from"]) || "—"}
                </p>
                <p className="text-xs text-muted-foreground">{formatWhen(thread.last_message_at)}</p>
              </button>
            ))
          )}
        </div>
        <div className="flex min-h-0 flex-col rounded-md border border-border">
          {!selectedId ? (
            <p className="p-4 text-sm text-muted-foreground">Selecciona un hilo para leerlo.</p>
          ) : (
            <>
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-base font-semibold">{subject}</h2>
                <p className="text-xs text-muted-foreground">
                  De: {people(participants, ["from"]) || "—"} · Para: {people(participants, ["to"]) || "—"}
                  {people(participants, ["cc"]) ? ` · CC: ${people(participants, ["cc"])}` : ""}
                </p>
              </div>
              <div className="flex-1 space-y-4 overflow-auto p-4">
                {messages.map((message) => (
                  <article key={message.id} className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {message.mine ? "Tú" : (message.sender_email ?? "Administración")} ·{" "}
                      {formatWhen(message.created_at)}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                  </article>
                ))}
              </div>
              <form
                className="space-y-2 border-t border-border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendReply();
                }}
              >
                <Label htmlFor="portal-reply-body">Responder</Label>
                <Textarea
                  id="portal-reply-body"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Escribe un mensaje de texto"
                />
                <Button type="submit" disabled={busy || reply.trim().length === 0}>
                  Enviar respuesta
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
