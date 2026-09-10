/**
 * Pure calculation, spec section 17:
 *   If the existing entitlement is still active:
 *     new_expiry = existing_expiry + package_duration
 *   Otherwise:
 *     new_start = now, new_expiry = now + package_duration
 *
 * Extracted from engine.ts so this exact formula is unit-testable
 * without a database connection.
 */
export interface EntitlementWindow {
  startsAt: Date;
  expiresAt: Date;
}

export function calculateEntitlementWindow(
  now: Date,
  durationSeconds: number,
  previousUnexpiredExpiry: Date | null
): EntitlementWindow {
  const startsAt = previousUnexpiredExpiry ?? now;
  const expiresAt = new Date(startsAt.getTime() + durationSeconds * 1000);
  return { startsAt, expiresAt };
}
