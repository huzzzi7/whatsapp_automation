/**
 * Sends one batch of campaign contacts via Meta Cloud API templates, mirroring the
 * { sentPhoneDigits, failedSends } shape that replyFlow.sendFirstMessageOnlyWithStore returns
 * so CampaignWorker's reconciliation loop works unchanged for either provider.
 */
const metaWhatsApp = require('../metaWhatsApp');
const { toMetaRecipient } = require('../phone');
const { buildComponentsForTemplate } = require('../metaTemplateBuilder');

/**
 * @param {Array<{phone: string, [key: string]: any}>} users
 * @param {{ metaConfig: {phoneNumberId:string, accessToken:string, graphVersion:string}, metaTemplate: {name:string, languageCode:string, variables:string[]} }} ctx
 * @returns {Promise<{ sentPhoneDigits: string[], failedSends: Record<string,string> }>}
 */
async function sendMetaTemplateBatch(users, { metaConfig, metaTemplate }) {
  const sentPhoneDigits = [];
  const failedSends = {};

  for (const user of users) {
    const phone = String(user.phone || '');
    const { components, missing } = buildComponentsForTemplate(metaTemplate, user);
    if (missing.length > 0) {
      failedSends[phone] = `missing column: ${missing.join(', ')}`;
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await metaWhatsApp.sendTemplate({
        to: toMetaRecipient(phone),
        phoneNumberId: metaConfig.phoneNumberId,
        accessToken: metaConfig.accessToken,
        templateName: metaTemplate.name,
        languageCode: metaTemplate.languageCode,
        components,
        graphVersion: metaConfig.graphVersion || undefined,
      });
      sentPhoneDigits.push(phone);
    } catch (err) {
      failedSends[phone] = err?.message || 'Meta send failed';
    }
  }

  return { sentPhoneDigits, failedSends };
}

module.exports = { sendMetaTemplateBatch };
