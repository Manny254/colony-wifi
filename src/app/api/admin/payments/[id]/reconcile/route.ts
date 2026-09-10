import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/requireAdmin";
import { apiError } from "@/lib/apiError";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

/**
 * Answers spec section 40 Q16 ("Can the operator reconcile payments?")
 * with a real, callable action rather than leaving reconciliation as a
 * background-only mechanism the operator can't invoke on demand.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = requireAdmin(req);
  if (error) return error;

  const resolvedParams = await params;
  const parsedParams = paramsSchema.safeParse(resolvedParams);
  if (!parsedParams.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid payment id.");
  }

  const result = await reconcilePayment(parsedParams.data.id);

  await writeAuditLog({
    actor: `admin:${session!.email}`,
    action: "payment.manual_reconciliation_triggered",
    resourceType: "payment",
    resourceId: parsedParams.data.id,
    metadata: { result },
  });

  return NextResponse.json({ result });
}
