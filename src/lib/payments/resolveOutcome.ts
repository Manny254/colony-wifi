import { Payment, PaymentStatus, Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { checkTransition } from "./stateMachine";
import { activateOrRenewEntitlement } from "@/lib/entitlements/engine";
import type { ParsedCallbackMetadata } from "@/lib/daraja/types";
import { parseDarajaTransactionDate } from "@/lib/daraja/types";

export type ResolveOutcome =
  | { kind: "handled"; paymentId: string; resultingStatus: PaymentStatus }
  | { kind: "no_op_duplicate"; paymentId: string }
  | { kind: "illegal_transition"; paymentId: string; reason: string };

interface ResolveParams {
  resultCode: number;
  resultDesc: string;
  /**
   * Present for live Daraja callbacks (which include CallbackMetadata on
   * success). Absent for reconciliation queries via stkpushquery, which
   * confirm ResultCode/ResultDesc but do NOT return amount/receipt
   * detail. When absent, a SUCCESS outcome is still recorded (the query
   * endpoint is authoritative on status), but verificationStatus stays
   * UNVERIFIED rather than VERIFIED, since we could not independently
   * confirm the amount matched. This is a known, documented gap — see
   * AUDIT.md — not a silent assumption.
   */
  metadata?: ParsedCallbackMetadata;
  source: "callback" | "reconciliation";
}

function mapResultCodeToStatus(resultCode: number): PaymentStatus {
  if (resultCode === 0) return "SUCCESS";
  if (resultCode === 1032) return "CANCELLED";
  if (resultCode === 1037) return "TIMEOUT";
  return "FAILED";
}

export async function resolvePaymentOutcome(
  tx: Prisma.TransactionClient,
  payment: Payment,
  params: ResolveParams
): Promise<ResolveOutcome> {
  const rawTargetStatus = mapResultCodeToStatus(params.resultCode);

  // Determine verification BEFORE checking transition legality, so
  // checkTransition() is only ever asked about the ONE status we will
  // actually write. Previously this validated `rawTargetStatus` (e.g.
  // SUCCESS) but could then write a *different* status
  // (RECONCILIATION_REQUIRED, on an amount mismatch) without that
  // second status being independently validated — harmless under the
  // current transition table (every path to SUCCESS also permits
  // RECONCILIATION_REQUIRED, or already equals it), but a latent bug
  // waiting to bite the moment that table changes. Fixed by resolving
  // to a single true target status upfront.
  let verificationStatus: "VERIFIED" | "VERIFICATION_FAILED" | "UNVERIFIED" = "UNVERIFIED";
  let targetStatus = rawTargetStatus;

  if (rawTargetStatus === "SUCCESS") {
    if (params.metadata?.amount !== undefined) {
      verificationStatus =
        params.metadata.amount === payment.amountKes ? "VERIFIED" : "VERIFICATION_FAILED";
      if (verificationStatus === "VERIFICATION_FAILED") {
        targetStatus = "RECONCILIATION_REQUIRED";
      }
    } else {
      verificationStatus = "UNVERIFIED"; // see ResolveParams.metadata doc comment
    }
  }

  const transition = checkTransition(payment.status, targetStatus);

  const auditActor =
    params.source === "callback" ? "system:daraja-callback" : "system:reconciliation";

  if (!transition.allowed) {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "RECONCILIATION_REQUIRED",
        resultCode: params.resultCode,
        resultDescription: params.resultDesc.slice(0, 500),
        callbackReceivedAt: params.source === "callback" ? new Date() : payment.callbackReceivedAt,
      },
    });
    await writeAuditLog(
      {
        actor: auditActor,
        action: "payment.resolution.illegal_transition",
        resourceType: "payment",
        resourceId: payment.id,
        metadata: { from: payment.status, attempted: targetStatus, reason: transition.reason },
      },
      tx
    );
    return { kind: "illegal_transition", paymentId: payment.id, reason: transition.reason };
  }

  if (transition.isNoOp) {
    await writeAuditLog(
      {
        actor: auditActor,
        action: "payment.resolution.duplicate_ignored",
        resourceType: "payment",
        resourceId: payment.id,
        metadata: { resultCode: params.resultCode },
      },
      tx
    );
    return { kind: "no_op_duplicate", paymentId: payment.id };
  }

  const finalStatus = targetStatus;

  const transactionDate = params.metadata?.transactionDate
    ? parseDarajaTransactionDate(params.metadata.transactionDate)
    : null;

  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: finalStatus,
      resultCode: params.resultCode,
      resultDescription: params.resultDesc.slice(0, 500),
      callbackReceivedAt: params.source === "callback" ? new Date() : payment.callbackReceivedAt,
      verificationStatus,
      mpesaReceiptNumber: params.metadata?.mpesaReceiptNumber ?? undefined,
      transactionDate: transactionDate ?? undefined,
      callbackMetadata: params.metadata
        ? JSON.parse(JSON.stringify(params.metadata))
        : undefined,
    },
  });

  await writeAuditLog(
    {
      actor: auditActor,
      action: `payment.resolution.${finalStatus.toLowerCase()}`,
      resourceType: "payment",
      resourceId: payment.id,
      metadata: { resultCode: params.resultCode, verificationStatus, source: params.source },
    },
    tx
  );

  if (finalStatus === "SUCCESS") {
    await activateOrRenewEntitlement(updated.id, tx);
  }

  return { kind: "handled", paymentId: updated.id, resultingStatus: finalStatus };
}
