import { parsePhoneNumberFromString } from "libphonenumber-js";

// Normalize any phone input to E.164 (e.g. "+14155552671") so roster numbers
// and Clerk-verified numbers compare reliably. Returns null if unparseable.
export function toE164(input, country = process.env.DEFAULT_COUNTRY || "US") {
  if (!input) return null;
  const parsed = parsePhoneNumberFromString(String(input).trim(), country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

// Best-effort store form: E.164 if parseable, else "+<digits>" / "<digits>".
// We never silently drop a number the organizer typed.
export function cleanLoose(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return (s.startsWith("+") ? "+" : "") + digits;
}

// Forgiving comparison key: the last 9 significant digits. This makes a roster
// number match a Clerk-verified number across country-code/format differences
// (+61… vs 0…, +1… vs local), which is what trips people up at join time.
export function phoneKey(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits.slice(-9);
}
