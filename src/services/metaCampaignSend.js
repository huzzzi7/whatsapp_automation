/**
 * Sends one batch of campaign contacts via Meta Cloud API templates, mirroring the
 * { sentPhoneDigits, failedSends } shape that replyFlow.sendFirstMessageOnlyWithStore returns
 * so CampaignWorker's reconciliation loop works unchanged for either provider.
 */
const metaWhatsApp = require('../metaWhatsApp');
const { toMetaRecipient } = require('../phone');
const { buildComponentsForTemplate } = require('../metaTemplateBuilder');

// Meta error codes confirmed to mean the TEMPLATE itself is unusable right now — every remaining
// send in the campaign will fail identically, so there's no point recording each one as a
// separate per-recipient failure and grinding through the whole contact list. Deliberately a
// short, conservative list of codes actually observed/confirmed, not every 132xxx code Meta has
// — misclassifying a genuinely per-recipient error as template-fatal would wrongly abort a
// campaign that could otherwise keep sending to everyone else.
const TEMPLATE_FATAL_META_ERROR_CODES = new Set([
  132015, // Template is paused (due to low quality/negative feedback) — confirmed 2026-08-13
  132001, // Template does not exist (e.g. deleted/renamed after the campaign was configured)
]);

/**
 * @param {Array<{phone: string, [key: string]: any}>} users
 * @param {{ metaConfig: {phoneNumberId:string, accessToken:string, graphVersion:string}, metaTemplate: {name:string, languageCode:string, variables:string[]} }} ctx
 * @returns {Promise<{ sentPhoneDigits: string[], failedSends: Record<string,string>, sentMessageIds: Record<string,string> }>}
 */
async function sendMetaTemplateBatch(users, { metaConfig, metaTemplate }) {
  const sentPhoneDigits = [];
  const failedSends = {};
  const sentMessageIds = {};

  for (const user of users) {
    const phone = String(user.phone || '');
    const { components, missing } = buildComponentsForTemplate(metaTemplate, user);
    if (missing.length > 0) {
      failedSends[phone] = `missing column: ${missing.join(', ')}`;
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await metaWhatsApp.sendTemplate({
        to: toMetaRecipient(phone),
        phoneNumberId: metaConfig.phoneNumberId,
        accessToken: metaConfig.accessToken,
        templateName: metaTemplate.name,
        languageCode: metaTemplate.languageCode,
        components,
        graphVersion: metaConfig.graphVersion || undefined,
      });
      sentPhoneDigits.push(phone);
      const wamid = res?.messages?.[0]?.id;
      if (wamid) sentMessageIds[phone] = wamid;
    } catch (err) {
      if (TEMPLATE_FATAL_META_ERROR_CODES.has(err?.metaErrorCode)) {
        const fatal = new Error(
          `Template "${metaTemplate.name}" is unusable right now (Meta error ${err.metaErrorCode}): ${err.message}`,
        );
        fatal.templateFatal = true;
        throw fatal;
      }
      failedSends[phone] = err?.message || 'Meta send failed';
    }
  }

  return { sentPhoneDigits, failedSends, sentMessageIds };
}

module.exports = { sendMetaTemplateBatch };
