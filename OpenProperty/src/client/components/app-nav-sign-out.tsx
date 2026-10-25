import { LogOut } from "lucide-react";

export function AppNavSignOut({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  return (
    <button type="button" className="cn-nav-item w-full text-left" onClick={() => void onSignOut()}>
      <LogOut className="size-4 shrink-0 opacity-70" aria-hidden />
      <span className="cn-nav-label">Cerrar sesión</span>
    </button>
  );
}
