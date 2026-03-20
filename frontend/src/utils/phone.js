/**
 * Client-side phone normalization (mirror server src/phone.js for validation UX).
 * @param {string|number} raw
 * @param {string} [defaultCountryCode='44']
 * @returns {string} digits only or ''
 */
export function normalizePhoneInput(raw, defaultCountryCode = '44') {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    return defaultCountryCode + digits.slice(1);
  }
  return digits;
}

/** E.164-style: 10–15 digits, no leading 0 in stored form (normalize strips leading 0). */
export function isValidE164Digits(digits) {
  if (!digits || typeof digits !== 'string') return false;
  if (digits.length < 10 || digits.length > 15) return false;
  if (!/^\d+$/.test(digits)) return false;
  return true;
}
