import { describe, it, expect } from "vitest";
import {
  parseCallbackMetadata,
  parseDarajaTransactionDate,
} from "@/lib/daraja/types";
import { darajaTimestamp } from "@/lib/daraja/timestamp";

describe("parseCallbackMetadata", () => {
  it("extracts amount, receipt, date, phone from a successful callback", () => {
    const result = parseCallbackMetadata({
      MerchantRequestID: "m1",
      CheckoutRequestID: "c1",
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: 50 },
          { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
          { Name: "TransactionDate", Value: 20260903143000 },
          { Name: "PhoneNumber", Value: 254712345678 },
        ],
      },
    });

    expect(result).toEqual({
      amount: 50,
      mpesaReceiptNumber: "NLJ7RT61SV",
      transactionDate: "20260903143000",
      phoneNumber: "254712345678",
    });
  });

  it("returns all-undefined fields when CallbackMetadata is absent (failed/cancelled payment)", () => {
    const result = parseCallbackMetadata({
      MerchantRequestID: "m1",
      CheckoutRequestID: "c1",
      ResultCode: 1032,
      ResultDesc: "Request cancelled by user",
    });

    expect(result).toEqual({
      amount: undefined,
      mpesaReceiptNumber: undefined,
      transactionDate: undefined,
      phoneNumber: undefined,
    });
  });

  it("handles a subset of expected items gracefully", () => {
    const result = parseCallbackMetadata({
      MerchantRequestID: "m1",
      CheckoutRequestID: "c1",
      ResultCode: 0,
      ResultDesc: "ok",
      CallbackMetadata: { Item: [{ Name: "Amount", Value: 10 }] },
    });
    expect(result.amount).toBe(10);
    expect(result.mpesaReceiptNumber).toBeUndefined();
  });
});

describe("parseDarajaTransactionDate", () => {
  it("converts Daraja's EAT-local YYYYMMDDHHmmss to correct UTC", () => {
    // 14:30:00 in Nairobi (UTC+3) is 11:30:00 UTC.
    const result = parseDarajaTransactionDate("20260903143000");
    expect(result).toEqual(new Date("2026-09-03T11:30:00.000Z"));
  });

  it("returns null for malformed input rather than throwing or guessing", () => {
    expect(parseDarajaTransactionDate("not-a-date")).toBeNull();
    expect(parseDarajaTransactionDate("2026090314300")).toBeNull(); // 13 digits
    expect(parseDarajaTransactionDate("")).toBeNull();
  });
});

describe("darajaTimestamp", () => {
  it("formats as YYYYMMDDHHmmss with EAT (UTC+3) offset applied", () => {
    // Midnight UTC on 2026-09-03 is 03:00:00 in Nairobi.
    const ts = darajaTimestamp(new Date("2026-09-03T00:00:00.000Z"));
    expect(ts).toBe("20260903030000");
  });

  it("rolls over to the next day correctly near midnight EAT", () => {
    // 21:30 UTC on Sep 2 is 00:30 EAT on Sep 3.
    const ts = darajaTimestamp(new Date("2026-09-02T21:30:00.000Z"));
    expect(ts).toBe("20260903003000");
  });

  it("always produces exactly 14 digits", () => {
    const ts = darajaTimestamp(new Date());
    expect(ts).toMatch(/^\d{14}$/);
  });
});
