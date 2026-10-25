import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useApp } from "@/context";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AccountTab() {
  const auth = useAuth();
  const user = auth.user;
  const metadata = user?.user_metadata as { display_name?: string } | undefined;
  const [name, setName] = useState(metadata?.display_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackKey, setFeedbackKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!user) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Los cambios de cuenta usan Supabase Auth. En el modo local sin inicio de sesión no hay un usuario que editar.
      </Card>
    );
  }

  async function run(key: string, action: () => Promise<void>, ok: string) {
    setError(null);
    setNotice(null);
    setFeedbackKey(key);
    setBusy(key);
    try {
      await action();
      setNotice(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="p-6">
        <h2 className="mb-1 text-sm font-semibold">Nombre para mostrar</h2>
        <p className="mb-4 text-xs text-muted-foreground">Se guarda en tu perfil de Supabase.</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="display-name">Nombre</Label>
            <Input id="display-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <Button
            type="button"
            disabled={busy !== null || !name.trim()}
            onClick={() =>
              void run("name", () => auth.updateDisplayName(name.trim()), "Nombre actualizado.")
            }
          >
            {busy === "name" ? "Guardando…" : "Guardar nombre"}
          </Button>
        </div>
      </Card>

      <LandlordCard />
      <BankCard />

      <Card className="p-6">
        <h2 className="mb-1 text-sm font-semibold">Correo</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          El cambio se confirma por correo antes de aplicarse. El enlace vuelve a esta misma dirección.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="account-email">Correo</Label>
            <Input
              id="account-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={busy !== null || !email.trim() || email.trim() === user.email}
            onClick={() =>
              void run(
                "email",
                () => auth.updateEmail(email.trim()),
                "Revisa tu correo para confirmar el cambio.",
              )
            }
          >
            {busy === "email" ? "Enviando…" : "Cambiar correo"}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-sm font-semibold">Contraseña</h2>
        <p className="mb-4 text-xs text-muted-foreground">Mínimo 6 caracteres.</p>
        <div className="grid max-w-md gap-3">
          <PasswordField
            id="account-password-current"
            label="Contraseña actual"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
          />
          <PasswordField
            id="account-password"
            label="Contraseña nueva"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
          <PasswordField
            id="account-password-2"
            label="Confirmar contraseña"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
          />
        </div>
        <div className="mt-4">
          <Button
            type="button"
            disabled={busy !== null || currentPassword.length === 0 || password.length < 6}
            onClick={() => {
              if (password !== confirm) {
                setFeedbackKey("password");
                setNotice(null);
                setError("Las contraseñas no coinciden.");
                return;
              }
              if (password === currentPassword) {
                setFeedbackKey("password");
                setNotice(null);
                setError("La contraseña nueva debe ser distinta de la actual.");
                return;
              }
              void run("password", async () => {
                await auth.updatePassword(password, currentPassword);
                setCurrentPassword("");
                setPassword("");
                setConfirm("");
              }, "Contraseña actualizada.");
            }}
          >
            {busy === "password" ? "Guardando…" : "Cambiar contraseña"}
          </Button>
          {feedbackKey === "password" && (notice || error) ? (
            <p className={error ? "mt-3 text-sm text-destructive" : "mt-3 text-sm text-muted-foreground"} role="alert">
              {error ?? notice}
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-sm font-semibold">Sesiones</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Cierra la sesión en este navegador y en el resto de dispositivos.
        </p>
        <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => void auth.signOutEverywhere()}>
          Cerrar sesión en todos los dispositivos
        </Button>
      </Card>

      {feedbackKey !== "password" && notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {feedbackKey !== "password" && error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

function LandlordCard() {
  const app = useApp();
  const { role } = useAuth();
  const canEdit = role === "owner" || role === "manager";
  const [firstName, setFirstName] = useState(app.settings.landlord_first_name);
  const [lastName, setLastName] = useState(app.settings.landlord_last_name);
  const [email, setEmail] = useState(app.settings.landlord_email);
  const [governmentId, setGovernmentId] = useState(app.settings.landlord_government_id);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(app.settings.landlord_first_name);
    setLastName(app.settings.landlord_last_name);
    setEmail(app.settings.landlord_email);
    setGovernmentId(app.settings.landlord_government_id);
  }, [app.settings]);

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      await app.updateSettings({
        landlord_first_name: firstName.trim(),
        landlord_last_name: lastName.trim(),
        landlord_email: email.trim(),
        landlord_government_id: governmentId.trim(),
      });
      setNotice("Arrendador actualizado. Estos datos se usan al enviar un contrato a firma.");
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-sm font-semibold">Arrendador</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Nombre, correo y documento de identidad de quien firma los contratos.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="landlord-first">Nombre</Label>
          <Input
            id="landlord-first"
            value={firstName}
            maxLength={80}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <Label htmlFor="landlord-last">Apellido</Label>
          <Input
            id="landlord-last"
            value={lastName}
            maxLength={80}
            onChange={(e) => setLastName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <Label htmlFor="landlord-email">Correo</Label>
          <Input
            id="landlord-email"
            type="email"
            value={email}
            maxLength={200}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <Label htmlFor="landlord-id">Documento de identidad</Label>
          <Input
            id="landlord-id"
            value={governmentId}
            maxLength={18}
            onChange={(e) => setGovernmentId(e.target.value)}
            disabled={!canEdit}
          />
        </div>
      </div>
      {canEdit && (
        <div className="mt-4">
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Guardando…" : "Guardar arrendador"}
          </Button>
        </div>
      )}
      {notice && <p className="mt-3 text-sm text-muted-foreground">{notice}</p>}
    </Card>
  );
}

function BankCard() {
  const app = useApp();
  const { role } = useAuth();
  const canEdit = role === "owner" || role === "manager";
  const [holder, setHolder] = useState(app.settings.bank_holder);
  const [bank, setBank] = useState(app.settings.bank_name);
  const [account, setAccount] = useState(app.settings.bank_account);
  const [clabe, setClabe] = useState(app.settings.bank_clabe);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setHolder(app.settings.bank_holder);
    setBank(app.settings.bank_name);
    setAccount(app.settings.bank_account);
    setClabe(app.settings.bank_clabe);
  }, [app.settings]);

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      await app.updateSettings({
        bank_holder: holder.trim(),
        bank_name: bank.trim(),
        bank_account: account.trim(),
        bank_clabe: clabe.trim(),
      });
      setNotice("Datos bancarios actualizados. El inquilino los ve al pagar por transferencia.");
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-sm font-semibold">Datos para transferencia</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Cuenta donde el inquilino deposita la renta. Se muestran en Pagos del portal.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="bank-holder">Titular</Label>
          <Input id="bank-holder" value={holder} maxLength={120} disabled={!canEdit} onChange={(e) => setHolder(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="bank-name">Banco</Label>
          <Input id="bank-name" value={bank} maxLength={120} disabled={!canEdit} onChange={(e) => setBank(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="bank-account">Número de cuenta</Label>
          <Input id="bank-account" value={account} maxLength={32} disabled={!canEdit} onChange={(e) => setAccount(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="bank-clabe">CLABE</Label>
          <Input id="bank-clabe" value={clabe} maxLength={32} disabled={!canEdit} onChange={(e) => setClabe(e.target.value)} />
        </div>
      </div>
      {canEdit && (
        <div className="mt-4">
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Guardando…" : "Guardar datos bancarios"}
          </Button>
        </div>
      )}
      {notice && <p className="mt-3 text-sm text-muted-foreground">{notice}</p>}
    </Card>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
}: {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={autoComplete === "new-password" ? 6 : undefined}
          className="pr-9"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
