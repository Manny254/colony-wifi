import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { queryStkStatus } from "@/lib/daraja/stkPush";
import { resolvePaymentOutcome, type ResolveOutcome } from "./resolveOutcome";

/**
 * Spec section 15: do not treat a frontend polling timeout as payment
 * failure. Use it for: callback missing, ambiguous response, delayed
 * callback, operational reconciliation. Bounded retries/backoff, not
 * continuous hammering.
 *
 * A payment is eligible for reconciliation once it has sat in PENDING
 * (no callback ever arrived) or TIMEOUT for at least this long. This
 * is deliberately conservative — Daraja's own STK prompt can take up
 * to ~60-90s for the customer to act on, so reconciling too early would
 * just get "still pending" back from Safaricom and waste a call.
 */
const MIN_AGE_BEFORE_RECONCILE_MS = 90_000;

export type ReconcileResult =
  | { kind: "resolved"; paymentId: string; outcome: ResolveOutcome }
  | { kind: "still_pending"; paymentId: string }
  | { kind: "not_eligible"; reason: string }
  | { kind: "query_failed"; paymentId: string; error: string };

/** Reconciles a single payment by ID. Used both ad hoc (admin action) and by the batch sweep. */
export async function reconcilePayment(paymentId: string): Promise<ReconcileResult> {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });

  if (!payment) {
    return { kind: "not_eligible", reason: "Payment not found." };
  }
  if (!payment.checkoutRequestId) {
    return {
      kind: "not_eligible",
      reason: "No checkoutRequestId on this payment — STK push never got a Daraja response to query.",
    };
  }
  if (payment.status !== "PENDING" && payment.status !== "TIMEOUT") {
    return {
      kind: "not_eligible",
      reason: `Payment is ${payment.status}, not PENDING or TIMEOUT — nothing to reconcile.`,
    };
  }
  const ageMs = Date.now() - payment.createdAt.getTime();
  if (ageMs < MIN_AGE_BEFORE_RECONCILE_MS) {
    return {
      kind: "not_eligible",
      reason: `Payment is only ${Math.round(ageMs / 1000)}s old — too soon to reconcile.`,
    };
  }

  let queryResult;
  try {
    queryResult = await queryStkStatus(payment.checkoutRequestId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown reconciliation error";
    await writeAuditLog({
      actor: "system:reconciliation",
      action: "payment.reconciliation.query_failed",
      resourceType: "payment",
      resourceId: payment.id,
      metadata: { error: message },
    });
    return { kind: "query_failed", paymentId: payment.id, error: message };
  }

  // Daraja returns ResultCode 1032-equivalent "still pending" states via
  // its own ResponseCode/ResultCode combination; a query for a payment
  // the customer hasn't acted on yet typically comes back non-zero with
  // a "still pending" description rather than a clean success/failure.
  // We only apply a resolution when the query gives an unambiguous
  // terminal result; anything else is left PENDING/TIMEOUT for the next
  // sweep rather than guessed at.
  const resultCode = Number(queryResult.ResultCode);
  if (Number.isNaN(resultCode)) {
    return { kind: "still_pending", paymentId: payment.id };
  }

  const outcome = await db.$transaction((tx) =>
    resolvePaymentOutcome(tx, payment, {
      resultCode,
      resultDesc: queryResult.ResultDesc,
      source: "reconciliation",
    })
  );

  return { kind: "resolved", paymentId: payment.id, outcome };
}

/**
 * Batch sweep for a scheduled job. Bounded: processes at most `limit`
 * eligible payments per invocation rather than an unbounded scan, and
 * relies on MIN_AGE_BEFORE_RECONCILE_MS plus the caller's schedule
 * interval to avoid hammering Daraja (section 15).
 */
export async function reconcileStalePayments(limit = 25) {
  const cutoff = new Date(Date.now() - MIN_AGE_BEFORE_RECONCILE_MS);
  const stale = await db.payment.findMany({
    where: {
      status: { in: ["PENDING", "TIMEOUT"] },
      checkoutRequestId: { not: null },
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const results: ReconcileResult[] = [];
  for (const payment of stale) {
    // Sequential, not Promise.all — deliberate to avoid a burst of
    // concurrent requests against Daraja from a single sweep.
    results.push(await reconcilePayment(payment.id));
  }
  return results;
}
