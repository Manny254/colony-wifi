import { describe, it, expect } from "vitest";
import { calculateEntitlementWindow } from "@/lib/entitlements/calculateWindow";

describe("calculateEntitlementWindow", () => {
  it("starts a fresh window from now when there is no previous unexpired entitlement", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const { startsAt, expiresAt } = calculateEntitlementWindow(now, 3600, null);
    expect(startsAt).toEqual(now);
    expect(expiresAt).toEqual(new Date("2026-09-03T13:00:00Z"));
  });

  it("stacks onto the previous entitlement's expiry rather than losing paid time (spec section 17)", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const previousExpiry = new Date("2026-09-03T14:00:00Z"); // still 2h of paid time remaining
    const { startsAt, expiresAt } = calculateEntitlementWindow(now, 3600, previousExpiry);
    expect(startsAt).toEqual(previousExpiry);
    expect(expiresAt).toEqual(new Date("2026-09-03T15:00:00Z"));
  });

  it("a 7-day package renewal correctly adds 604800 seconds", () => {
    const now = new Date("2026-09-03T00:00:00Z");
    const previousExpiry = new Date("2026-09-05T00:00:00Z");
    const { expiresAt } = calculateEntitlementWindow(now, 7 * 24 * 60 * 60, previousExpiry);
    expect(expiresAt).toEqual(new Date("2026-09-12T00:00:00Z"));
  });

  it("expiresAt is always strictly after startsAt for any positive duration", () => {
    const now = new Date();
    const { startsAt, expiresAt } = calculateEntitlementWindow(now, 60, null);
    expect(expiresAt.getTime()).toBeGreaterThan(startsAt.getTime());
  });
});
