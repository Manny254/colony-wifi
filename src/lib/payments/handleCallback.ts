import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { resolvePaymentOutcome, type ResolveOutcome } from "./resolveOutcome";
import { parseCallbackMetadata, type DarajaStkCallback } from "@/lib/daraja/types";

export type CallbackOutcome =
  | ResolveOutcome
  | { kind: "unknown_transaction"; checkoutRequestId: string }
  | { kind: "malformed" };

/**
 * Callback entry point, spec sections 13-14. Validates shape, locates
 * the payment, and delegates to the shared resolver so callback and
 * reconciliation paths can never drift into different behaviour. Does
 * NOT perform the HTTP response — the route handler acks Daraja quickly
 * regardless of outcome (section 13, points 9-10), independent of what
 * happened here.
 */
export async function handleDarajaCallback(raw: unknown): Promise<CallbackOutcome> {
  const parsed = validateCallbackShape(raw);
  if (!parsed) {
    await writeAuditLog({
      actor: "system:daraja-callback",
      action: "payment.callback.malformed",
      resourceType: "payment",
      metadata: { raw: safeTruncate(raw) },
    });
    return { kind: "malformed" };
  }

  const cb = parsed.Body.stkCallback;

  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { checkoutRequestId: cb.CheckoutRequestID },
    });

    if (!payment) {
      // Section 39/40 Q9: an unknown callback must never corrupt another
      // payment. Log it and stop — do not guess which payment it belongs to.
      await writeAuditLog(
        {
          actor: "system:daraja-callback",
          action: "payment.callback.unknown_transaction",
          resourceType: "payment",
          metadata: {
            checkoutRequestId: cb.CheckoutRequestID,
            merchantRequestId: cb.MerchantRequestID,
            resultCode: cb.ResultCode,
          },
        },
        tx
      );
      return { kind: "unknown_transaction", checkoutRequestId: cb.CheckoutRequestID };
    }

    const metadata = parseCallbackMetadata(cb);

    return resolvePaymentOutcome(tx, payment, {
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
      metadata,
      source: "callback",
    });
  });
}

function validateCallbackShape(raw: unknown): DarajaStkCallback | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = (raw as Record<string, unknown>).Body;
  if (typeof body !== "object" || body === null) return null;
  const stkCallback = (body as Record<string, unknown>).stkCallback;
  if (typeof stkCallback !== "object" || stkCallback === null) return null;

  const c = stkCallback as Record<string, unknown>;
  if (
    typeof c.MerchantRequestID !== "string" ||
    typeof c.CheckoutRequestID !== "string" ||
    typeof c.ResultCode !== "number" ||
    typeof c.ResultDesc !== "string"
  ) {
    return null;
  }

  return raw as DarajaStkCallback;
}

function safeTruncate(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return "<unserializable>";
  }
}
