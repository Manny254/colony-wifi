import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { expireStaleEntitlements } from "@/lib/entitlements/engine";
import { reconcileStalePayments } from "@/lib/payments/reconcile";

export const runtime = "nodejs";

/**
 * Intended to be invoked by Vercel Cron (see vercel.json) on a short
 * interval (e.g. every 5 minutes). Does two things spec sections 15 and
 * 21 both require but that need *something* to trigger them
 * periodically rather than only reacting to live traffic:
 *   - expires entitlements whose expires_at has passed
 *   - reconciles payments stuck PENDING/TIMEOUT with no callback
 *
 * Protected by a shared secret rather than admin session auth, since
 * Vercel Cron requests don't carry a browser session cookie. Vercel
 * automatically sends this as a Bearer token when CRON_SECRET is set
 * as a project env var — see Vercel's Cron Jobs documentation.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return apiError(500, "CRON_NOT_CONFIGURED", "CRON_SECRET is not set.");
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return apiError(401, "UNAUTHORIZED", "Invalid cron secret.");
  }

  const expiredCount = await expireStaleEntitlements();
  const reconciliationResults = await reconcileStalePayments();

  return NextResponse.json({
    expiredEntitlements: expiredCount,
    reconciliation: {
      attempted: reconciliationResults.length,
      resolved: reconciliationResults.filter((r) => r.kind === "resolved").length,
    },
  });
}
