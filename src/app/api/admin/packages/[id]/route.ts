import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/requireAdmin";
import { apiError } from "@/lib/apiError";
import { db } from "@/lib/db";
import { updatePackageSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = requireAdmin(req);
  if (error) return error;

  const resolvedParams = await params;
  const parsedParams = paramsSchema.safeParse(resolvedParams);
  if (!parsedParams.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid package id.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = updatePackageSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid package data.");
  }

  const existing = await db.package.findUnique({ where: { id: parsedParams.data.id } });
  if (!existing) {
    return apiError(404, "PACKAGE_NOT_FOUND", "Package could not be found.");
  }

  // Section 40 Q18: "Can packages be changed without corrupting existing
  // entitlements?" Price and duration are safe to change going forward —
  // every existing payment already has its own frozen amountKes, and
  // every existing entitlement already has its own frozen starts_at/
  // expires_at computed at creation time from the duration that applied
  // then. Neither is retroactively affected by this update.
  //
  // Bandwidth is a genuine, documented gap: entitlements reference
  // package_id rather than storing a bandwidth snapshot, so a bandwidth
  // change here DOES change what a past, still-active entitlement would
  // appear to be entitled to if bandwidth is read via that join. This is
  // flagged in AUDIT.md as a known limitation, not silently ignored.
  let updated;
  try {
    updated = await db.package.update({
      where: { id: parsedParams.data.id },
      data: {
        ...parsed.data,
        dataLimitBytes:
          parsed.data.dataLimitBytes !== undefined
            ? parsed.data.dataLimitBytes != null
              ? BigInt(parsed.data.dataLimitBytes)
              : null
            : undefined,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return apiError(409, "PACKAGE_NAME_TAKEN", `A package named "${parsed.data.name}" already exists.`);
    }
    throw err;
  }

  await writeAuditLog({
    actor: `admin:${session!.email}`,
    action: "package.updated",
    resourceType: "package",
    resourceId: updated.id,
    metadata: { changes: parsed.data },
  });

  return NextResponse.json({
    ...updated,
    dataLimitBytes: updated.dataLimitBytes !== null ? updated.dataLimitBytes.toString() : null,
  });
}
