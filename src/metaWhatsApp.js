/**
 * Meta WhatsApp Cloud API client (Graph).
 * Outbound approved templates + phone-number health check only.
 */
const axios = require('axios');
const { createLogger } = require('./utils/logger');
const { OPT_OUT_BUTTON_PAYLOAD, isOptOutText } = require('./utils/optOut');

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
 * Send a free-form text (session) message. Only deliverable within Meta's 24-hour
 * customer-service window after the recipient's last inbound message — unlike sendTemplate,
 * this does not require a pre-approved template.
 * @param {{
 *   to: string,
 *   phoneNumberId: string,
 *   accessToken: string,
 *   text: string,
 *   graphVersion?: string,
 * }} params
 */
async function sendTextMessage({ to, phoneNumberId, accessToken, text, graphVersion }) {
  const phoneNumberIdTrim = phoneNumberId != null ? String(phoneNumberId).trim() : '';
  const token = accessToken != null ? String(accessToken).trim() : '';
  const body = text != null ? String(text) : '';
  if (!phoneNumberIdTrim || !token) {
    throw new Error('Meta sendTextMessage requires phoneNumberId and accessToken');
  }
  if (!body.trim()) {
    throw new Error('Meta sendTextMessage requires non-empty text');
  }

  const toDigits = assertMetaRecipient(to);
  const url = `${graphBaseUrl(graphVersion)}/${encodeURIComponent(phoneNumberIdTrim)}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'text',
    text: { body, preview_url: false },
  };

  try {
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Meta Graph returned ${res.status}: ${JSON.stringify(res.data)}`);
    }
    log.info({ event: 'meta_text_sent', to: toDigits }, 'meta_text_sent');
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

/**
 * Fetches the live, approved template definition from Meta (source of truth for its actual
 * components/buttons) — not just what we stored when it was registered locally.
 * @param {{ wabaId: string, accessToken: string, name: string, languageCode?: string, graphVersion?: string }} params
 * @returns {Promise<object|null>} the matching template object (with `components`), or null if not found
 */
async function findTemplateByNameAndLanguage({ wabaId, accessToken, name, languageCode, graphVersion }) {
  const waba = wabaId != null ? String(wabaId).trim() : '';
  const token = accessToken != null ? String(accessToken).trim() : '';
  const templateName = name != null ? String(name).trim() : '';
  if (!waba || !token || !templateName) {
    throw new Error('findTemplateByNameAndLanguage requires wabaId, accessToken, and name');
  }

  const fields = 'name,language,status,category,components';
  const url = `${graphBaseUrl(graphVersion)}/${encodeURIComponent(waba)}/message_templates?fields=${encodeURIComponent(fields)}&name=${encodeURIComponent(templateName)}`;

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Meta Graph returned ${res.status}: ${JSON.stringify(res.data)}`);
    }
    const list = Array.isArray(res.data?.data) ? res.data.data : [];
    const lang = languageCode != null ? String(languageCode).trim().toLowerCase() : '';
    const match = lang ? list.find((t) => String(t?.language || '').toLowerCase() === lang) : list[0];
    return match || null;
  } catch (err) {
    const msg = err.response
      ? `Meta Graph ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(msg);
  }
}

/**
 * @param {object|null} template - a template object as returned by findTemplateByNameAndLanguage
 * @returns {boolean} true if the template has a Quick Reply button matching the opt-out rules
 */
function templateHasOptOutButton(template) {
  const components = Array.isArray(template?.components) ? template.components : [];
  const buttonsComponent = components.find((c) => String(c?.type || '').toUpperCase() === 'BUTTONS');
  const buttons = Array.isArray(buttonsComponent?.buttons) ? buttonsComponent.buttons : [];
  return buttons.some((b) => {
    const type = String(b?.type || '').toUpperCase();
    if (type !== 'QUICK_REPLY') return false;
    return isOptOutText(b?.text) || b?.text === OPT_OUT_BUTTON_PAYLOAD;
  });
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  getPhoneNumber,
  findTemplateByNameAndLanguage,
  templateHasOptOutButton,
  assertMetaRecipient,
  getGraphVersion,
};
