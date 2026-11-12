import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Client-side phone normalization for the call-auth initiate (#593):
 * `POST /auth/call/initiate` demands the CANONICAL `+7XXXXXXXXXX` string —
 * anything else answers 422 before the gates. The existing phone input keeps
 * its free format; this helper canonicalizes at the call boundary. Returns
 * null for a value that is not a valid RU number (no request is sent — the
 * server 422 stays the backstop, not the primary check).
 */
export function toCanonicalPhone(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw, "RU");
  if (!parsed) return null;
  if (!parsed.isValid()) return null;
  if (parsed.country !== "RU") return null;
  return parsed.format("E.164");
}
