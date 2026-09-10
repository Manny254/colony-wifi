import { describe, it, expect } from "vitest";
import { checkTransition } from "@/lib/payments/stateMachine";

describe("payment state machine", () => {
  it("allows PENDING -> SUCCESS", () => {
    expect(checkTransition("PENDING", "SUCCESS")).toEqual({ allowed: true, isNoOp: false });
  });

  it("allows PENDING -> FAILED / CANCELLED / TIMEOUT / RECONCILIATION_REQUIRED", () => {
    for (const target of ["FAILED", "CANCELLED", "TIMEOUT", "RECONCILIATION_REQUIRED"] as const) {
      expect(checkTransition("PENDING", target)).toEqual({ allowed: true, isNoOp: false });
    }
  });

  it("allows TIMEOUT -> SUCCESS (late callback resolves a timeout)", () => {
    expect(checkTransition("TIMEOUT", "SUCCESS")).toEqual({ allowed: true, isNoOp: false });
  });

  it("allows TIMEOUT -> FAILED and TIMEOUT -> RECONCILIATION_REQUIRED", () => {
    expect(checkTransition("TIMEOUT", "FAILED")).toEqual({ allowed: true, isNoOp: false });
    expect(checkTransition("TIMEOUT", "RECONCILIATION_REQUIRED")).toEqual({
      allowed: true,
      isNoOp: false,
    });
  });

  it("allows RECONCILIATION_REQUIRED to resolve to SUCCESS / FAILED / CANCELLED", () => {
    for (const target of ["SUCCESS", "FAILED", "CANCELLED"] as const) {
      expect(checkTransition("RECONCILIATION_REQUIRED", target)).toEqual({
        allowed: true,
        isNoOp: false,
      });
    }
  });

  it("never allows SUCCESS to be downgraded to anything else", () => {
    for (const target of [
      "PENDING",
      "FAILED",
      "CANCELLED",
      "TIMEOUT",
      "RECONCILIATION_REQUIRED",
    ] as const) {
      expect(checkTransition("SUCCESS", target).allowed).toBe(false);
    }
  });

  it("never allows FAILED or CANCELLED to transition anywhere", () => {
    for (const from of ["FAILED", "CANCELLED"] as const) {
      for (const target of [
        "PENDING",
        "SUCCESS",
        "TIMEOUT",
        "RECONCILIATION_REQUIRED",
      ] as const) {
        expect(checkTransition(from, target).allowed).toBe(false);
      }
    }
  });

  it("treats re-applying the same status as an allowed no-op, for every status", () => {
    const all = [
      "PENDING",
      "SUCCESS",
      "FAILED",
      "CANCELLED",
      "TIMEOUT",
      "RECONCILIATION_REQUIRED",
    ] as const;
    for (const s of all) {
      expect(checkTransition(s, s)).toEqual({ allowed: true, isNoOp: true });
    }
  });

  it("rejects an illegal transition and reports why", () => {
    const result = checkTransition("SUCCESS", "FAILED");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/SUCCESS -> FAILED/);
    }
  });
});
