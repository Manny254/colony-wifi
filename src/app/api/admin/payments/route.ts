import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { db } from "@/lib/db";
import type { PaymentStatus } from "@prisma/client";

export const runtime = "nodejs";

const VALID_STATUSES: PaymentStatus[] = [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
  "RECONCILIATION_REQUIRED",
];

export async function GET(req: NextRequest) {
  const { error } = requireAdmin(req);
  if (error) return error;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status =
    statusParam && VALID_STATUSES.includes(statusParam as PaymentStatus)
      ? (statusParam as PaymentStatus)
      : undefined;

  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50") || 50, 200);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const payments = await db.payment.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: { package: { select: { name: true } } },
  });

  return NextResponse.json({
    payments: payments.map((p) => ({
      id: p.id,
      phoneE164: p.phoneE164,
      packageName: p.package.name,
      amountKes: p.amountKes,
      status: p.status,
      mpesaReceiptNumber: p.mpesaReceiptNumber,
      checkoutRequestId: p.checkoutRequestId,
      merchantRequestId: p.merchantRequestId,
      verificationStatus: p.verificationStatus,
      createdAt: p.createdAt,
      callbackReceivedAt: p.callbackReceivedAt,
    })),
    nextCursor: payments.length === limit ? payments[payments.length - 1]?.id : null,
  });
}
