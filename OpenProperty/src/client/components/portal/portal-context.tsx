import { createContext, useContext } from "react";
import type { AppSettings } from "@/hooks/use-app-state";
import type { PortalHome } from "./portal-types";

export type PortalState = {
  home: PortalHome | null;
  settings: AppSettings;
  location: string;
  reload: () => Promise<void>;
  navigate: (to: string) => void;
};

export const PortalContext = createContext<PortalState | null>(null);

export function usePortal(): PortalState {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used within PortalShell");
  return ctx;
}
