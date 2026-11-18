import { describe, expect, it } from "vitest";
import { factory } from "../factory";
import type { Sql } from "../db";
import { mountMessageRoutes } from "../routes/messages";

const ORG_A = "10000000-0000-4000-8000-000000000001";
const ORG_B = "10000000-0000-4000-8000-000000000002";
const USER_A = "30000000-0000-4000-8000-000000000001";
const USER_B = "30000000-0000-4000-8000-000000000002";
const TENANT_B = "20000000-0000-4000-8000-00000000000b";
const THREAD_B = "40000000-0000-4000-8000-0000000000b1";

type Thread = {
  id: string;
  organization_id: string;
  subject: string;
  created_by: string;
  last_message_at: string;
};
type Participant = {
  thread_id: string;
  organization_id: string;
  participant_kind: string;
  user_id: string | null;
  tenant_id: string | null;
  email: string;
  role: string;
};
type Message = {
  id: string;
  thread_id: string;
  organization_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
};

function createSql() {
  const threads: Thread[] = [
    {
      id: THREAD_B,
      organization_id: ORG_B,
      subject: "Aviso org B",
      created_by: USER_B,
      last_message_at: "2026-09-25T12:00:00.000Z",
    },
  ];
  const participants: Participant[] = [
    {
      thread_id: THREAD_B,
      organization_id: ORG_B,
      participant_kind: "membership",
      user_id: USER_B,
      tenant_id: null,
      email: "b@example.com",
      role: "from",
    },
  ];
  const messages: Message[] = [
    {
      id: "50000000-0000-4000-8000-0000000000b1",
      thread_id: THREAD_B,
      organization_id: ORG_B,
      sender_user_id: USER_B,
      body: "Solo org B",
      created_at: "2026-09-25T12:00:00.000Z",
    },
  ];
  const members = [
    { organization_id: ORG_A, user_id: USER_A, email: "a@example.com" },
    { organization_id: ORG_B, user_id: USER_B, email: "b@example.com" },
  ];
  const tenants = [
    {
      id: TENANT_B,
      organization_id: ORG_B,
      email: "inquilino@example.com",
      first_name: "Ana",
      last_name: "Ruiz",
    },
  ];

  const unsafe = async (text: string, params: unknown[] = []) => {
    if (text.includes("staff_mail")) {
      const [org, userId, box] = params as [string, string, string];
      return messages
        .filter((row) => row.organization_id === org)
        .filter((row) => {
          const inThread = participants.some(
            (participant) => participant.thread_id === row.thread_id && participant.user_id === userId,
          );
          if (box === "sent") return row.sender_user_id === userId;
          return inThread && row.sender_user_id !== userId;
        })
        .map((row) => ({
          ...row,
          subject: threads.find((thread) => thread.id === row.thread_id)?.subject ?? "",
          sender_email:
            participants.find((participant) => participant.user_id === row.sender_user_id)?.email ?? "",
          mine: row.sender_user_id === userId,
          read: row.sender_user_id === userId,
        }));
    }
    if (text.includes("FROM message_threads t") && text.includes("LIMIT $4")) {
      const [org, userId, box] = params as [string, string, string];
      return threads
        .filter((thread) => thread.organization_id === org)
        .filter((thread) => {
          const mine = participants.filter(
            (row) => row.thread_id === thread.id && row.user_id === userId,
          );
          if (box === "inbox") return mine.some((row) => row.role === "to" || row.role === "cc");
          return messages.some(
            (row) => row.thread_id === thread.id && row.sender_user_id === userId,
          );
        })
        .map((thread) => ({ ...thread, entity_type: null, entity_id: null, unread_count: 0 }));
    }
    if (text.includes("FROM message_thread_participants") && text.includes("ANY($2")) {
      const [org, ids] = params as [string, string[]];
      return participants.filter(
        (row) => row.organization_id === org && ids.includes(row.thread_id),
      );
    }
    if (text.includes("COUNT(*)::int AS n") && text.includes("message_reads")) {
      return [{ n: 0 }];
    }
    if (text.includes("FROM message_threads t") && text.includes("t.id = $1")) {
      const [id, org, userId] = params as [string, string, string];
      const thread = threads.find((row) => row.id === id && row.organization_id === org);
      const visible = participants.some(
        (row) => row.thread_id === id && row.organization_id === org && row.user_id === userId,
      );
      return thread && visible ? [thread] : [];
    }
    if (text.includes("SELECT participant_kind") && text.includes("thread_id = $1")) {
      const [id, org] = params as [string, string];
      return participants.filter((row) => row.thread_id === id && row.organization_id === org);
    }
    if (text.includes("FROM messages m") && text.includes("LEFT JOIN message_reads")) {
      const [id, org] = params as [string, string];
      return messages
        .filter((row) => row.thread_id === id && row.organization_id === org)
        .map((row) => ({ ...row, read_at: null }));
    }
    if (text.includes("FROM documents")) return [];
    if (text.includes("FROM memberships m") && text.includes("auth.users")) {
      const [org, ids] = params as [string, string[]];
      return members
        .filter((row) => row.organization_id === org && ids.includes(row.user_id))
        .map((row) => ({ user_id: row.user_id, email: row.email }));
    }
    if (text.includes("FROM tenants")) {
      const [org, ids] = params as [string, string[]];
      return tenants.filter((row) => row.organization_id === org && ids.includes(row.id));
    }
    if (text.includes("INSERT INTO message_threads")) {
      const [id, organization_id, subject, , , , , , , created_by] = params as string[];
      threads.push({
        id,
        organization_id,
        subject,
        created_by,
        last_message_at: "2026-09-25T13:00:00.000Z",
      });
      return [];
    }
    if (text.includes("INSERT INTO message_thread_participants")) {
      const [organization_id, thread_id, participant_kind, user_id, tenant_id, email, role] =
        params as [string, string, string, string | null, string | null, string, string];
      participants.push({
        thread_id,
        organization_id,
        participant_kind,
        user_id,
        tenant_id,
        email,
        role,
      });
      return [];
    }
    if (text.includes("INSERT INTO messages")) {
      const [id, thread_id, organization_id, sender_user_id, body] = params as string[];
      messages.push({
        id,
        thread_id,
        organization_id,
        sender_user_id,
        body,
        created_at: "2026-09-25T13:00:00.000Z",
      });
      return [];
    }
    if (text.includes("UPDATE message_threads")) return [];
    if (text.includes("SELECT 1 AS ok FROM message_thread_participants")) {
      const [id, org, userId] = params as [string, string, string];
      const found = participants.some(
        (row) => row.thread_id === id && row.organization_id === org && row.user_id === userId,
      );
      return found ? [{ ok: 1 }] : [];
    }
    if (text.includes("INSERT INTO message_reads")) {
      const [id, org] = params as [string, string];
      const thread = threads.find((row) => row.id === id && row.organization_id === org);
      return Object.assign([], { count: thread ? 1 : 0 });
    }
    return [];
  };

  const sql = {
    unsafe,
    begin: async (fn: (tx: { unsafe: typeof unsafe }) => Promise<unknown>) => fn({ unsafe }),
  };
  return { sql: sql as unknown as Sql, threads, messages };
}

function appFor(orgId: string, userId: string, sql: Sql) {
  const app = factory.createApp();
  app.use("*", async (c, next) => {
    c.set("sql", sql);
    c.set("db", {} as never);
    c.set("orgId", orgId);
    c.set("userId", userId);
    c.set("userEmail", userId === USER_A ? "a@example.com" : "b@example.com");
    c.set("role", "owner");
    await next();
  });
  mountMessageRoutes(app);
  return app;
}

describe("API org isolation (messages)", () => {
  it("hides another organization's thread", async () => {
    const { sql } = createSql();
    const res = await appFor(ORG_A, USER_A, sql).request(`/api/messages/${THREAD_B}`);
    expect(res.status).toBe(404);
    const list = await appFor(ORG_A, USER_A, sql).request("/api/messages?box=inbox");
    const body = (await list.json()) as { messages: { id: string }[] };
    expect(body.messages).toEqual([]);
  });

  it("rejects a reply to another organization's thread", async () => {
    const { sql, messages } = createSql();
    const before = messages.length;
    const res = await appFor(ORG_A, USER_A, sql).request(`/api/messages/${THREAD_B}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Intrusión" }),
    });
    expect(res.status).toBe(404);
    expect(messages).toHaveLength(before);
  });

  it("rejects a tenant from another organization and keeps the mailbox empty", async () => {
    const { sql, threads } = createSql();
    const res = await appFor(ORG_A, USER_A, sql).request("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Hola",
        body: "Texto plano",
        recipients: [{ kind: "tenant", id: TENANT_B, role: "to" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(threads.some((thread) => thread.organization_id === ORG_A)).toBe(false);
  });

  it("rejects HTML in the body", async () => {
    const { sql } = createSql();
    const res = await appFor(ORG_A, USER_A, sql).request("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Hola",
        body: "<script>alert(1)</script>",
        recipients: [{ kind: "membership", id: USER_B, role: "to" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("stores a thread only for the sender organization", async () => {
    const { sql } = createSql();
    const created = await appFor(ORG_B, USER_B, sql).request("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Renta",
        body: "El recibo de octubre está listo.",
        recipients: [{ kind: "tenant", id: TENANT_B, role: "to" }],
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { thread: { id: string } };
    const foreign = await appFor(ORG_A, USER_A, sql).request(`/api/messages/${body.thread.id}`);
    expect(foreign.status).toBe(404);
    const own = await appFor(ORG_B, USER_B, sql).request(`/api/messages/${body.thread.id}`);
    expect(own.status).toBe(200);
  });
});
