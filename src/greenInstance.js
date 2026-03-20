/**
 * Resolve GreenAPI URL config from a persisted GreenInstance row.
 * Base URL comes from app config (env GREENAPI_BASE_URL only).
 */
const appConfig = require('../config');

/**
 * @param {{ greenInstanceId: string, apiToken: string }} row
 * @returns {{ instanceId: string, apiToken: string, baseUrl: string }}
 */
function resolveGreenApiConfig(row) {
  if (!row || !row.greenInstanceId || !row.apiToken) {
    throw new Error('Green instance row is missing greenInstanceId or apiToken');
  }
  return {
    instanceId: String(row.greenInstanceId).trim(),
    apiToken: String(row.apiToken).trim(),
    baseUrl: appConfig.greenApiBaseUrl,
  };
}

function maskApiToken(token) {
  const t = token == null ? '' : String(token);
  if (t.length <= 4) return '••••';
  return `••••••••${t.slice(-4)}`;
}

module.exports = { resolveGreenApiConfig, maskApiToken };
