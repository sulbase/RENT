export type AuthScreen =
  | "loading"
  | "password"
  | "login"
  | "profile-error"
  | "org-gate"
  | "portal"
  | "app";

/**
 * The org setup screen is only for a settled session with no membership and no tenant link.
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
  portal?: boolean;
}): AuthScreen {
  const waitingForOrg =
    input.session &&
    !input.devBypass &&
    !input.organizationId &&
    !input.portal &&
    input.profilePending;
  if (input.loading || waitingForOrg) return "loading";
  if (input.needsNewPassword && input.session) return "password";
  if (!input.session && !input.devBypass) return "login";
  if (input.session && !input.devBypass && !input.organizationId) {
    if (input.profileError) return "profile-error";
    return input.portal ? "portal" : "org-gate";
  }
  return "app";
}
