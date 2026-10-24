import { describe, expect, it } from "vitest";
import { resolveAuthScreen } from "./auth-gate";

const base = {
  loading: false,
  profilePending: false,
  needsNewPassword: false,
  session: true,
  devBypass: false,
  organizationId: null as string | null,
  profileError: null as string | null,
};

describe("resolveAuthScreen", () => {
  it("keeps the loader while the signed-in profile is still loading", () => {
    expect(resolveAuthScreen({ ...base, profilePending: true })).toBe("loading");
  });

  it("opens the app when the account already has an organization", () => {
    expect(
      resolveAuthScreen({
        ...base,
        organizationId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toBe("app");
  });

  it("asks to create an organization only after the profile confirms there is none", () => {
    expect(resolveAuthScreen(base)).toBe("org-gate");
  });

  it("does not treat a profile error as a new organization", () => {
    expect(resolveAuthScreen({ ...base, profileError: "falló" })).toBe("profile-error");
  });

  it("sends a linked tenant to the portal instead of organization setup", () => {
    expect(resolveAuthScreen({ ...base, portal: true })).toBe("portal");
  });

  it("keeps the staff panel when the account also has an organization", () => {
    expect(
      resolveAuthScreen({
        ...base,
        portal: true,
        organizationId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toBe("app");
  });
});
