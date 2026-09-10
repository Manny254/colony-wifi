import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAccessToken } from "@/lib/daraja/auth";
import { mikrotikClient } from "@/lib/mikrotik/client";

export const runtime = "nodejs";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/**
 * Section 36: "Do not claim an external service is healthy merely
 * because environment variables exist." Database health is checked with
 * a real query. Daraja health is checked with a real OAuth call (cheap
 * once cached — see src/lib/daraja/auth.ts). MikroTik honestly reports
 * UNKNOWN/not-configured (Phase F blocked) rather than pretending.
 *
 * Public endpoint — only non-sensitive status is exposed. Detailed
 * dependency status (latency, last error) is in
 * /api/admin/system-health, which requires admin auth.
 */
export async function GET() {
  const [database, daraja, mikrotik] = await Promise.all([
    checkDatabase(),
    checkDaraja(),
    mikrotikClient.checkHealth().then((r) => r.status),
  ]);

  const overallHealthy = database === "healthy";

  return NextResponse.json(
    {
      app: "healthy",
      database,
      daraja,
      mikrotik,
    },
    { status: overallHealthy ? 200 : 503 }
  );
}

async function checkDatabase(): Promise<"healthy" | "unhealthy"> {
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, 3000);
    return "healthy";
  } catch (err) {
    console.error("health: database check failed", err);
    return "unhealthy";
  }
}

async function checkDaraja(): Promise<"configured_reachable" | "configured_unreachable" | "not_configured"> {
  const requiredVars = [
    "DARAJA_CONSUMER_KEY",
    "DARAJA_CONSUMER_SECRET",
    "DARAJA_SHORTCODE",
    "DARAJA_PASSKEY",
    "DARAJA_BASE_URL",
  ];
  if (requiredVars.some((v) => !process.env[v])) {
    return "not_configured";
  }
  try {
    await withTimeout(getAccessToken(), 5000);
    return "configured_reachable";
  } catch (err) {
    console.error("health: daraja check failed", err);
    return "configured_unreachable";
  }
}
