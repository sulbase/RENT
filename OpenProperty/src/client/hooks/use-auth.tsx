import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { api } from "../api";
import { getEmailRedirectUrl, peekAuthCallbackType } from "../lib/auth-redirect";
import { establishSessionFromUrl } from "../lib/auth-session";
import { authConfigured, getSupabase } from "../lib/supabase";
import { getStoredOrganizationId, setStoredOrganizationId } from "../lib/session";

export type MembershipInfo = {
  organization_id: string;
  name: string;
  slug: string;
  role: string;
};

/**
 * `exists`: Supabase answers a sign-up for a registered email with a user that has no
 * identities and sends no email, so the address cannot be probed.
 */
export type SignUpResult = "signed_in" | "confirm_email" | "exists";

/** The tenant record this account opens in the portal. */
export type PortalInfo = {
  tenant_id: string;
  organization_id: string;
  organization_name: string;
  display_name: string;
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  memberships: MembershipInfo[];
  organizationId: string | null;
  role: string | null;
  portal: PortalInfo | null;
  /** Set when /api/me fails. Distinct from having no membership. */
  profileError: string | null;
  /** True while /api/me is in flight. Empty organizationId during this window is not onboarding. */
  profilePending: boolean;
  devBypass: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  needsNewPassword: boolean;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string, currentPassword?: string) => Promise<void>;
  updateEmail: (email: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  setActiveOrganization: (organizationId: string) => Promise<void>;
  bootstrapOrganization: (name: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(authConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<MembershipInfo[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [portal, setPortal] = useState<PortalInfo | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profilePending, setProfilePending] = useState(false);
  const [devBypass, setDevBypass] = useState(!authConfigured);
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const profileRequest = useRef(0);

  const refreshProfile = useCallback(async (knownSession?: Session | null) => {
    if (!authConfigured) {
      setDevBypass(true);
      setProfilePending(false);
      setLoading(false);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setProfilePending(false);
      setLoading(false);
      return;
    }

    const requestId = ++profileRequest.current;
    const current =
      knownSession !== undefined ? knownSession : (await supabase.auth.getSession()).data.session;
    if (requestId !== profileRequest.current) return;

    setSession(current);

    if (!current) {
      setMemberships([]);
      setOrganizationId(null);
      setRole(null);
      setPortal(null);
      setProfileError(null);
      setProfilePending(false);
      setLoading(false);
      return;
    }

    setProfilePending(true);
    const storedOrg = getStoredOrganizationId();
    try {
      const me = await api<{
        mode: string;
        memberships: MembershipInfo[];
        organization_id: string | null;
        role: string | null;
        portal?: PortalInfo | null;
      }>("GET", "/api/me", undefined, {
        accessToken: current.access_token,
        organizationId: storedOrg,
      });
      if (requestId !== profileRequest.current) return;

      if (me.mode === "dev_bypass") {
        setDevBypass(true);
        setProfileError(null);
        setOrganizationId(me.organization_id);
        setRole(me.role);
        setMemberships([]);
        setPortal(null);
        return;
      }

      setDevBypass(false);
      setProfileError(null);
      setPortal(me.portal ?? null);
      const list = me.memberships ?? [];
      setMemberships(list);

      let active = me.organization_id;
      if (!active && list.length === 1) {
        active = list[0].organization_id;
        setStoredOrganizationId(active);
      }
      if (!active && storedOrg && list.some((m) => m.organization_id === storedOrg)) {
        active = storedOrg;
      }

      setOrganizationId(active);
      setRole(me.role ?? (active && list.length === 1 ? list[0].role : null));
    } catch (err) {
      if (requestId !== profileRequest.current) return;
      setProfileError(err instanceof Error ? err.message : "No se pudo cargar la sesión");
    } finally {
      if (requestId === profileRequest.current) {
        setProfilePending(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!authConfigured) {
      setLoading(false);
      return;
    }
    const supabase = getSupabase()!;
    void (async () => {
      const callbackType = peekAuthCallbackType();
      await establishSessionFromUrl(supabase);
      if (callbackType === "recovery") setNeedsNewPassword(true);
      await refreshProfile();
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setNeedsNewPassword(true);
      if (event === "SIGNED_OUT") setNeedsNewPassword(false);
      void refreshProfile(nextSession);
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Auth not configured");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await refreshProfile(data.session);
  }, [refreshProfile]);

  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Auth not configured");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: getEmailRedirectUrl() },
    });
    if (error) throw error;
    if (data.session) {
      await refreshProfile(data.session);
      return "signed_in";
    }
    if (data.user && data.user.identities?.length === 0) return "exists";
    return "confirm_email";
  }, [refreshProfile]);

  const clearLocalSession = useCallback(() => {
    setNeedsNewPassword(false);
    setProfileError(null);
    setStoredOrganizationId(null);
    setSession(null);
    setMemberships([]);
    setOrganizationId(null);
    setRole(null);
    setPortal(null);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    clearLocalSession();
  }, [clearLocalSession]);

  const signOutEverywhere = useCallback(async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut({ scope: "global" });
    clearLocalSession();
  }, [clearLocalSession]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Auth not configured");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getEmailRedirectUrl(),
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string, currentPassword?: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Auth not configured");
    if (currentPassword !== undefined) {
      const { data, error: userError } = await supabase.auth.getUser();
      const email = data.user?.email;
      if (userError || !email) throw new Error("No hay una sesión activa.");
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInError) throw new Error("La contraseña actual no es correcta.");
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setNeedsNewPassword(false);
  }, []);

  const updateEmail = useCallback(async (email: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Auth not configured");
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: getEmailRedirectUrl() },
    );
    if (error) throw error;
  }, []);

  const updateDisplayName = useCallback(async (name: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Auth not configured");
    const { data, error } = await supabase.auth.updateUser({ data: { display_name: name } });
    if (error) throw error;
    if (data.user) {
      setSession((current) => (current ? { ...current, user: data.user } : current));
    }
  }, []);

  const setActiveOrganization = useCallback(
    async (id: string) => {
      if (!session) return;
      setStoredOrganizationId(id);
      await api("PUT", "/api/auth/active-organization", { organization_id: id }, {
        accessToken: session.access_token,
        organizationId: id,
      });
      await refreshProfile();
    },
    [session, refreshProfile],
  );

  const bootstrapOrganization = useCallback(
    async (name: string) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("Auth not configured");
      await establishSessionFromUrl(supabase);
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Sign in required");
      const res = await api<{ organization: { id: string } }>(
        "POST",
        "/api/auth/bootstrap",
        { name },
        { accessToken },
      );
      setStoredOrganizationId(res.organization.id);
      await refreshProfile();
    },
    [refreshProfile],
  );

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      memberships,
      organizationId,
      role,
      portal,
      profileError,
      profilePending,
      devBypass,
      signIn,
      signUp,
      signOut,
      signOutEverywhere,
      needsNewPassword,
      requestPasswordReset,
      updatePassword,
      updateEmail,
      updateDisplayName,
      refreshProfile,
      setActiveOrganization,
      bootstrapOrganization,
    }),
    [
      loading,
      session,
      memberships,
      organizationId,
      role,
      portal,
      profileError,
      profilePending,
      devBypass,
      signIn,
      signUp,
      signOut,
      signOutEverywhere,
      needsNewPassword,
      requestPasswordReset,
      updatePassword,
      updateEmail,
      updateDisplayName,
      refreshProfile,
      setActiveOrganization,
      bootstrapOrganization,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
