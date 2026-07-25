/**
 * Meta WhatsApp Cloud API client (Graph).
 * Outbound approved templates + phone-number health check only.
 */
const axios = require('axios');
const { createLogger } = require('./utils/logger');

const log = createLogger('metaWhatsApp');

function getGraphVersion() {
  const v = String(process.env.META_GRAPH_VERSION || 'v25.0').trim();
  return v || 'v25.0';
}

function graphBaseUrl(graphVersion) {
  const ver = graphVersion != null && String(graphVersion).trim() !== ''
    ? String(graphVersion).trim()
    : getGraphVersion();
  return `https://graph.facebook.com/${ver.replace(/^\//, '')}`;
}

/**
 * Meta `to` must be digits-only (no +, no @c.us).
 * @param {string} to
 * @returns {string}
 */
function assertMetaRecipient(to) {
  const raw = to != null ? String(to).trim() : '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Meta recipient requires a non-empty digits-only phone number');
  }
  if (digits.length < 8 || digits.length > 15) {
    throw new Error(`Meta recipient phone length invalid (${digits.length} digits)`);
  }
  return digits;
}

/**
 * Send an approved WhatsApp template via Cloud API.
 * @param {{
 *   to: string,
 *   phoneNumberId: string,
 *   accessToken: string,
 *   templateName: string,
 *   languageCode: string,
 *   components?: object[],
 *   graphVersion?: string,
 * }} params
 */
async function sendTemplate({
  to,
  phoneNumberId,
  accessToken,
  templateName,
  languageCode,
  components,
  graphVersion,
}) {
  const phoneNumberIdTrim = phoneNumberId != null ? String(phoneNumberId).trim() : '';
  const token = accessToken != null ? String(accessToken).trim() : '';
  const name = templateName != null ? String(templateName).trim() : '';
  const lang = languageCode != null ? String(languageCode).trim() : '';
  if (!phoneNumberIdTrim || !token) {
    throw new Error('Meta sendTemplate requires phoneNumberId and accessToken');
  }
  if (!name || !lang) {
    throw new Error('Meta sendTemplate requires templateName and languageCode');
  }

  const toDigits = assertMetaRecipient(to);
  const url = `${graphBaseUrl(graphVersion)}/${encodeURIComponent(phoneNumberIdTrim)}/messages`;
  const template = {
    name,
    language: { code: lang },
  };
  if (Array.isArray(components) && components.length > 0) {
    template.components = components;
  }

  const body = {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'template',
    template,
  };

  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Meta Graph returned ${res.status}: ${JSON.stringify(res.data)}`);
    }
    log.info(
      { event: 'meta_template_sent', to: toDigits, templateName: name, languageCode: lang },
      'meta_template_sent',
    );
    return res.data;
  } catch (err) {
    const msg = err.response
      ? `Meta Graph ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(msg);
  }
}

/**
 * Health check: fetch phone number metadata from Graph.
 * @param {{ phoneNumberId: string, accessToken: string, graphVersion?: string }} params
 */
async function getPhoneNumber({ phoneNumberId, accessToken, graphVersion }) {
  const phoneNumberIdTrim = phoneNumberId != null ? String(phoneNumberId).trim() : '';
  const token = accessToken != null ? String(accessToken).trim() : '';
  if (!phoneNumberIdTrim || !token) {
    throw new Error('Meta getPhoneNumber requires phoneNumberId and accessToken');
  }

  const fields = 'id,display_phone_number,verified_name,quality_rating';
  const url = `${graphBaseUrl(graphVersion)}/${encodeURIComponent(phoneNumberIdTrim)}?fields=${encodeURIComponent(fields)}`;

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Meta Graph returned ${res.status}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  } catch (err) {
    const msg = err.response
      ? `Meta Graph ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(msg);
  }
}

module.exports = {
  sendTemplate,
  getPhoneNumber,
  assertMetaRecipient,
  getGraphVersion,
};
