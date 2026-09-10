export interface StkPushRequest {
  amountKes: number;
  phoneE164: string;
  accountReference: string; // shown to customer, e.g. payment id or package name
  transactionDesc: string;
}

export interface StkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
}

export interface StkPushErrorResponse {
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface StkQueryResponse {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode: string;
  ResultDesc: string;
}

interface CallbackMetadataItem {
  Name: string;
  Value?: string | number;
}

export interface DarajaStkCallback {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: CallbackMetadataItem[];
      };
    };
  };
}

/** Parsed, typed subset of CallbackMetadata.Item extracted for our own use. */
export interface ParsedCallbackMetadata {
  amount?: number;
  mpesaReceiptNumber?: string;
  transactionDate?: string; // raw Daraja format: YYYYMMDDHHmmss
  phoneNumber?: string;
}

export function parseCallbackMetadata(
  callback: DarajaStkCallback["Body"]["stkCallback"]
): ParsedCallbackMetadata {
  const items = callback.CallbackMetadata?.Item ?? [];
  const get = (name: string) => items.find((i) => i.Name === name)?.Value;

  return {
    amount: typeof get("Amount") === "number" ? (get("Amount") as number) : undefined,
    mpesaReceiptNumber: get("MpesaReceiptNumber")?.toString(),
    transactionDate: get("TransactionDate")?.toString(),
    phoneNumber: get("PhoneNumber")?.toString(),
  };
}

/** Converts Daraja's YYYYMMDDHHmmss (Africa/Nairobi local) to a UTC Date. */
export function parseDarajaTransactionDate(raw: string): Date | null {
  if (!/^\d{14}$/.test(raw)) return null;
  const yyyy = Number(raw.slice(0, 4));
  const mm = Number(raw.slice(4, 6));
  const dd = Number(raw.slice(6, 8));
  const hh = Number(raw.slice(8, 10));
  const min = Number(raw.slice(10, 12));
  const ss = Number(raw.slice(12, 14));
  // Constructed as UTC-equivalent-of-EAT, then shifted back by 3 hours to get true UTC.
  const asIfUtc = Date.UTC(yyyy, mm - 1, dd, hh, min, ss);
  return new Date(asIfUtc - 3 * 60 * 60 * 1000);
}
