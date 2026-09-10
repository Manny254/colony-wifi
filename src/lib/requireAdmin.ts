import { NextRequest } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { apiError } from "@/lib/apiError";

/**
 * Section 24: admin routes must be protected server-side, not by hiding
 * buttons. Every protected route handler should call this first and
 * bail out on the error branch before touching any data.
 *
 * Single flat admin model — this is a single-operator system (see
 * AUDIT.md). An earlier draft had a two-tier SUPER_ADMIN/ADMIN role that
 * was checked in exactly two places and allowed the same roles in both
 * — dead complexity with no behavioural difference. Removed rather than
 * carried forward. If multi-admin permission tiers become a real need
 * later, that's a deliberate schema change at that point, not something
 * to keep half-built now.
 */
export function requireAdmin(req: NextRequest) {
  const session = getAdminSession(req);
  if (!session) {
    return { session: null, error: apiError(401, "UNAUTHORIZED", "Admin authentication required.") };
  }
  return { session, error: null };
}
