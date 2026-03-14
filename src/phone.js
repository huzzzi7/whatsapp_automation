/**
 * Phone normalization and GreenAPI chatId formatting.
 * Ensures digits-only numbers and correct @c.us suffix for GreenAPI.
 */

/**
 * Normalize a raw phone value to digits-only, optionally fixing leading 0 with country code.
 * @param {string|number} raw - Cell value or user input (e.g. "+44 7123 456789", "07123456789")
 * @param {string} defaultCountryCode - e.g. "44" for UK
 * @returns {string} Digits only (e.g. "447123456789"), or "" if empty after cleanup
 */
function normalizePhone(raw, defaultCountryCode = '44') {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  // If starts with 0, replace with country code (e.g. 07123456789 -> 447123456789)
  if (digits.startsWith('0')) {
    return defaultCountryCode + digits.slice(1);
  }
  return digits;
}

/**
 * Format normalized phone for GreenAPI chatId (e.g. "447123456789" -> "447123456789@c.us").
 * @param {string} phone - Normalized digits-only phone
 * @returns {string} chatId for GreenAPI sendMessage
 */
function toChatId(phone) {
  const p = String(phone || '').trim();
  return p ? `${p}@c.us` : '';
}

module.exports = { normalizePhone, toChatId };
