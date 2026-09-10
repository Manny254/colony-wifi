import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { adminLoginSchema } from "@/lib/validation";
import { verifyAdminPassword, signAdminSessionToken, ADMIN_SESSION_COOKIE } from "@/lib/adminAuth";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Section 29: rate-limit admin auth attempts. Tight — 5 / 10 min / IP.
  const ip = getClientIp(req.headers);
  const rl = checkRateLimit(`admin-login:${ip}`, 5, 10 * 60 * 1000);
  if (!rl.allowed) {
    return apiError(429, "RATE_LIMITED", "Too many login attempts. Please wait and try again.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Email and password are required.");
  }

  const admin = await verifyAdminPassword(parsed.data.email, parsed.data.password);

  if (!admin) {
    // Generic message regardless of whether the email exists — never
    // confirm/deny account existence to an unauthenticated caller.
    await writeAuditLog({
      actor: `unknown:${ip}`,
      action: "admin.login.failed",
      resourceType: "admin",
      metadata: { emailAttempted: parsed.data.email },
    });
    return apiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const token = signAdminSessionToken({ adminId: admin.id, email: admin.email });

  await db.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  await writeAuditLog({
    actor: `admin:${admin.email}`,
    action: "admin.login.success",
    resourceType: "admin",
    resourceId: admin.id,
  });

  const res = NextResponse.json({ email: admin.email });
  res.cookies.set(ADMIN_SESSION_COOKIE.name, token, ADMIN_SESSION_COOKIE.options);
  return res;
}
