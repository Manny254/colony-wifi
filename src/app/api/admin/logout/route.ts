import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, ADMIN_SESSION_COOKIE } from "@/lib/adminAuth";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = getAdminSession(req);
  if (session) {
    await writeAuditLog({
      actor: `admin:${session.email}`,
      action: "admin.logout",
      resourceType: "admin",
      resourceId: session.adminId,
    });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE.name, "", { ...ADMIN_SESSION_COOKIE.options, maxAge: 0 });
  return res;
}
