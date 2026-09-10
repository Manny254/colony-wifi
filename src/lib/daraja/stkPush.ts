import { getDarajaConfig } from "./config";
import { getAccessToken } from "./auth";
import { darajaTimestamp } from "./timestamp";
import { toDarajaWireFormat } from "@/lib/phone";
import type { StkPushRequest, StkPushResponse, StkQueryResponse } from "./types";

function buildPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

/**
 * Initiates an STK push (Lipa Na M-Pesa Online). Amount must already be
 * the server-computed package price — this function does not re-derive
 * or trust any client-supplied amount; that validation happens one layer
 * up, before this is called. See src/lib/payments/createPayment.ts.
 */
export async function initiateStkPush(
  req: StkPushRequest
): Promise<StkPushResponse> {
  const config = getDarajaConfig();
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const password = buildPassword(config.shortcode, config.passkey, timestamp);
  // req.phoneE164 arrives in our internal +254XXXXXXXXX format; Daraja's
  // wire format drops the '+'. Convert at this boundary only.
  const darajaPhone = toDarajaWireFormat(req.phoneE164);

  const body = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: config.transactionType,
    Amount: Math.round(req.amountKes),
    PartyA: darajaPhone,
    PartyB: config.shortcode,
    PhoneNumber: darajaPhone,
    CallBackURL: config.callbackUrl,
    AccountReference: req.accountReference.slice(0, 12), // Daraja truncates/rejects long refs
    TransactionDesc: req.transactionDesc.slice(0, 13),
  };

  const res = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.ResponseCode !== "0") {
    throw new Error(
      `Daraja STK push rejected: ${res.status} — ${JSON.stringify(data)}`
    );
  }

  return data as StkPushResponse;
}

/**
 * Actively queries STK push status. Used for reconciliation when a
 * callback never arrives (network partition, Safaricom outage, customer
 * closed the app) — see src/lib/payments/reconcile.ts. Note Daraja
 * returns ResultCode 1032 while the push is still pending customer
 * action, and other non-zero codes for failure/cancellation/timeout.
 */
export async function queryStkStatus(
  checkoutRequestId: string
): Promise<StkQueryResponse> {
  const config = getDarajaConfig();
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const password = buildPassword(config.shortcode, config.passkey, timestamp);

  const res = await fetch(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    throw new Error(`Daraja STK query failed: ${res.status} — ${JSON.stringify(data)}`);
  }

  return data as StkQueryResponse;
}
