/**
 * Normalizes Kenyan mobile numbers to +254XXXXXXXXX — the internal E.164
 * format mandated by spec section 12. This is the format stored in
 * customers.phone_e164 and payments.phone_e164.
 *
 * Accepts common input shapes a customer might type or paste (section 12):
 *   0712345678, 0112345678, +254712345678, 254712345678,
 *   with spaces/dashes/parens anywhere.
 *
 * Valid Safaricom/general Kenyan mobile numbers start with 254 7 or 254 1
 * followed by 8 more digits (9 significant digits after the 254).
 * This does not verify the number is *reachable* — only that it is
 * well-formed. Daraja itself is the source of truth on deliverability.
 *
 * IMPORTANT: this is NOT the format Daraja's wire API accepts. Daraja's
 * PartyA/PhoneNumber fields require the digits without the '+'
 * (254XXXXXXXXX). Use toDarajaWireFormat() at the point of building the
 * STK push request — never conflate the two formats.
 */

export type PhoneNormalizationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeKenyanPhone(raw: string): PhoneNormalizationResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Phone number must be a string." };
  }

  const stripped = raw.replace(/[\s\-()]/g, "");

  if (stripped.length === 0) {
    return { ok: false, error: "Phone number is required." };
  }

  let digits: string;

  if (stripped.startsWith("+254")) {
    digits = stripped.slice(1); // drop '+', keep 254...
  } else if (stripped.startsWith("254")) {
    digits = stripped;
  } else if (stripped.startsWith("0")) {
    digits = "254" + stripped.slice(1);
  } else if (/^[17]\d{8}$/.test(stripped)) {
    digits = "254" + stripped;
  } else {
    digits = stripped;
  }

  if (!/^254[17]\d{8}$/.test(digits)) {
    return {
      ok: false,
      error:
        "Enter a valid Kenyan mobile number, e.g. 0712345678 or 254712345678.",
    };
  }

  return { ok: true, value: "+" + digits };
}

/** Formats a normalized +254XXXXXXXXX number back to local 07XX/01XX display form. */
export function toLocalDisplayFormat(normalized: string): string {
  if (!/^\+254[17]\d{8}$/.test(normalized)) return normalized;
  return "0" + normalized.slice(4);
}

/**
 * Converts our internal +254XXXXXXXXX format to Daraja's wire format
 * (254XXXXXXXXX, no '+'). Only ever call this at the boundary where a
 * request is being built for Safaricom — never store this format.
 */
export function toDarajaWireFormat(normalized: string): string {
  if (!/^\+254[17]\d{8}$/.test(normalized)) {
    throw new Error(
      `toDarajaWireFormat received a non-normalized value: "${normalized}". ` +
        `Call normalizeKenyanPhone() first.`
    );
  }
  return normalized.slice(1);
}
