import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Spec section 26 mandates this exact shape:
 *   { "error": { "code": "...", "message": "...", "requestId": "..." } }
 * and "Never return stack traces."
 */
export function apiError(
  status: number,
  code: string,
  message: string
): NextResponse {
  const requestId = crypto.randomUUID();
  return NextResponse.json(
    { error: { code, message, requestId } },
    { status }
  );
}
