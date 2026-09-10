/**
 * Fixed-window rate limiter, in-memory.
 *
 * KNOWN LIMITATION (documented, not hidden): on Vercel's serverless
 * runtime, each function instance has its own memory, and instances are
 * created/destroyed based on traffic. This limiter is therefore
 * best-effort per warm instance, not a globally enforced limit across
 * concurrent instances. For a single-hotspot beachhead deployment with
 * modest concurrent traffic this is a reasonable and honest tradeoff —
 * see spec section 4's instruction not to add Redis/queues without
 * evidence of need. If concurrent abuse across many instances becomes a
 * real problem, the documented upgrade path is a Postgres-backed
 * counter table (durable, already-present infrastructure) rather than
 * adding a new caching service.
 */

interface Bucket {
  count: number;
  windowStartMs: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartMs >= windowMs) {
    buckets.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: limit - 1, resetAtMs: now + windowMs };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAtMs: existing.windowStartMs + windowMs,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAtMs: existing.windowStartMs + windowMs,
  };
}

/** Best-effort client identifier from standard proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}
