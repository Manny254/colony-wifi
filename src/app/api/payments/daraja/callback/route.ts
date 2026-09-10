import { NextRequest, NextResponse } from "next/server";
import { handleDarajaCallback } from "@/lib/payments/handleCallback";

export const runtime = "nodejs";

/**
 * Deliberately NOT rate-limited (section 29: "Do not rate-limit Daraja
 * callback so aggressively that legitimate callbacks are rejected" —
 * Safaricom retries on anything other than a clean 200, so an
 * over-aggressive limiter here would create a retry storm, not prevent one).
 *
 * Always responds 200 with Safaricom's expected ack body, regardless of
 * what happened internally — including on malformed input. The
 * *outcome* is recorded via handleDarajaCallback()'s own audit logging;
 * this route's only job is: parse, delegate, acknowledge quickly
 * (section 13, points 9-10 — avoid long network work before acking).
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.error("daraja/callback: failed to parse JSON body", err);
    // Still 200 — a malformed body from Safaricom (or a probe from
    // somewhere else) must not trigger a retry storm. handleDarajaCallback
    // records malformed cases; here we haven't even reached that call.
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  try {
    const outcome = await handleDarajaCallback(body);
    if (outcome.kind === "unknown_transaction" || outcome.kind === "malformed") {
      console.warn("daraja/callback: outcome required attention", outcome);
    }
  } catch (err) {
    // A genuinely unexpected error (e.g. DB unreachable). Still ack —
    // the alternative is Safaricom retrying into the same failure
    // repeatedly. The failure itself needs to be visible via logs/alerts,
    // not surfaced to Safaricom as a reason to retry faster.
    console.error("daraja/callback: unexpected error handling callback", err);
  }

  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
