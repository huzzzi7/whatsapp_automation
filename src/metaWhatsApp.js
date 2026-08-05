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

/**
 * Uploads a media file to Meta so it can be referenced by ID in a subsequent sendMediaMessage
 * call — Meta doesn't accept raw file bytes directly on the messages endpoint.
 * @param {{ phoneNumberId: string, accessToken: string, buffer: Buffer, mimeType: string, filename?: string, graphVersion?: string }} params
 * @returns {Promise<string>} Meta's media id
 */
async function uploadMedia({ phoneNumberId, accessToken, buffer, mimeType, filename, graphVersion }) {
  const phoneNumberIdTrim = phoneNumberId != null ? String(phoneNumberId).trim() : '';
  const token = accessToken != null ? String(accessToken).trim() : '';
  if (!phoneNumberIdTrim || !token) {
    throw new Error('Meta uploadMedia requires phoneNumberId and accessToken');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Meta uploadMedia requires a non-empty buffer');
  }
  const type = mimeType != null ? String(mimeType).trim() : '';
  if (!type) {
    throw new Error('Meta uploadMedia requires mimeType');
  }

  const url = `${graphBaseUrl(graphVersion)}/${encodeURIComponent(phoneNumberIdTrim)}/media`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', type);
  form.append('file', new Blob([buffer], { type }), filename || 'upload');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Meta Graph ${res.status}: ${JSON.stringify(data)}`);
  }
  const mediaId = data?.id;
  if (!mediaId) throw new Error(`Meta uploadMedia: no media id in response: ${JSON.stringify(data)}`);
  log.info({ event: 'meta_media_uploaded', mediaId, mimeType: type }, 'meta_media_uploaded');
  return String(mediaId);
}

/**
 * Sends a previously-uploaded media file (see uploadMedia) as an image/document/video/audio message.
 * @param {{ to: string, phoneNumberId: string, accessToken: string, mediaType: 'image'|'document'|'video'|'audio',
 *   mediaId: string, caption?: string, filename?: string, graphVersion?: string }} params
 */
async function sendMediaMessage({ to, phoneNumberId, accessToken, mediaType, mediaId, caption, filename, graphVersion }) {
  const phoneNumberIdTrim = phoneNumberId != null ? String(phoneNumberId).trim() : '';
  const token = accessToken != null ? String(accessToken).trim() : '';
  const type = mediaType != null ? String(mediaType).trim() : '';
  const id = mediaId != null ? String(mediaId).trim() : '';
  if (!phoneNumberIdTrim || !token) {
    throw new Error('Meta sendMediaMessage requires phoneNumberId and accessToken');
  }
  if (!['image', 'document', 'video', 'audio'].includes(type)) {
    throw new Error(`Meta sendMediaMessage: unsupported mediaType "${type}"`);
  }
  if (!id) {
    throw new Error('Meta sendMediaMessage requires mediaId');
  }

  const toDigits = assertMetaRecipient(to);
  const url = `${graphBaseUrl(graphVersion)}/${encodeURIComponent(phoneNumberIdTrim)}/messages`;

  const mediaObject = { id };
  if (caption != null && String(caption).trim()) mediaObject.caption = String(caption).trim();
  if (type === 'document' && filename != null && String(filename).trim()) {
    mediaObject.filename = String(filename).trim();
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: toDigits,
    type,
    [type]: mediaObject,
  };

  try {
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Meta Graph returned ${res.status}: ${JSON.stringify(res.data)}`);
    }
    log.info({ event: 'meta_media_sent', to: toDigits, mediaType: type }, 'meta_media_sent');
    return res.data;
  } catch (err) {
    const msg = err.response
      ? `Meta Graph ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(msg);
  }
}

/**
 * Downloads inbound media content. Two-step: fetch a temporary URL by media id, then an
 * authenticated GET of that URL. Meta's URL expires 5 minutes after issuance, so this must be
 * called immediately when the webhook arrives — never deferred to whenever an admin later opens
 * the chat.
 * @param {{ mediaId: string, phoneNumberId?: string, accessToken: string, graphVersion?: string }} params
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function downloadMedia({ mediaId, phoneNumberId, accessToken, graphVersion }) {
  const id = mediaId != null ? String(mediaId).trim() : '';
  const phoneNumberIdTrim = phoneNumberId != null ? String(phoneNumberId).trim() : '';
  const token = accessToken != null ? String(accessToken).trim() : '';
  if (!id || !token) {
    throw new Error('Meta downloadMedia requires mediaId and accessToken');
  }

  const metaUrl = `${graphBaseUrl(graphVersion)}/${encodeURIComponent(id)}${
    phoneNumberIdTrim ? `?phone_number_id=${encodeURIComponent(phoneNumberIdTrim)}` : ''
  }`;

  try {
    const metaRes = await axios.get(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    const fileUrl = metaRes.data?.url;
    const mimeType = metaRes.data?.mime_type || 'application/octet-stream';
    if (!fileUrl) {
      throw new Error(`Meta downloadMedia: no url in metadata response: ${JSON.stringify(metaRes.data)}`);
    }
    const fileRes = await axios.get(fileUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    return { buffer: Buffer.from(fileRes.data), mimeType };
  } catch (err) {
    const msg = err.response
      ? `Meta Graph ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(msg);
  }
}

/**
 * Sends an emoji reaction to a specific prior message (by wamid). Fails with Meta error 131009
 * if the target is more than 30 days old, not in this thread, deleted, or itself a reaction.
 * @param {{ to: string, phoneNumberId: string, accessToken: string, messageId: string, emoji: string, graphVersion?: string }} params
 */
async function sendReaction({ to, phoneNumberId, accessToken, messageId, emoji, graphVersion }) {
  const phoneNumberIdTrim = phoneNumberId != null ? String(phoneNumberId).trim() : '';
  const token = accessToken != null ? String(accessToken).trim() : '';
  const targetId = messageId != null ? String(messageId).trim() : '';
  const emojiChar = emoji != null ? String(emoji) : '';
  if (!phoneNumberIdTrim || !token) {
    throw new Error('Meta sendReaction requires phoneNumberId and accessToken');
  }
  if (!targetId || !emojiChar) {
    throw new Error('Meta sendReaction requires messageId and emoji');
  }

  const toDigits = assertMetaRecipient(to);
  const url = `${graphBaseUrl(graphVersion)}/${encodeURIComponent(phoneNumberIdTrim)}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'reaction',
    reaction: { message_id: targetId, emoji: emojiChar },
  };

  try {
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Meta Graph returned ${res.status}: ${JSON.stringify(res.data)}`);
    }
    log.info({ event: 'meta_reaction_sent', to: toDigits, targetId, emoji: emojiChar }, 'meta_reaction_sent');
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
  sendTextMessage,
  getPhoneNumber,
  findTemplateByNameAndLanguage,
  templateHasOptOutButton,
  uploadMedia,
  sendMediaMessage,
  downloadMedia,
  sendReaction,
  assertMetaRecipient,
  getGraphVersion,
};
