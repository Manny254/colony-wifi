import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { db } from "@/lib/db";
import { getAccessToken } from "@/lib/daraja/auth";
import { mikrotikClient } from "@/lib/mikrotik/client";

export const runtime = "nodejs";

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; result?: T; error?: string }> {
  const start = Date.now();
  try {
    const result = await fn();
    return { ms: Date.now() - start, result };
  } catch (err) {
    return { ms: Date.now() - start, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function GET(req: NextRequest) {
  const { error } = requireAdmin(req);
  if (error) return error;

  const [db_, daraja, routers, recentCallbackFailures] = await Promise.all([
    timed(() => db.$queryRaw`SELECT 1`),
    timed(() => getAccessToken()),
    db.router.findMany({
      select: { id: true, name: true, healthStatus: true, lastHealthCheckAt: true, enabled: true },
    }),
    db.auditLog.count({
      where: {
        action: { in: ["payment.callback.malformed", "payment.callback.unknown_transaction"] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const mikrotik = await mikrotikClient.checkHealth();

  return NextResponse.json({
    database: { healthy: !db_.error, latencyMs: db_.ms, error: db_.error },
    daraja: {
      configured: Boolean(process.env.DARAJA_CONSUMER_KEY && process.env.DARAJA_SHORTCODE),
      reachable: !daraja.error,
      latencyMs: daraja.ms,
      error: daraja.error,
      env: process.env.DARAJA_ENV ?? "sandbox",
    },
    mikrotik: {
      status: mikrotik.status,
      detail: mikrotik.detail,
      configuredRouters: routers,
    },
    callbackHealth: {
      malformedOrUnknownLast24h: recentCallbackFailures,
    },
  });
}
