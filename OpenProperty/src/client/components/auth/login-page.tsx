import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { parseAndClearAuthHashError } from "../../lib/auth-redirect";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "../../hooks/use-auth";

type Mode = "signin" | "signup" | "forgot" | "sent";

const RESET_COOLDOWN_MS = 60_000;

export function LoginPage() {
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);

  function resetStillCoolingDown() {
    return sentAt !== null && Date.now() - sentAt < RESET_COOLDOWN_MS;
  }

  function backToSignIn() {
    setMode("signin");
    setPassword("");
    setError(null);
    setNotice(null);
  }

  useEffect(() => {
    const hashError = parseAndClearAuthHashError();
    if (hashError) {
      setError(hashError);
      setNotice("Pide un correo nuevo de confirmación o regístrate de nuevo tras corregir las URLs de redirección.");
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "forgot") {
        if (resetStillCoolingDown()) {
          setMode("sent");
          return;
        }
        await requestPasswordReset(email);
        setSentAt(Date.now());
        setMode("sent");
        return;
      }
      if (mode === "signin") {
        await signIn(email, password);
        return;
      }
      const result = await signUp(email, password);
      if (result === "exists") {
        setMode("signin");
        setPassword("");
        setNotice("Ese correo ya tiene cuenta. Inicia sesión o usa ¿Olvidaste tu contraseña?");
      } else if (result === "confirm_email") {
        setNotice("Cuenta creada. Te enviamos un correo para confirmarla; ábrelo y después inicia sesión.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo autenticar");
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "sent"
      ? "Revisa tu correo"
      : mode === "forgot"
        ? "Recupera tu contraseña"
        : mode === "signin"
          ? "Inicia sesión en tu cuenta"
          : "Crea una cuenta";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">RENT</h1>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
        {mode === "sent" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Si hay una cuenta con ese correo, enviamos un enlace para elegir una contraseña nueva. Ábrelo y sigue las
              instrucciones.
            </p>
            <p className="text-sm text-muted-foreground">
              Si no aparece en tu bandeja en los próximos minutos, revisa la carpeta de spam.
            </p>
            <Button type="button" className="w-full" onClick={backToSignIn}>
              Volver al inicio de sesión
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <div
                  className={cn(
                    "flex h-8 w-full overflow-hidden rounded-sm bg-card shadow-edge transition-shadow duration-150",
                    "focus-within:shadow-[inset_0_0_0_1px_var(--ring),0_0_0_3px_var(--brand-tint)]",
                  )}
                >
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    required
                    minLength={6}
                    className="min-w-0 flex-1 border-0 bg-transparent px-3 text-[0.9375rem] text-foreground outline-none"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="flex w-8 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((open) => !open)}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              </div>
            )}
            {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Espera…" : mode === "forgot" ? "Enviar enlace" : mode === "signin" ? "Entrar" : "Crear cuenta"}
            </Button>
          </form>
        )}
        {mode === "signin" && (
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setError(null);
              setNotice(null);
              setMode(resetStillCoolingDown() ? "sent" : "forgot");
            }}
          >
            ¿Olvidaste tu contraseña?
          </button>
        )}
        {mode !== "sent" && (
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "signin" ? "¿Necesitas una cuenta? Regístrate" : "¿Ya tienes cuenta? Entra"}
          </button>
        )}
      </div>
    </div>
  );
}
