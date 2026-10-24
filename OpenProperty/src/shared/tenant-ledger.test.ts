import { describe, expect, it } from "vitest";
import { buildTenantLedger, ledgerPlaces } from "./tenant-ledger";

describe("buildTenantLedger", () => {
  it("raises the balance on a charge and lowers it on a later payment", () => {
    const rows = buildTenantLedger({
      charges: [
        {
          id: "c1",
          due_date: "2026-03-01",
          amount: 1500,
          status: "partial",
          period: "2026-03",
          property_name: "Centro",
          unit_name: "101",
        },
      ],
      payments: [
        {
          id: "p1",
          paid_at: "2026-03-02T18:00:00.000Z",
          amount: 500,
          method: "ach",
          property_name: "Centro",
          unit_name: "101",
        },
      ],
    });

    expect(rows.map((row) => [row.typeLabel, row.source, row.amount, row.balance])).toEqual([
      ["Transferencia", "tenant", 500, 1000],
      ["Renta 2026-03", "owner", 1500, 1500],
    ]);
  });

  it("lists the newest movement first and keeps the balance from the older charge", () => {
    const rows = buildTenantLedger({
      charges: [
        {
          id: "c1",
          due_date: "2026-04-01",
          amount: 100,
          status: "open",
          period: "2026-04",
        },
        {
          id: "c2",
          due_date: "2026-04-01",
          amount: 40,
          status: "waived",
          period: "2026-04",
        },
      ],
      payments: [
        {
          id: "p1",
          paid_at: "2026-04-01",
          amount: 100,
          method: "cash",
        },
        {
          id: "p2",
          paid_at: "2026-04-02",
          amount: 20,
          method: "cash",
          voided_at: "2026-04-03",
          void_reason: "Pago duplicado",
        },
      ],
    });

    expect(rows.map((row) => [row.kind, row.counts, row.balance, row.note])).toEqual([
      ["payment", false, 0, "Anulado: Pago duplicado"],
      ["payment", true, 0, null],
      ["charge", false, 100, "Condonado"],
      ["charge", true, 100, null],
    ]);
  });

  it("lists each property and unit once, in Spanish order", () => {
    expect(
      ledgerPlaces([
        { property_name: "Global Houston", unit_name: "unit_02a" },
        { property_name: "Global Houston", unit_name: "unit_01" },
        { property_name: "Global Houston", unit_name: "unit_01" },
      ]),
    ).toEqual(["Global Houston · unit_01", "Global Houston · unit_02a"]);
  });
});
