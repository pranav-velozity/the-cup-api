import { parsePhoneNumberFromString } from "libphonenumber-js";

// Normalize any phone input to E.164 (e.g. "+14155552671") so roster numbers
// and Clerk-verified numbers compare reliably. Returns null if unparseable.
export function toE164(input, country = process.env.DEFAULT_COUNTRY || "US") {
  if (!input) return null;
  const parsed = parsePhoneNumberFromString(String(input).trim(), country);
  return parsed && parsed.isValid() ? parsed.number : null;
}
