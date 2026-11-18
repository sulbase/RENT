import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, LogOut, Pencil } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usePortal } from "./portal-context";
import type { PortalLease } from "./portal-types";

function formatCurrentAddress(leases: PortalLease[]): string {
  if (leases.length === 0) return "—";
  const lines = leases.map((lease) => {
    const street = [lease.address, lease.unit_name ? `Unidad ${lease.unit_name}` : null]
      .filter(Boolean)
      .join(" · ");
    const locality = [lease.city, lease.property_name].filter(Boolean).join(", ");
    return [street, locality].filter(Boolean).join("\n");
  });
  return lines.join("\n\n");
}

function passwordChecks(password: string) {
  return {
    length: password.length >= 8,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

function passwordValid(password: string): boolean {
  return Object.values(passwordChecks(password)).every(Boolean);
}

export function PortalSettingsPage() {
  const { home } = usePortal();
  const auth = useAuth();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [preferredOpen, setPreferredOpen] = useState(false);

  if (!home) return null;

  const { tenant } = home;
  const name = [tenant.first_name, tenant.last_name].filter(Boolean).join(" ");
  const metadata = auth.user?.user_metadata as { display_name?: string } | undefined;
  const preferredName = metadata?.display_name?.trim() ?? "";
  const email = tenant.email ?? auth.user?.email ?? "—";
  const phone = tenant.phone?.trim() ?? "";

  return (
    <PageShell title="Ajustes" meta={tenant.organization_name} width="max-w-5xl" notifications={false}>
      <div className="max-w-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">{name || "—"}</h2>
          <button
            type="button"
            className="cursor-pointer text-sm text-sky-400 hover:underline"
            onClick={() => setPasswordOpen(true)}
          >
            Actualizar contraseña
          </button>
        </div>

        <div className="mt-8">
          <p className="text-sm text-muted-foreground">Dirección actual</p>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{formatCurrentAddress(home.leases)}</p>
        </div>

        <hr className="my-8 border-white/10" />

        <p className="text-sm">{email}</p>

        <div className="mt-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm">Nombre preferido</p>
            <p className={cn("mt-1 text-sm", preferredName ? "" : "italic text-muted-foreground")}>
              {preferredName || "No se agregó ningún nombre preferido"}
            </p>
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-md p-2 text-sky-400 hover:bg-[#2a2928]"
            aria-label="Editar nombre preferido"
            onClick={() => setPreferredOpen(true)}
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-8">
          <p className="text-sm">Teléfono principal</p>
          <p className="mt-1 text-sm">
            {phone || "—"}
            {phone ? <span className="ml-2 italic text-muted-foreground">Móvil</span> : null}
          </p>
        </div>
      </div>

      <div className="mt-10 md:hidden">
        <Button type="button" variant="outline" className="w-full" onClick={() => void auth.signOut()}>
          <LogOut className="size-4" aria-hidden />
          Cerrar sesión
        </Button>
      </div>

      <UpdatePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <PreferredNameDialog
        open={preferredOpen}
        initial={preferredName}
        onOpenChange={setPreferredOpen}
        onSave={(value) => auth.updateDisplayName(value)}
      />
    </PageShell>
  );
}

function PasswordRequirement({ met, label }: { met: boolean; label: string }) {
  return (
    <li className={cn("flex items-center gap-2", met ? "text-success" : "text-muted-foreground")}>
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          met ? "border-success bg-success/15" : "border-muted-foreground/40",
        )}
        aria-hidden
      >
        {met ? <Check className="size-3 stroke-[3]" /> : null}
      </span>
      <span>{label}</span>
    </li>
  );
}

function PortalPasswordField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  autoComplete: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div
      className={cn(
        "rounded-md border px-3 pb-3 pt-2",
        error ? "border-destructive-solid" : "border-white/25",
      )}
    >
      <label htmlFor={id} className="block text-xs text-foreground">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          onClick={() => setVisible((open) => !open)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-destructive-solid">{error}</p> : null}
    </div>
  );
}

function UpdatePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const auth = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrent("");
      setNext("");
      setCurrentError(null);
      setFormError(null);
    }
  }, [open]);

  const checks = passwordChecks(next);
  const canSave = current.trim() !== "" && passwordValid(next);

  async function save() {
    if (!current.trim()) {
      setCurrentError("Campo obligatorio");
      return;
    }
    setCurrentError(null);
    if (!passwordValid(next)) {
      setFormError("La nueva contraseña no cumple los requisitos.");
      return;
    }
    if (next === current) {
      setFormError("La nueva contraseña debe ser distinta de la actual.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await auth.updatePassword(next, current);
      onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo actualizar la contraseña");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Actualizar contraseña</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <PortalPasswordField
            id="portal-pw-current"
            label="Contraseña actual"
            autoComplete="current-password"
            value={current}
            error={currentError}
            onChange={(value) => {
              setCurrent(value);
              if (value.trim()) setCurrentError(null);
            }}
          />
          <PortalPasswordField
            id="portal-pw-new"
            label="Nueva contraseña"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
          />
          <ul className="space-y-1.5 text-sm">
            <PasswordRequirement met={checks.length} label="Debe incluir al menos 8 caracteres" />
            <PasswordRequirement met={checks.lower} label="1 letra minúscula" />
            <PasswordRequirement met={checks.upper} label="1 letra mayúscula" />
            <PasswordRequirement met={checks.digit} label="1 número" />
            <PasswordRequirement met={checks.special} label="1 carácter especial" />
          </ul>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button
            type="button"
            className="w-full rounded-full bg-[#9eb3bc] font-semibold text-[#100f0e] hover:bg-[#8da5ae]"
            disabled={saving || !canSave}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreferredNameDialog({
  open,
  initial,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initial: string;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nombre preferido</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="preferred-name">Nombre</Label>
            <Input
              id="preferred-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" className="w-full rounded-full" disabled={saving} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
