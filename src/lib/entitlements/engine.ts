import { Prisma, EntitlementStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { calculateEntitlementWindow } from "./calculateWindow";

/**
 * Entitlement rules, spec section 17:
 *
 *   Only verified SUCCESS payments can create/renew access.
 *   When a payment succeeds:
 *     - load package
 *     - calculate entitlement
 *     - persist entitlement transactionally
 *     - record payment linkage
 *     - request network authorization
 *
 *   For renewal:
 *     If the existing entitlement is still active:
 *       new_expiry = existing_expiry + package_duration
 *     Otherwise:
 *       new_start = now, new_expiry = now + package_duration
 *
 *   Do not unnecessarily erase remaining paid time.
 *
 * Design decision (documented, not in the literal spec text — flagged as
 * ASSUMED): each entitlement row is linked to exactly one payment_id
 * (schema section 6 requires this). Renewal therefore creates a NEW
 * entitlement row rather than mutating the previous one, but chains its
 * starts_at onto the previous entitlement's expires_at when that
 * previous entitlement still has unexpired time — so no paid time is
 * lost, and there is still a full audit trail of one entitlement row
 * per payment.
 *
 * "Still active" for stacking purposes means: not REVOKED, not
 * AUTHORIZATION_FAILED, not EXPIRED, and expires_at is in the future.
 * This deliberately includes PENDING_AUTHORIZATION — a customer who paid
 * but whose MikroTik authorization hasn't landed yet (or can't land
 * because Phase F is not yet built) has still bought real time and must
 * not lose it because of an unrelated network-layer delay (section 18).
 */

const STACKABLE_STATUSES: EntitlementStatus[] = ["PENDING_AUTHORIZATION", "ACTIVE"];

export class EntitlementError extends Error {}

/**
 * Creates or renews an entitlement for a payment that has just been
 * verified SUCCESS. Must be called from within the same transaction
 * that transitions the payment to SUCCESS, so the two facts are
 * committed atomically (spec section 14: one successful callback ->
 * one entitlement effect, never two).
 */
export async function activateOrRenewEntitlement(
  paymentId: string,
  tx: Prisma.TransactionClient
) {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    include: { package: true },
  });

  if (!payment) {
    throw new EntitlementError(`activateOrRenewEntitlement: payment ${paymentId} not found`);
  }
  if (payment.status !== "SUCCESS") {
    throw new EntitlementError(
      `activateOrRenewEntitlement: payment ${paymentId} is ${payment.status}, not SUCCESS. ` +
        `Refusing to grant access for an unverified payment.`
    );
  }

  // Idempotency guard: if an entitlement already exists for this payment
  // (e.g. this function was somehow invoked twice for the same payment),
  // return the existing one rather than creating a duplicate.
  const existingForThisPayment = await tx.entitlement.findFirst({
    where: { paymentId: payment.id },
  });
  if (existingForThisPayment) {
    return existingForThisPayment;
  }

  const now = new Date();

  const previousEntitlement = await tx.entitlement.findFirst({
    where: {
      customerId: payment.customerId,
      status: { in: STACKABLE_STATUSES },
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
  });

  const startsAt0 = previousEntitlement ? previousEntitlement.expiresAt : null;
  const { startsAt, expiresAt } = calculateEntitlementWindow(
    now,
    payment.package.durationSeconds,
    startsAt0
  );

  const entitlement = await tx.entitlement.create({
    data: {
      customerId: payment.customerId,
      paymentId: payment.id,
      packageId: payment.packageId,
      startsAt,
      expiresAt,
      status: "PENDING_AUTHORIZATION",
    },
  });

  await writeAuditLog(
    {
      actor: "system:entitlement-engine",
      action: previousEntitlement ? "entitlement.renewed" : "entitlement.created",
      resourceType: "entitlement",
      resourceId: entitlement.id,
      metadata: {
        paymentId: payment.id,
        packageId: payment.packageId,
        startsAt: startsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        stackedOnPreviousEntitlementId: previousEntitlement?.id ?? null,
      },
    },
    tx
  );

  // Phase F (MikroTik authorization) is not built — no real router has
  // been supplied/audited (spec sections 19, 43). The entitlement
  // correctly stays PENDING_AUTHORIZATION until that phase exists and
  // actually authorizes network access. This is not a bug; it's the
  // documented separation of payment state from network authorization
  // state (spec section 18).

  return entitlement;
}

/**
 * Marks entitlements whose expires_at has passed as EXPIRED. Intended to
 * be invoked by a scheduled job (e.g. Vercel Cron) — see
 * src/app/api/admin/system-health/route.ts for the read-side equivalent,
 * and README.md "Deployment" for how to wire the cron trigger. Network
 * revocation (Phase F) is a separate, not-yet-built step; expiring the
 * entitlement record here does not by itself disconnect anyone, per
 * section 18's mandated separation of payment/entitlement state from
 * network enforcement state.
 */
export async function expireStaleEntitlements(): Promise<number> {
  const now = new Date();
  const result = await db.entitlement.updateMany({
    where: {
      status: { in: ["ACTIVE", "PENDING_AUTHORIZATION"] },
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });

  if (result.count > 0) {
    await writeAuditLog({
      actor: "system:entitlement-engine",
      action: "entitlement.batch_expired",
      resourceType: "entitlement",
      metadata: { count: result.count, at: now.toISOString() },
    });
  }

  return result.count;
}

/** Returns the customer's current best entitlement (soonest to expire wins if multiple are somehow active), or null. */
export async function getActiveEntitlementForCustomer(customerId: string) {
  const now = new Date();
  return db.entitlement.findFirst({
    where: {
      customerId,
      status: { in: STACKABLE_STATUSES },
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
    include: { package: true },
  });
}
