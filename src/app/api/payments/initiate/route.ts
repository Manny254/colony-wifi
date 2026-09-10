import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { normalizeKenyanPhone } from "@/lib/phone";
import { initiatePaymentSchema } from "@/lib/validation";
import { createPayment, PaymentInitiationError } from "@/lib/payments/createPayment";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Section 29: rate-limit payment initiation. 10 attempts / 5 min / IP —
  // generous enough for a customer retrying a typo'd number, tight
  // enough to blunt STK-push spam against a stranger's phone.
  const ip = getClientIp(req.headers);
  const rl = checkRateLimit(`initiate:${ip}`, 10, 5 * 60 * 1000);
  if (!rl.allowed) {
    return apiError(429, "RATE_LIMITED", "Too many attempts. Please wait a moment and try again.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = initiatePaymentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const phoneResult = normalizeKenyanPhone(parsed.data.phone);
  if (!phoneResult.ok) {
    return apiError(400, "INVALID_PHONE", phoneResult.error);
  }

  try {
    const payment = await createPayment({
      packageId: parsed.data.packageId,
      phoneE164: phoneResult.value,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    // Section 11 point 10: return SAFE payment status only. No amount
    // re-confirmation trust games, no provider secrets, no other
    // customer's data — just enough for the frontend to start polling.
    return NextResponse.json({
      id: payment.id,
      status: payment.status,
    });
  } catch (err) {
    if (err instanceof PaymentInitiationError) {
      const statusCode = err.code === "PACKAGE_NOT_FOUND" ? 404 : 400;
      return apiError(statusCode, err.code, err.message);
    }
    console.error("payments/initiate unexpected error", err);
    return apiError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
  }
}
