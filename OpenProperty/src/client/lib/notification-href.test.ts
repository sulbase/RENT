import { describe, expect, it } from "vitest";
import { notificationHref } from "./notification-href";

describe("notificationHref", () => {
  it("opens rent for a receipt review", () => {
    expect(
      notificationHref({
        kind: "payment_receipt",
        entity_type: "payment_submission",
        entity_id: "a",
        period: "submitted",
      }),
    ).toBe("/rent");
  });

  it("opens the lease editor for expiring contracts", () => {
    expect(
      notificationHref({
        kind: "lease_expiring",
        entity_type: "lease",
        entity_id: "00000000-0000-4000-8000-000000000001",
        period: "2026-12-31",
      }),
    ).toBe("/leases/00000000-0000-4000-8000-000000000001/edit");
  });
});