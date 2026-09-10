import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { db } from "@/lib/db";
import { mikrotikClient } from "@/lib/mikrotik/client";

export const runtime = "nodejs";

// ASSUMED (not specified by the handout): "expiring soon" threshold.
// Documented here rather than silently guessed inline.
const EXPIRING_SOON_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  const { error } = requireAdmin(req);
  if (error) return error;

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    revenueTotal,
    revenueToday,
    successfulPayments,
    failedPayments,
    pendingPayments,
    activeEntitlements,
    expiringSoonCount,
    routerHealth,
  ] = await Promise.all([
    db.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amountKes: true } }),
    db.payment.aggregate({
      where: { status: "SUCCESS", createdAt: { gte: todayStart } },
      _sum: { amountKes: true },
    }),
    db.payment.count({ where: { status: "SUCCESS" } }),
    // "Failed" bucket for the dashboard groups FAILED/CANCELLED/TIMEOUT —
    // all represent a payment attempt that did not result in access.
    // Documented assumption; RECONCILIATION_REQUIRED is intentionally
    // excluded and reported separately since it needs operator attention,
    // not just a failure count.
    db.payment.count({ where: { status: { in: ["FAILED", "CANCELLED", "TIMEOUT"] } } }),
    db.payment.count({ where: { status: "PENDING" } }),
    db.entitlement.count({
      where: { status: { in: ["ACTIVE", "PENDING_AUTHORIZATION"] }, expiresAt: { gt: now } },
    }),
    db.entitlement.count({
      where: {
        status: { in: ["ACTIVE", "PENDING_AUTHORIZATION"] },
        expiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRING_SOON_WINDOW_MS) },
      },
    }),
    mikrotikClient.checkHealth(),
  ]);

  const needsReconciliation = await db.payment.count({
    where: { status: "RECONCILIATION_REQUIRED" },
  });

  return NextResponse.json({
    revenueKes: { total: revenueTotal._sum.amountKes ?? 0, today: revenueToday._sum.amountKes ?? 0 },
    payments: {
      successful: successfulPayments,
      failed: failedPayments,
      pending: pendingPayments,
      needsReconciliation,
    },
    activeUsers: activeEntitlements,
    expiringSoon: { count: expiringSoonCount, windowMinutes: EXPIRING_SOON_WINDOW_MS / 60000 },
    router: routerHealth,
  });
}
