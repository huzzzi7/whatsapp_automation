/**
 * Dry-run: same normalization path as campaign first message
 * (CampaignWorker → sendFirstMessageOnlyWithStore uses user.phone = phone_normalized
 *  then normalizePhone(phone, defaultCountryCode) → toChatId).
 *
 * Run: node scripts/test-campaign-send-path.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { normalizePhone, toChatId } = require(path.join(__dirname, '..', 'src', 'phone.js'));

const config = require(path.join(__dirname, '..', 'config.js'));
const defaultCC = config.defaultCountryCode;

/** UK mobile E.164 in this dataset: 12 digits before @c.us */
const UK_12_DIGIT_CHAT = /^\d{12}@c\.us$/;
/** Broken pipeline: national-looking length without full CC (GreenAPI invalid) */
const BROKEN_SHORT_LOCAL = /^\d{7,10}@c\.us$/;

const samples = ['447300062155', '447305875974', '447307627120'];

console.log('Campaign send path dry-run (normalizePhone → toChatId)');
console.log(`defaultCountryCode from config.js: ${JSON.stringify(defaultCC)}`);
console.log('');

for (const phoneNormalized of samples) {
  const afterNormalize = normalizePhone(phoneNormalized, defaultCC);
  const chatId = toChatId(afterNormalize);
  const matchesUk12 = UK_12_DIGIT_CHAT.test(chatId);
  const looksBroken = BROKEN_SHORT_LOCAL.test(chatId);

  console.log(`phone_normalized: ${phoneNormalized}`);
  console.log(`  → normalizePhone(phone, defaultCC): ${afterNormalize}`);
  console.log(`  → toChatId(...): ${chatId}`);
  console.log(`  → final chatId (GreenAPI body): ${chatId}`);
  console.log(`  matches /^\\d{12}@c\\.us$/ (12-digit UK-style): ${matchesUk12 ? 'YES' : 'NO'}`);
  console.log(`  NOT broken (7–10 digits before @c.us): ${looksBroken ? 'FAIL — looks broken' : 'YES'}`);
  console.log('');
}

console.log('Done.');
