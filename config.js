/**
 * Central config: paths, GreenAPI credentials, delays, and message templates.
 * Loads .env via dotenv; all message/send behaviour is driven from here.
 */
require('dotenv').config();
const path = require('path');

// Excel file path (column-based: row 1=links, row 2=cities, row 3=universities, row 4+=phones)
const excelPath = path.join(__dirname, 'original.xlsx');

// GreenAPI base URL and auth (from .env)
const instanceId = process.env.GREENAPI_INSTANCE || '';
const apiToken = process.env.GREENAPI_TOKEN || '';
const baseUrl = (process.env.GREENAPI_BASE_URL || 'https://api.green-api.com').replace(/\/$/, '');

// Delays (ms): between each message in a user's sequence, then between users
const delayBetweenMessagesMs = parseInt(process.env.DELAY_BETWEEN_MESSAGES_MS || '1500', 10);
const delayBetweenUsersMs = parseInt(process.env.DELAY_BETWEEN_USERS_MS || '4000', 10);

// Default country code for phone normalization (e.g. 44 for UK when number starts with 0)
const defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || '44';

// Message templates: 1 and 6 use user data; 2–5 are static
const messageTemplates = {
  1: (user) => `Heyy what you studying at ${user.university} in sept!`,
  2: () => 'Psych! There\'s another gc if you want to join I can add you',
  3: () => 'Of course heres the link!',
  4: () => 'Did you book the welcome week tickets that came out? We all have on the gc',
  5: () => 'Oh let me send you the link cause cheap rn, we did the cheapest one and queue skip',
  6: (user) => user.link || '',
};

module.exports = {
  excelPath,
  greenApi: { instanceId, apiToken, baseUrl },
  delays: { betweenMessages: delayBetweenMessagesMs, betweenUsers: delayBetweenUsersMs },
  defaultCountryCode,
  messageTemplates,
};
