import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/requireAdmin";
import { apiError } from "@/lib/apiError";
import { db } from "@/lib/db";
import { createPackageSchema } from "@/lib/validation";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { error } = requireAdmin(req);
  if (error) return error;

  const packages = await db.package.findMany({ orderBy: { priceKes: "asc" } });
  return NextResponse.json({
    packages: packages.map((p) => ({
      ...p,
      dataLimitBytes: p.dataLimitBytes !== null ? p.dataLimitBytes.toString() : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const { session, error } = requireAdmin(req);
  if (error) return error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = createPackageSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid package data.");
  }

  let pkg;
  try {
    pkg = await db.package.create({
      data: {
        ...parsed.data,
        dataLimitBytes: parsed.data.dataLimitBytes != null ? BigInt(parsed.data.dataLimitBytes) : null,
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
    action: "package.created",
    resourceType: "package",
    resourceId: pkg.id,
    metadata: { name: pkg.name, priceKes: pkg.priceKes },
  });

  return NextResponse.json(
    { ...pkg, dataLimitBytes: pkg.dataLimitBytes !== null ? pkg.dataLimitBytes.toString() : null },
    { status: 201 }
  );
}
