import { describe, expect, it } from "vitest";
import {
  ACCOUNT_MISMATCH_ERROR,
  destinationMatches,
  parseAmount,
  interpretReceipt,
  ONE_PAGE_ERROR,
  parseGeminiReceipt,
  pdfPageCount,
  UNREADABLE_ERROR,
} from "./read-receipt";

const encoder = new TextEncoder();

describe("pdfPageCount", () => {
  it("reads the page count from the pages dictionary", () => {
    const pdf = encoder.encode("<< /Type /Pages /Count 2 >>");
    expect(pdfPageCount(pdf)).toBe(2);
  });

  it("counts a single page object", () => {
    const pdf = encoder.encode("<< /Type /Page >>");
    expect(pdfPageCount(pdf)).toBe(1);
  });
});

describe("destination account filter", () => {
  it("matches the last four digits of the account or CLABE", () => {
    expect(destinationMatches("****1234", ["012345678901234567"])).toBe(false);
    expect(destinationMatches("cuenta 9012", ["000000000000009012"])).toBe(true);
    expect(destinationMatches("9012", ["1111", "99999012"])).toBe(true);
  });
});

describe("interpretReceipt", () => {
  const draft = {
    amount: 500,
    paid_on: "2026-04-10",
    payer_bank_name: "BBVA",
    receipt_number: "99",
    reference: "TRX",
    destination_account_digits: "9012",
  };

  it("rejects a destination account that does not match", () => {
    expect(interpretReceipt(draft, ["000000000000001111"])).toEqual({
      ok: false,
      error: ACCOUNT_MISMATCH_ERROR,
    });
  });

  it("fills the form when the account matches", () => {
    const result = interpretReceipt(draft, ["000000000000009012"]);
    expect(result.ok).toBe(true);
  });

  it("skips the account filter when the organization has no account", () => {
    expect(interpretReceipt({ ...draft, destination_account_digits: null }, []).ok).toBe(true);
  });

  it("says so when nothing was read", () => {
    expect(
      interpretReceipt(
        {
          amount: null,
          paid_on: null,
          payer_bank_name: null,
          receipt_number: null,
          reference: null,
          destination_account_digits: null,
        },
        [],
      ),
    ).toEqual({ ok: false, error: UNREADABLE_ERROR });
  });
});

describe("parseAmount", () => {
  it("reads a formatted amount", () => {
    expect(parseAmount("$1,450.00")).toBe(1450);
    expect(parseAmount("1.450,50")).toBe(1450.5);
    expect(parseAmount(1450)).toBe(1450);
  });
});

describe("parseGeminiReceipt", () => {
  it("keeps only the expected fields", () => {
    expect(
      parseGeminiReceipt('{"amount":10.5,"paid_on":"2026-04-01","payer_bank_name":"BBVA","extra":1}'),
    ).toMatchObject({ amount: 10.5, paid_on: "2026-04-01", payer_bank_name: "BBVA", reference: null });
  });
});

describe("one page message", () => {
  it("is the message shown for a multi-page file", () => {
    expect(ONE_PAGE_ERROR).toContain("una sola página");
  });
});
