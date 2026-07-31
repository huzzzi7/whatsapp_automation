/**
 * Central config: paths, delays, defaults.
 */
require('dotenv').config();
const path = require('path');

const excelPath = path.join(__dirname, 'original.xlsx');

const delayBetweenMessagesMs = parseInt(process.env.DELAY_BETWEEN_MESSAGES_MS || '1500', 10);
const delayBetweenUsersMs = parseInt(process.env.DELAY_BETWEEN_USERS_MS || '4000', 10);

const defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || '44';

const defaultCountryCodeFromEnv =
  process.env.DEFAULT_COUNTRY_CODE != null && String(process.env.DEFAULT_COUNTRY_CODE).trim() !== '';
try {
  const { root } = require('./src/utils/logger');
  root.info(
    {
      event: 'config_default_country_code',
      defaultCountryCode,
      source: defaultCountryCodeFromEnv ? 'env' : 'fallback',
    },
    defaultCountryCodeFromEnv
      ? `Phone normalization: DEFAULT_COUNTRY_CODE=${defaultCountryCode} (from env)`
      : `Phone normalization: DEFAULT_COUNTRY_CODE=${defaultCountryCode} (env unset; using code fallback)`,
  );
} catch {
  console.info(`[config] Phone normalization: DEFAULT_COUNTRY_CODE=${defaultCountryCode}`);
}

module.exports = {
  excelPath,
  delays: { betweenMessages: delayBetweenMessagesMs, betweenUsers: delayBetweenUsersMs },
  defaultCountryCode,
};
