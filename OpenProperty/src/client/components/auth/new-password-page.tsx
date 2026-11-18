import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/use-auth";
import { Button } from "../ui/button";
import { Label } from "../ui/label";

function PasswordField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div
        className={cn(
          "flex h-8 w-full overflow-hidden rounded-sm bg-card shadow-edge transition-shadow duration-150",
          "focus-within:shadow-[inset_0_0_0_1px_var(--ring),0_0_0_3px_var(--brand-tint)]",
        )}
      >
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={6}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[0.9375rem] text-foreground outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="flex w-8 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          onClick={() => setVisible((open) => !open)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

export function NewPasswordPage() {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la contraseña");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">RENT</h1>
          <p className="text-sm text-muted-foreground">Elige una contraseña nueva</p>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <PasswordField id="new-password" label="Contraseña nueva" value={password} onChange={setPassword} />
          <PasswordField id="confirm-password" label="Confirmar" value={confirm} onChange={setConfirm} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Espera…" : "Guardar contraseña"}
          </Button>
        </form>
        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => void signOut()}
        >
          Cancelar y cerrar sesión
        </button>
      </div>
    </div>
  );
}
