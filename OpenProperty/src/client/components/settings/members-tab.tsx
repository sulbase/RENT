import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import { useApp } from "@/context";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Role = "owner" | "manager" | "staff" | "viewer";

type Member = {
  user_id: string;
  role: Role;
  email: string | null;
  created_at: string;
};

type Invitation = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
};

const ROLE_LABEL: Record<Role, string> = {
  owner: "Propietario",
  manager: "Administrador",
  staff: "Equipo",
  viewer: "Lectura",
};

export function MembersTab() {
  const app = useApp();
  const { role, user } = useAuth();
  const canManage = role === "owner" || role === "manager";
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canManage) return;
    const res = await api<{ members: Member[]; invitations: Invitation[] }>("GET", "/api/settings/members");
    setMembers(res.members);
    setInvitations(res.invitations);
  }, [canManage]);

  useEffect(() => {
    void load().catch((err: Error) => app.setError(err.message));
  }, [load, app.setError]);

  if (!canManage) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Solo el propietario o un administrador puede ver e invitar miembros.
      </Card>
    );
  }

  const offered: Role[] = role === "owner" ? ["owner", "viewer"] : ["viewer"];
  function roleOptions(current: Role | null): Role[] {
    if (current && !offered.includes(current)) return [current, ...offered];
    return offered;
  }

  async function invite() {
    setBusy(true);
    try {
      await api("POST", "/api/settings/members", { email: email.trim(), role: inviteRole });
      setEmail("");
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: Member, next: Role) {
    try {
      await api("PATCH", `/api/settings/members/${member.user_id}`, { role: next });
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  async function removeMember(member: Member) {
    try {
      await api("DELETE", `/api/settings/members/${member.user_id}`);
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  async function cancelInvite(id: string) {
    try {
      await api("DELETE", `/api/settings/invitations/${id}`);
      await load();
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="p-6">
        <h2 className="mb-1 text-sm font-semibold">Invitar por correo</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Si esa persona ya tiene cuenta, entra enseguida. Si no, el acceso se activa cuando se registre con el mismo correo.
        </p>
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto] md:items-end">
          <div>
            <Label htmlFor="invite-email">Correo</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label>Rol</Label>
            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roleOptions(null).map((value) => (
                  <SelectItem key={value} value={value}>{ROLE_LABEL[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" disabled={busy || !email.trim()} onClick={() => void invite()}>
            Invitar
          </Button>
        </div>
      </Card>

      <Card>
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">Miembros</h2>
        </div>
        <ul className="divide-y">
          {members.map((member) => {
            const locked = role !== "owner" && member.role === "owner";
            const isSelf = member.user_id === user?.id;
            return (
              <li key={member.user_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{member.email ?? member.user_id}</div>
                  <div className="text-xs text-muted-foreground">{isSelf ? "Tú" : ROLE_LABEL[member.role]}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={member.role}
                    disabled={locked}
                    onValueChange={(v) => void changeRole(member, v as Role)}
                  >
                    <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(locked ? (["owner"] as Role[]) : roleOptions(member.role)).map((value) => (
                        <SelectItem key={value} value={value}>{ROLE_LABEL[value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" disabled={locked} onClick={() => void removeMember(member)}>
                    Quitar
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <div className="border-b p-4">
            <h2 className="text-sm font-semibold">Invitaciones pendientes</h2>
          </div>
          <ul className="divide-y">
            {invitations.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium">{invite.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {ROLE_LABEL[invite.role]} · vence {invite.expires_at.slice(0, 10)}
                  </div>
                </div>
                <Button type="button" variant="ghost" onClick={() => void cancelInvite(invite.id)}>
                  Cancelar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
