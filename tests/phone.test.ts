import { describe, it, expect } from "vitest";
import { normalizeKenyanPhone, toLocalDisplayFormat, toDarajaWireFormat } from "@/lib/phone";

describe("normalizeKenyanPhone", () => {
  it("normalizes local 07XX format", () => {
    const r = normalizeKenyanPhone("0712345678");
    expect(r).toEqual({ ok: true, value: "+254712345678" });
  });

  it("normalizes local 01XX format", () => {
    const r = normalizeKenyanPhone("0112345678");
    expect(r).toEqual({ ok: true, value: "+254112345678" });
  });

  it("normalizes 254XXXXXXXXX without plus", () => {
    const r = normalizeKenyanPhone("254712345678");
    expect(r).toEqual({ ok: true, value: "+254712345678" });
  });

  it("normalizes +254XXXXXXXXX", () => {
    const r = normalizeKenyanPhone("+254712345678");
    expect(r).toEqual({ ok: true, value: "+254712345678" });
  });

  it("strips spaces and dashes", () => {
    const r = normalizeKenyanPhone("0712 345 678");
    expect(r).toEqual({ ok: true, value: "+254712345678" });
    const r2 = normalizeKenyanPhone("0712-345-678");
    expect(r2).toEqual({ ok: true, value: "+254712345678" });
  });

  it("normalizes bare 9-digit form starting with 7", () => {
    const r = normalizeKenyanPhone("712345678");
    expect(r).toEqual({ ok: true, value: "+254712345678" });
  });

  it("rejects too-short input", () => {
    const r = normalizeKenyanPhone("0712345");
    expect(r.ok).toBe(false);
  });

  it("rejects non-Kenyan prefixes", () => {
    const r = normalizeKenyanPhone("+15551234567");
    expect(r.ok).toBe(false);
  });

  it("rejects empty string", () => {
    const r = normalizeKenyanPhone("");
    expect(r.ok).toBe(false);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error deliberately wrong type
    const r = normalizeKenyanPhone(712345678);
    expect(r.ok).toBe(false);
  });

  it("rejects a Kenyan-length number with an invalid leading digit", () => {
    const r = normalizeKenyanPhone("0512345678");
    expect(r.ok).toBe(false);
  });
});

describe("toLocalDisplayFormat", () => {
  it("converts +254712345678 back to 0712345678", () => {
    expect(toLocalDisplayFormat("+254712345678")).toBe("0712345678");
  });

  it("passes through malformed input unchanged", () => {
    expect(toLocalDisplayFormat("garbage")).toBe("garbage");
  });
});

describe("toDarajaWireFormat", () => {
  it("strips the + for Daraja's wire format", () => {
    expect(toDarajaWireFormat("+254712345678")).toBe("254712345678");
  });

  it("throws on a non-normalized value rather than guessing", () => {
    expect(() => toDarajaWireFormat("0712345678")).toThrow();
  });
});
