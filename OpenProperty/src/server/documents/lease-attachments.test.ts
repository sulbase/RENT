import { describe, expect, it } from "vitest";
import { normalizeLeaseAttachmentKinds, parseLeaseAttachmentKinds } from "./lease-attachments";

describe("lease attachment kinds", () => {
  it("keeps a JSON list of extra labels for one organization", () => {
    const saved = normalizeLeaseAttachmentKinds([" Medidor ", "Antes"]);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(parseLeaseAttachmentKinds(JSON.stringify(saved.kinds))).toEqual(["Medidor", "Antes"]);
  });

  it("rejects the fixed Imagen and Factura labels", () => {
    expect(normalizeLeaseAttachmentKinds(["Factura"]).ok).toBe(false);
    expect(parseLeaseAttachmentKinds('["Imagen"]')).toEqual([]);
  });
});
