import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { initiateStkPush } from "@/lib/daraja/stkPush";

export class PaymentInitiationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "PaymentInitiationError";
  }
}

interface CreatePaymentInput {
  packageId: string;
  phoneE164: string;
  idempotencyKey: string;
}

/**
 * Creates (or returns the existing) payment for a checkout attempt, then
 * fires the STK push. The package price is always read from the database
 * here — the client never supplies an amount that gets trusted. If the
 * client sent one anyway (e.g. for display), it is ignored by this
 * function entirely.
 */
export async function createPayment(input: CreatePaymentInput) {
  // Idempotency: a retried request with the same key returns the same
  // payment rather than double-charging or double-pushing an STK prompt.
  const existing = await db.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return existing;
  }

  const pkg = await db.package.findUnique({ where: { id: input.packageId } });
  if (!pkg) {
    throw new PaymentInitiationError("Package not found.", "PACKAGE_NOT_FOUND");
  }
  if (!pkg.enabled) {
    throw new PaymentInitiationError(
      "This package is not currently available.",
      "PACKAGE_DISABLED"
    );
  }

  const customer = await db.customer.upsert({
    where: { phoneE164: input.phoneE164 },
    update: { lastSeenAt: new Date() },
    create: { phoneE164: input.phoneE164 },
  });

  let payment;
  try {
    payment = await db.payment.create({
      data: {
        customerId: customer.id,
        packageId: pkg.id,
        amountKes: pkg.priceKes,
        phoneE164: input.phoneE164,
        status: "PENDING",
        idempotencyKey: input.idempotencyKey,
      },
    });
  } catch (err) {
    // Race: two concurrent requests with the same idempotency key.
    // The unique constraint rejects the loser; fetch and return the winner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await db.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (winner) return winner;
    }
    throw err;
  }

  await writeAuditLog({
    actor: `customer:${input.phoneE164}`,
    action: "payment.initiated",
    resourceType: "payment",
    resourceId: payment.id,
    metadata: { packageId: pkg.id, amountKes: pkg.priceKes },
  });

  try {
    const stkResponse = await initiateStkPush({
      amountKes: pkg.priceKes,
      phoneE164: input.phoneE164,
      accountReference: payment.id.slice(0, 12),
      transactionDesc: pkg.name.slice(0, 13),
    });

    payment = await db.payment.update({
      where: { id: payment.id },
      data: {
        merchantRequestId: stkResponse.MerchantRequestID,
        checkoutRequestId: stkResponse.CheckoutRequestID,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown STK push error";
    payment = await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        resultDescription: message.slice(0, 500),
      },
    });
    await writeAuditLog({
      actor: "system:daraja-stk-push",
      action: "payment.stk_push_failed",
      resourceType: "payment",
      resourceId: payment.id,
      metadata: { error: message },
    });
    throw new PaymentInitiationError(
      "Could not start the M-Pesa payment prompt. Please try again.",
      "STK_PUSH_FAILED"
    );
  }

  return payment;
}
