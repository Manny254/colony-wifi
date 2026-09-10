import { getDarajaConfig } from "./config";

/**
 * OAuth token cache.
 *
 * IMPORTANT: on serverless platforms (Vercel), each cold-started function
 * instance has its own module memory, so this cache is best-effort per
 * instance, not a shared/global cache. It still meaningfully cuts token
 * fetches on warm instances handling multiple requests. It is NOT a
 * substitute for Daraja's own token expiry — we still respect `expires_in`.
 */
let cachedToken: { token: string; expiresAtMs: number } | null = null;
let inFlight: Promise<string> | null = null;

const EXPIRY_BUFFER_MS = 60_000; // refresh 60s before actual expiry

async function fetchNewToken(): Promise<string> {
  const config = getDarajaConfig();
  const basicAuth = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`
  ).toString("base64");

  const res = await fetch(
    `${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: { Authorization: `Basic ${basicAuth}` },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    throw new Error(
      `Daraja OAuth failed: ${res.status} ${res.statusText} — ${body}`
    );
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: string;
  };

  if (!data.access_token) {
    throw new Error("Daraja OAuth response did not include access_token.");
  }

  const expiresInSeconds = Number(data.expires_in ?? "3599");
  cachedToken = {
    token: data.access_token,
    expiresAtMs: Date.now() + expiresInSeconds * 1000,
  };

  return cachedToken.token;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs - EXPIRY_BUFFER_MS > Date.now()) {
    return cachedToken.token;
  }

  if (inFlight) return inFlight;

  inFlight = fetchNewToken().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
