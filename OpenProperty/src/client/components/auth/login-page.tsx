import { useEffect, useState } from "react";
import { parseAndClearAuthHashError } from "../../lib/auth-redirect";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useAuth } from "../../hooks/use-auth";

type Mode = "signin" | "signup" | "forgot";

export function LoginPage() {
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        await requestPasswordReset(email);
        setNotice("Si hay una cuenta con ese correo, enviamos un enlace para elegir una contraseña nueva.");
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
    mode === "forgot" ? "Recupera tu contraseña" : mode === "signin" ? "Inicia sesión en tu cuenta" : "Crea una cuenta";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">RENT</h1>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
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
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Espera…" : mode === "forgot" ? "Enviar enlace" : mode === "signin" ? "Entrar" : "Crear cuenta"}
          </Button>
        </form>
        {mode === "signin" && (
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setMode("forgot");
              setError(null);
              setNotice(null);
            }}
          >
            ¿Olvidaste tu contraseña?
          </button>
        )}
        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup");
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "signup" ? "¿Ya tienes cuenta? Entra" : "¿Necesitas una cuenta? Regístrate"}
        </button>
      </div>
    </div>
  );
}
