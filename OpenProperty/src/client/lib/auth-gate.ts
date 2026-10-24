export type AuthScreen =
  | "loading"
  | "password"
  | "login"
  | "profile-error"
  | "org-gate"
  | "app";

/**
 * The org setup screen is only for a settled session with no membership.
 * While /api/me is in flight, organizationId is still empty — that is not onboarding.
 */
export function resolveAuthScreen(input: {
  loading: boolean;
  profilePending: boolean;
  needsNewPassword: boolean;
  session: boolean;
  devBypass: boolean;
  organizationId: string | null;
  profileError: string | null;
}): AuthScreen {
  const waitingForOrg =
    input.session && !input.devBypass && !input.organizationId && input.profilePending;
  if (input.loading || waitingForOrg) return "loading";
  if (input.needsNewPassword && input.session) return "password";
  if (!input.session && !input.devBypass) return "login";
  if (input.session && !input.devBypass && !input.organizationId) {
    return input.profileError ? "profile-error" : "org-gate";
  }
  return "app";
}
