/**
 * Phone normalization and GreenAPI chatId formatting.
 * Ensures digits-only numbers and correct @c.us suffix for GreenAPI.
 */

/**
 * ITU-style calling prefixes (longest match first). Used so we do not prepend
 * defaultCountryCode to numbers that already begin with a different country code.
 * (Excludes bare "30" — Pakistan mobiles often start with 3 after stripping leading 0.)
 */
const KNOWN_CC_PREFIXES = [
  '1242',
  '1246',
  '1264',
  '1268',
  '1284',
  '1345',
  '1441',
  '1473',
  '1649',
  '1664',
  '1670',
  '1671',
  '1684',
  '1721',
  '1758',
  '1767',
  '1784',
  '1787',
  '1809',
  '1829',
  '1849',
  '1868',
  '1869',
  '1876',
  '1939',
  '971',
  '966',
  '965',
  '964',
  '963',
  '962',
  '961',
  '960',
  '995',
  '994',
  '993',
  '992',
  '998',
  '996',
  '977',
  '976',
  '975',
  '974',
  '973',
  '972',
  '970',
  '968',
  '967',
  '886',
  '880',
  '856',
  '855',
  '853',
  '852',
  '850',
  '98',
  '97',
  '96',
  '95',
  '94',
  '93',
  '92',
  '91',
  '90',
  '88',
  '86',
  '84',
  '82',
  '81',
  '66',
  '65',
  '64',
  '63',
  '62',
  '61',
  '60',
  '58',
  '57',
  '56',
  '55',
  '54',
  '53',
  '52',
  '51',
  '49',
  '48',
  '47',
  '46',
  '45',
  '44',
  '43',
  '41',
  '40',
  '39',
  '38',
  '37',
  '36',
  '35',
  '34',
  '33',
  '32',
  '31',
  '29',
  '28',
  '27',
  '26',
  '25',
  '24',
  '23',
  '22',
  '21',
  '20',
];

function startsWithKnownCountryCode(digits) {
  return KNOWN_CC_PREFIXES.some((p) => digits.startsWith(p));
}

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

  const cc = String(defaultCountryCode || '44').replace(/\D/g, '') || '44';

  // UK national mobile without trunk 0: mobiles are 7xxxxxxxxx (10 digits). Green API expects E.164 e.g. 447…@c.us.
  // Excel often drops the leading 0 (7852535146). When default region is UK, prepend 44.
  if (cc === '44' && digits.length === 10 && digits.startsWith('7')) {
    return `44${digits}`;
  }

  // Short national numbers (9 digits) with no visible country code — prepend default CC.
  // Skips values that already start with defaultCountryCode or another known international prefix.
  if (digits.length === 9 && !digits.startsWith(cc) && !startsWithKnownCountryCode(digits)) {
    return `${cc}${digits}`;
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

/**
 * Format normalized digits for Meta Cloud API `to` field (digits only, no +, no @c.us).
 * @param {string} digits - Normalized phone (may include non-digits; stripped)
 * @returns {string}
 */
function toMetaRecipient(digits) {
  return String(digits || '').replace(/\D/g, '');
}

module.exports = { normalizePhone, toChatId, toMetaRecipient };
