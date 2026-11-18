import { describe, expect, it } from "vitest";
import type { Sql } from "../db";
import {
  formatNoticeDate,
  formatNoticeMoney,
  generateLateNotices,
  groupLateNotices,
  PORTAL_PAYMENTS_URL,
  type LateNoticeCharge,
} from "./late-notice";

const ORG = "10000000-0000-4000-8000-000000000001";
const TENANT = "20000000-0000-4000-8000-00000000000a";

function charge(overrides: Partial<LateNoticeCharge> = {}): LateNoticeCharge {
  return {
    organizationId: ORG,
    tenantId: TENANT,
    userId: "30000000-0000-4000-8000-00000000000a",
    tenantName: "Kenneth P Alvear",
    organizationName: "GSH Houston at U of H",
    dueDate: "2026-08-02",
    daysLate: 0,
    balance: 1052.09,
    unitName: "335",
    propertyName: "Scott",
    address: "2519 Scott St.",
    city: "Houston",
    state: "TX",
    zip: "77004",
    currency: "USD",
    dateFormat: "MM/dd/yyyy",
    noticeDate: "2026-08-02",
    ...overrides,
  };
}

describe("late notice letters", () => {
  it("formats the notice date and the balance with cents", () => {
    expect(formatNoticeDate("2026-08-02", "MM/dd/yyyy")).toBe("08/02/2026");
    expect(formatNoticeDate("2026-08-02", "dd/MM/yyyy")).toBe("02/08/2026");
    expect(formatNoticeMoney(1052.09, "USD")).toContain("1,052.09");
  });

  it("puts every unit due that day in one letter", () => {
    const drafts = groupLateNotices([
      charge(),
      charge({
        balance: 800,
        unitName: "210",
        propertyName: "Main",
        address: "1800 Main St.",
        city: "Houston",
        state: "TX",
        zip: "77002",
      }),
      charge({ dueDate: "2026-08-05", daysLate: 0, noticeDate: "2026-08-05", unitName: "otro" }),
    ]);
    expect(drafts).toHaveLength(2);
    const sameDay = drafts.find((draft) => draft.dueDate === "2026-08-02");
    expect(sameDay).toMatchObject({ stage: 1, title: "Primer aviso de mora", period: "1:2026-08-02" });
    expect(sameDay?.body).toContain("Fecha del aviso: 08/02/2026");
    expect(sameDay?.body).toContain("Entregar a: Kenneth P Alvear");
    expect(sameDay?.body).toContain("2519 Scott St.");
    expect(sameDay?.body).toContain("Unidad: 335");
    expect(sameDay?.body).toContain("1800 Main St.");
    expect(sameDay?.body).toContain("Unidad: 210");
    expect(sameDay?.body).toContain("1,852.09");
    expect(sameDay?.body).toContain("Según nuestros registros");
    expect(sameDay?.body).toContain(PORTAL_PAYMENTS_URL);
    expect(sameDay?.body).toContain("Atentamente,");
    expect(sameDay?.body).toContain("GSH Houston at U of H");
  });

  it("uses the second and third titles on the following days and skips a paid line", () => {
    const drafts = groupLateNotices([
      charge({ daysLate: 1, noticeDate: "2026-08-03" }),
      charge({ daysLate: 2, noticeDate: "2026-08-04", balance: 0 }),
      charge({ daysLate: 5 }),
    ]);
    expect(drafts.map((draft) => draft.title)).toEqual(["Segundo aviso de mora"]);
    expect(drafts[0]?.period).toBe("2:2026-08-02");
    expect(drafts[0]?.body).toContain("Fecha del aviso: 08/03/2026");
  });

  it("adds the balances of two charges on the same unit", () => {
    const [draft] = groupLateNotices([
      charge({ balance: 500 }),
      charge({ balance: 25.5 }),
    ]);
    expect(draft?.body.match(/Unidad: 335/g)).toHaveLength(1);
    expect(draft?.body).toContain("525.50");
  });

  it("inserts one notification per letter and ignores a repeated stage", async () => {
    const inserted: unknown[][] = [];
    const sql = {
      unsafe: async (text: string, params: unknown[] = []) => {
        if (text.includes("FROM rent_charges")) {
          return [
            {
              organization_id: ORG,
              tenant_id: TENANT,
              user_id: null,
              tenant_name: "Kenneth P Alvear",
              organization_name: "GSH Houston at U of H",
              due_date: "2026-08-02",
              days_late: 0,
              balance: "1052.09",
              unit_name: "335",
              property_name: "Scott",
              address: "2519 Scott St.",
              city: "Houston",
              state: "TX",
              zip: "77004",
              currency: "USD",
              date_format: "MM/dd/yyyy",
              notice_date: "2026-08-02",
            },
            {
              organization_id: ORG,
              tenant_id: TENANT,
              user_id: null,
              tenant_name: "Kenneth P Alvear",
              organization_name: "GSH Houston at U of H",
              due_date: "2026-08-02",
              days_late: 0,
              balance: "800.00",
              unit_name: "210",
              property_name: "Main",
              address: "1800 Main St.",
              city: "Houston",
              state: "TX",
              zip: "77002",
              currency: "USD",
              date_format: "MM/dd/yyyy",
              notice_date: "2026-08-02",
            },
          ];
        }
        if (text.includes("INSERT INTO notifications")) {
          inserted.push(params);
          return inserted.length === 1 ? [{ id: "new" }] : [];
        }
        return [];
      },
    } as unknown as Sql;

    await expect(generateLateNotices(sql)).resolves.toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.[2]).toBe("rent_late_notice");
    expect(inserted[0]?.[6]).toBe("tenant");
    expect(inserted[0]?.[7]).toBe(TENANT);
    expect(inserted[0]?.[8]).toBe("1:2026-08-02");
    expect(String(inserted[0]?.[4])).toContain("Unidad: 335");
    expect(String(inserted[0]?.[4])).toContain("Unidad: 210");
  });
});
