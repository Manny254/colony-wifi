/**
 * Central place that reads Daraja env vars. Throws immediately and loudly
 * if a required value is missing, rather than letting a blank string
 * silently propagate into a signed request that Safaricom will reject
 * with an opaque error. Sandbox and production credentials must never
 * be mixed — DARAJA_ENV governs which base URL is used, but the
 * consumer key/secret/shortcode/passkey themselves must match that
 * environment; this module cannot verify that pairing and relies on
 * whoever configures the deployment getting it right.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. Daraja calls cannot proceed without it.`
    );
  }
  return value;
}

export type DarajaEnv = "sandbox" | "production";

export function getDarajaConfig() {
  const env = (process.env.DARAJA_ENV ?? "sandbox") as DarajaEnv;
  if (env !== "sandbox" && env !== "production") {
    throw new Error(
      `DARAJA_ENV must be 'sandbox' or 'production', got '${env}'.`
    );
  }

  return {
    env,
    baseUrl: requireEnv("DARAJA_BASE_URL"),
    consumerKey: requireEnv("DARAJA_CONSUMER_KEY"),
    consumerSecret: requireEnv("DARAJA_CONSUMER_SECRET"),
    shortcode: requireEnv("DARAJA_SHORTCODE"),
    passkey: requireEnv("DARAJA_PASSKEY"),
    callbackUrl: requireEnv("DARAJA_CALLBACK_URL"),
    transactionType: process.env.DARAJA_TRANSACTION_TYPE ?? "CustomerPayBillOnline",
  };
}
