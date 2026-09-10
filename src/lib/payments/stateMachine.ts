import { PaymentStatus } from "@prisma/client";

/**
 * Explicit allowed transitions per spec section 16.
 *
 * Documented legal transitions:
 *   PENDING -> SUCCESS
 *   PENDING -> FAILED
 *   PENDING -> CANCELLED
 *   PENDING -> TIMEOUT
 *   PENDING -> RECONCILIATION_REQUIRED   (callback missing/ambiguous, section 15)
 *   TIMEOUT -> SUCCESS                   (explicit in spec: "if later verified")
 *   TIMEOUT -> FAILED                    (reconciliation query resolves negatively)
 *   TIMEOUT -> RECONCILIATION_REQUIRED   (reconciliation query itself is ambiguous)
 *   RECONCILIATION_REQUIRED -> SUCCESS / FAILED / CANCELLED (resolution)
 *
 * SUCCESS, FAILED, and CANCELLED are terminal. Spec section 16 is explicit:
 * "A payment that is already SUCCESS must not be downgraded to FAILED
 * because of a duplicate or stale event." We apply that same protection
 * symmetrically to FAILED and CANCELLED — once money has genuinely
 * finished moving (or definitively not moved), no later event should
 * silently rewrite that fact. Re-applying the SAME status again (a
 * duplicate callback) is always a no-op, handled separately below.
 */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ["SUCCESS", "FAILED", "CANCELLED", "TIMEOUT", "RECONCILIATION_REQUIRED"],
  TIMEOUT: ["SUCCESS", "FAILED", "RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["SUCCESS", "FAILED", "CANCELLED"],
  SUCCESS: [],
  FAILED: [],
  CANCELLED: [],
};

export type TransitionCheck =
  | { allowed: true; isNoOp: boolean }
  | { allowed: false; reason: string };

export function checkTransition(
  from: PaymentStatus,
  to: PaymentStatus
): TransitionCheck {
  if (from === to) {
    return { allowed: true, isNoOp: true };
  }

  const allowedTargets = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowedTargets.includes(to)) {
    return {
      allowed: false,
      reason: `Illegal payment state transition: ${from} -> ${to}`,
    };
  }

  return { allowed: true, isNoOp: false };
}
