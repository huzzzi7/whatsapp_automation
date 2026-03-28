/**
 * Central config: paths, GreenAPI base URL, delays, message templates.
 * Per-instance credentials live in DB (GreenInstance); use GREENAPI_BASE_URL only here.
 */
require('dotenv').config();
const path = require('path');

const excelPath = path.join(__dirname, 'original.xlsx');

const baseUrl = (process.env.GREENAPI_BASE_URL || 'https://api.green-api.com').replace(/\/$/, '');

const delayBetweenMessagesMs = parseInt(process.env.DELAY_BETWEEN_MESSAGES_MS || '1500', 10);
const delayBetweenUsersMs = parseInt(process.env.DELAY_BETWEEN_USERS_MS || '4000', 10);

const defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || '44';

const messageTemplates = {
  1: (user) => `Heyy what you studying at ${user.university} in sept!`,
  2: () => 'Psych! There\'s another gc if you want to join I can add you',
  3: (user) => 'Of course heres the link!' + (user.group ? ` ${user.group}` : ''),
  4: () => 'Did you book the welcome week tickets that came out? We all have on the gc',
  5: () => 'Oh let me send you the link cause cheap rn, we did the cheapest one and queue skip',
  6: (user) => [user.link, user.group].filter(Boolean).join(' ') || '',
};

module.exports = {
  excelPath,
  /** GreenAPI host only; instanceId + apiToken come from GreenInstance rows */
  greenApiBaseUrl: baseUrl,
  delays: { betweenMessages: delayBetweenMessagesMs, betweenUsers: delayBetweenUsersMs },
  defaultCountryCode,
  messageTemplates,
};
