import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Returns real session rows if any exist. Phase F (MikroTik) is not
 * built, so in the current system nothing ever writes to the sessions
 * table — this route is honest about that rather than fabricating data
 * (spec section 22: "Do not invent usage data").
 */
export async function GET(req: NextRequest) {
  const { error } = requireAdmin(req);
  if (error) return error;

  const sessions = await db.session.findMany({
    orderBy: { startedAt: "desc" },
    take: 100,
    include: {
      customer: { select: { phoneE164: true } },
      entitlement: { select: { packageId: true, expiresAt: true } },
    },
  });

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      customerPhone: s.customer.phoneE164,
      macAddress: s.macAddress,
      ipAddress: s.ipAddress,
      packageId: s.entitlement?.packageId ?? null,
      expiresAt: s.entitlement?.expiresAt ?? null,
      status: s.status,
      startedAt: s.startedAt,
      bytesIn: s.bytesIn !== null ? s.bytesIn.toString() : null,
      bytesOut: s.bytesOut !== null ? s.bytesOut.toString() : null,
    })),
    note:
      sessions.length === 0
        ? "No network sessions recorded. Phase F (MikroTik) is not yet built, so no source currently writes session rows."
        : undefined,
  });
}
