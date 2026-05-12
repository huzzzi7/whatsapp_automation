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
  1: (user) => [
    `Heyy are you starting at ${user.university} this sept? 👀`,
    `yo you going to ${user.university} in september?`,
    `Hiii did you get into ${user.university} for this year?`,
    `Hey! you going ${user.university} this sept yeah?`,
  ],
  2: () => [
    "omg there's actually a gc for people going there, want me to add you?",
    "wait there's a group chat for this you should be in it lol",
    "haha no way, there's a gc for people going there want in?",
    "there's a whole gc for this honestly you'd love it, want me to add you?",
  ],
  3: (user) => [
    'here you go!' + (user.group ? ` ${user.group}` : ''),
    'sending it now!' + (user.group ? ` ${user.group}` : ''),
    "ofc here's the link!" + (user.group ? ` ${user.group}` : ''),
  ],
  4: () => [
    'did you sort your welcome week tickets? everyone on the gc has already got theirs lol',
    'have you got welcome week tickets yet? the gc people all sorted theirs already',
    'btw have you done welcome week tickets? we all got ours on the gc',
  ],
  5: () => [
    'ill send you the link, we got the budget one with queue skip which was sick',
    'here ill find it, we did the cheapest option with queue jump',
    'sending the link now, we all got the cheap one with queue skip',
  ],
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
