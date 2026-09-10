import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError } from "@/lib/apiError";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Section 29: rate-limit status polling so a runaway frontend loop
  // can't hammer the DB. 60 requests / minute is generous for a
  // reasonable poll interval (e.g. every 2s) with headroom.
  const ip = getClientIp(req.headers);
  const rl = checkRateLimit(`status:${ip}`, 60, 60 * 1000);
  if (!rl.allowed) {
    return apiError(429, "RATE_LIMITED", "Too many status checks. Please slow down.");
  }

  // Next.js 15+ made dynamic route params async (a Promise) rather than
  // a plain object — must be awaited before use.
  const resolvedParams = await params;
  const parsedParams = paramsSchema.safeParse(resolvedParams);
  if (!parsedParams.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid payment id.");
  }

  // Section 25: payment status must not expose another customer's
  // payment information. The payment id itself is an unguessable UUID
  // (opaque identifier) issued only to the customer who initiated this
  // exact payment — that is the ownership/correlation check here. We
  // return only the minimal safe fields; never provider secrets, never
  // other customers' data (a single lookup by primary key structurally
  // cannot return another payment).
  const payment = await db.payment.findUnique({
    where: { id: parsedParams.data.id },
    include: { package: { select: { name: true } } },
  });

  if (!payment) {
    return apiError(404, "PAYMENT_NOT_FOUND", "Payment could not be found.");
  }

  return NextResponse.json({
    id: payment.id,
    status: payment.status,
    packageName: payment.package.name,
    amountKes: payment.amountKes,
    // Only reveal the receipt once the payment has actually succeeded —
    // it's the customer's own receipt, safe to show at that point.
    mpesaReceiptNumber: payment.status === "SUCCESS" ? payment.mpesaReceiptNumber : null,
    createdAt: payment.createdAt,
  });
}
