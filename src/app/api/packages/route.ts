import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const packages = await db.package.findMany({
    where: { enabled: true },
    orderBy: { priceKes: "asc" },
    select: {
      id: true,
      name: true,
      priceKes: true,
      durationSeconds: true,
      bandwidthDownMbps: true,
      bandwidthUpMbps: true,
      dataLimitBytes: true,
    },
  });

  // BigInt (dataLimitBytes) isn't JSON-serializable by default.
  const safe = packages.map((p) => ({
    ...p,
    dataLimitBytes: p.dataLimitBytes !== null ? p.dataLimitBytes.toString() : null,
  }));

  return NextResponse.json({ packages: safe });
}
